
import os
from datetime import date, datetime
from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware

import models
from database import ensure_patient_address_column, engine, get_db
from appointment_service import (
    check_doctor_availability,
    book_appointment,
    cancel_appointment
)

# Create database tables
models.Base.metadata.create_all(bind=engine)
ensure_patient_address_column(engine)


def ensure_booked_slot_index():
    index = next(
        index
        for index in models.Appointment.__table__.indexes
        if index.name == "uq_appointments_booked_slot"
    )
    existing_indexes = {
        item["name"] for item in inspect(engine).get_indexes("appointments")
    }
    if index.name in existing_indexes:
        return

    with engine.connect() as connection:
        duplicate = connection.execute(
            text(
                """
                SELECT doctor_id, appointment_time
                FROM appointments
                WHERE status = 'booked'
                GROUP BY doctor_id, appointment_time
                HAVING COUNT(*) > 1
                LIMIT 1
                """
            )
        ).first()
    if duplicate:
        raise RuntimeError(
            "Cannot protect appointment slots: existing booked appointments "
            f"duplicate doctor {duplicate.doctor_id} at {duplicate.appointment_time}."
        )

    index.create(bind=engine, checkfirst=True)


ensure_booked_slot_index()

app = FastAPI(title="CareConnect Doctor Appointment API")

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request models
class BookingRequest(BaseModel):
    patient_name: str
    phone_number: str
    patient_address: str
    doctor_id: int
    appointment_time: datetime


class CancellationRequest(BaseModel):
    appointment_id: int
    phone_number: str


# Add sample doctors when the database is empty
def seed_doctors():
    db = next(get_db())
    try:
        if db.query(models.Doctor).count() == 0:
            doctors = [
                models.Doctor(
                    name="Dr. Rahul Sharma",
                    specialization="Cardiology",
                    available_days="Monday, Tuesday, Wednesday"
                ),
                models.Doctor(
                    name="Dr. Priya Verma",
                    specialization="Dermatology",
                    available_days="Monday, Wednesday, Friday"
                ),
                models.Doctor(
                    name="Dr. Amit Kumar",
                    specialization="General Physician",
                    available_days="Monday, Tuesday, Thursday"
                )
            ]

            db.add_all(doctors)
            db.commit()
    finally:
        db.close()


seed_doctors()


@app.get("/")
def home():
    return {"message": "Doctor Appointment API is running!"}


@app.get("/health")
def health():
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/doctors")
def get_doctors(db: Session = Depends(get_db)):
    return db.query(models.Doctor).all()


@app.get("/availability")
def availability(
    specialization: str,
    appointment_date: date,
    db: Session = Depends(get_db)
):
    if appointment_date < date.today():
        raise HTTPException(status_code=400, detail="Choose today or a future date.")
    return check_doctor_availability(
        db, specialization, appointment_date
    )


@app.post("/appointments/book")
def book(
    request: BookingRequest,
    db: Session = Depends(get_db)
):
    if not request.patient_name.strip():
        raise HTTPException(status_code=400, detail="Patient name is required.")

    if not request.patient_address.strip():
        raise HTTPException(status_code=400, detail="Patient address is required.")

    if len(request.phone_number) != 10 or not request.phone_number.isascii() or not request.phone_number.isdigit():
        raise HTTPException(status_code=400, detail="Enter a valid 10-digit phone number.")

    if request.appointment_time <= datetime.now():
        raise HTTPException(status_code=400, detail="Appointment must be in the future.")

    result = book_appointment(
        db,
        request.patient_name,
        request.phone_number,
        request.patient_address,
        request.doctor_id,
        request.appointment_time
    )

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    return result


@app.post("/appointments/cancel")
def cancel(
    request: CancellationRequest,
    db: Session = Depends(get_db)
):
    if len(request.phone_number) != 10 or not request.phone_number.isascii() or not request.phone_number.isdigit():
        raise HTTPException(status_code=400, detail="Enter a valid 10-digit phone number.")

    result = cancel_appointment(
        db,
        request.appointment_id,
        request.phone_number
    )

    if not result["success"]:
        raise HTTPException(status_code=404, detail=result["message"])

    return result


@app.get("/appointments")
def get_appointments(db: Session = Depends(get_db)):
    appointments = db.query(models.Appointment).all()

    return [
        {
            "id": appointment.id,
            "patient_name": appointment.patient_name,
            "doctor_name": appointment.doctor.name,
            "appointment_time": appointment.appointment_time,
            "status": appointment.status
        }
        for appointment in appointments
    ]
