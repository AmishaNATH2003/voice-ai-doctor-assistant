
from datetime import date, datetime, time

from models import Doctor, Appointment
from sqlalchemy.exc import IntegrityError


# Available appointment times
AVAILABLE_SLOTS = [
    time(10, 0),
    time(11, 0),
    time(14, 0),
    time(15, 0)
]


def check_doctor_availability(db, specialization, appointment_date):
    """Find doctors and available slots for a given specialization and date."""

    doctors = (
        db.query(Doctor)
        .filter(Doctor.specialization.ilike(f"%{specialization}%"))
        .order_by(Doctor.name)
        .all()
    )

    results = []
    weekday = appointment_date.strftime("%A")

    for doctor in doctors:
        available_slots = []

        if weekday not in doctor.available_days.split(", "):
            results.append({
                "doctor_id": doctor.id,
                "doctor_name": doctor.name,
                "specialization": doctor.specialization,
                "available_slots": available_slots
            })
            continue

        for slot in AVAILABLE_SLOTS:
            slot_datetime = datetime.combine(appointment_date, slot)
            if slot_datetime <= datetime.now():
                continue

            existing_appointment = (
                db.query(Appointment)
                .filter(
                    Appointment.doctor_id == doctor.id,
                    Appointment.appointment_time == slot_datetime,
                    Appointment.status == "booked"
                )
                .first()
            )

            if existing_appointment is None:
                available_slots.append(slot.strftime("%I:%M %p"))

        results.append({
            "doctor_id": doctor.id,
            "doctor_name": doctor.name,
            "specialization": doctor.specialization,
            "available_slots": available_slots
        })

    return results


def book_appointment(
    db, patient_name, phone_number, patient_address, doctor_id, appointment_time
):
    """Book an appointment if the selected slot is available."""

    if not patient_address or not patient_address.strip():
        return {"success": False, "message": "Patient address is required."}

    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()

    if doctor is None:
        return {"success": False, "message": "Doctor not found."}

    if appointment_time.time() not in AVAILABLE_SLOTS:
        return {"success": False, "message": "Invalid appointment time."}

    if appointment_time <= datetime.now():
        return {"success": False, "message": "Appointment must be in the future."}

    if appointment_time.strftime("%A") not in doctor.available_days.split(", "):
        return {
            "success": False,
            "message": "This doctor is not available on that day."
        }

    existing_appointment = (
        db.query(Appointment)
        .filter(
            Appointment.doctor_id == doctor_id,
            Appointment.appointment_time == appointment_time,
            Appointment.status == "booked"
        )
        .first()
    )

    if existing_appointment:
        return {"success": False, "message": "This slot is already booked."}

    appointment = Appointment(
        patient_name=patient_name,
        phone_number=phone_number,
        patient_address=patient_address.strip(),
        doctor_id=doctor_id,
        appointment_time=appointment_time,
        status="booked"
    )

    db.add(appointment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"success": False, "message": "This slot is already booked."}
    db.refresh(appointment)

    return {
        "success": True,
        "message": "Appointment booked successfully.",
        "appointment_id": appointment.id,
        "doctor_name": doctor.name,
        "appointment_time": appointment.appointment_time.strftime(
            "%d %B %Y, %I:%M %p"
        )
    }


def cancel_appointment(db, appointment_id, phone_number):
    """Cancel an appointment only when its phone number matches."""

    appointment = (
        db.query(Appointment)
        .filter(
            Appointment.id == appointment_id,
            Appointment.phone_number == phone_number,
            Appointment.status == "booked"
        )
        .first()
    )

    if appointment is None:
        return {
            "success": False,
            "message": "No matching active appointment was found."
        }

    appointment.status = "cancelled"
    db.commit()

    return {
        "success": True,
        "message": "Appointment cancelled successfully.",
        "appointment_id": appointment.id
    }
