
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import relationship
from database import Base


class Doctor(Base):
    __tablename__ = "doctors"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    specialization = Column(String, nullable=False)
    available_days = Column(String, nullable=False)

    appointments = relationship("Appointment", back_populates="doctor")


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        Index(
            "uq_appointments_booked_slot",
            "doctor_id",
            "appointment_time",
            unique=True,
            sqlite_where=text("status = 'booked'"),
            postgresql_where=text("status = 'booked'"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)

    patient_name = Column(String, nullable=False)
    phone_number = Column(String, nullable=False, index=True)
    patient_address = Column(Text, nullable=False, default="", server_default="")

    doctor_id = Column(Integer, ForeignKey("doctors.id"), nullable=False)

    appointment_time = Column(DateTime, nullable=False)

    status = Column(String, default="booked", nullable=False)

    doctor = relationship("Doctor", back_populates="appointments")
