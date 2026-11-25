import unittest
from datetime import date, datetime, time, timedelta
from tempfile import TemporaryDirectory

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateIndex
from sqlalchemy.orm import sessionmaker

from appointment_service import book_appointment, cancel_appointment
from database import Base, ensure_patient_address_column, normalize_database_url
from models import Appointment, Doctor


class AppointmentServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = TemporaryDirectory()
        self.engine = create_engine(
            f"sqlite:///{self.temp_directory.name}/appointments.db",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(bind=self.engine)
        self.session = sessionmaker(bind=self.engine)()
        self.doctor = Doctor(
            name="Dr. Test",
            specialization="General Physician",
            available_days="Monday, Tuesday, Wednesday, Thursday, Friday",
        )
        self.session.add(self.doctor)
        self.session.commit()
        days_until_monday = (7 - date.today().weekday()) % 7 or 7
        self.appointment_time = datetime.combine(
            date.today() + timedelta(days=days_until_monday),
            time(10, 0),
        )

    def tearDown(self):
        self.session.close()
        self.engine.dispose()
        self.temp_directory.cleanup()

    def test_booked_slot_is_unique_and_can_be_rebooked_after_cancellation(self):
        first = book_appointment(
            self.session,
            "Alex Morgan",
            "1234567890",
            "15 Example Street, Sample City",
            self.doctor.id,
            self.appointment_time,
        )
        duplicate = book_appointment(
            self.session,
            "Taylor Smith",
            "0987654321",
            "32 Sample Road, Sample City",
            self.doctor.id,
            self.appointment_time,
        )

        self.assertTrue(first["success"])
        self.assertFalse(duplicate["success"])

        cancelled = cancel_appointment(
            self.session,
            first["appointment_id"],
            "1234567890",
        )
        rebooked = book_appointment(
            self.session,
            "Taylor Smith",
            "0987654321",
            "32 Sample Road, Sample City",
            self.doctor.id,
            self.appointment_time,
        )

        self.assertTrue(cancelled["success"])
        self.assertTrue(rebooked["success"])

    def test_database_rejects_concurrent_booked_slot_duplicates(self):
        first = Appointment(
            patient_name="Alex Morgan",
            phone_number="1234567890",
            patient_address="15 Example Street, Sample City",
            doctor_id=self.doctor.id,
            appointment_time=self.appointment_time,
            status="booked",
        )
        self.session.add(first)
        self.session.commit()

        duplicate = Appointment(
            patient_name="Taylor Smith",
            phone_number="0987654321",
            patient_address="32 Sample Road, Sample City",
            doctor_id=self.doctor.id,
            appointment_time=self.appointment_time,
            status="booked",
        )
        self.session.add(duplicate)
        with self.assertRaises(IntegrityError):
            self.session.commit()
        self.session.rollback()

    def test_booking_requires_and_persists_patient_address(self):
        missing_address = book_appointment(
            self.session,
            "Alex Morgan",
            "1234567890",
            "  ",
            self.doctor.id,
            self.appointment_time,
        )
        booked = book_appointment(
            self.session,
            "Alex Morgan",
            "1234567890",
            " 15 Example Street, Sample City ",
            self.doctor.id,
            self.appointment_time,
        )

        self.assertFalse(missing_address["success"])
        self.assertTrue(booked["success"])
        appointment = self.session.get(Appointment, booked["appointment_id"])
        self.assertEqual(appointment.patient_address, "15 Example Street, Sample City")


class DeploymentConfigurationTests(unittest.TestCase):
    def test_existing_database_gets_patient_address_column_idempotently(self):
        with TemporaryDirectory() as directory:
            engine = create_engine(f"sqlite:///{directory}/legacy.db")
            with engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        CREATE TABLE appointments (
                            id INTEGER PRIMARY KEY,
                            patient_name VARCHAR NOT NULL,
                            phone_number VARCHAR NOT NULL,
                            doctor_id INTEGER NOT NULL,
                            appointment_time DATETIME NOT NULL,
                            status VARCHAR NOT NULL
                        )
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        INSERT INTO appointments
                            (id, patient_name, phone_number, doctor_id,
                             appointment_time, status)
                        VALUES (1, 'Alex Morgan', '1234567890', 1,
                                '2030-01-01 10:00:00', 'booked')
                        """
                    )
                )

            ensure_patient_address_column(engine)
            ensure_patient_address_column(engine)

            column_names = {
                column["name"]
                for column in inspect(engine).get_columns("appointments")
            }
            self.assertIn("patient_address", column_names)
            with engine.connect() as connection:
                address = connection.execute(
                    text("SELECT patient_address FROM appointments WHERE id = 1")
                ).scalar_one()
            self.assertEqual(address, "")
            engine.dispose()

    def test_postgres_urls_use_the_installed_psycopg_driver(self):
        self.assertEqual(
            normalize_database_url("postgres://user:pass@db.example/app"),
            "postgresql+psycopg://user:pass@db.example/app",
        )
        self.assertEqual(
            normalize_database_url("postgresql://user:pass@db.example/app"),
            "postgresql+psycopg://user:pass@db.example/app",
        )
        self.assertEqual(
            normalize_database_url("sqlite:///./doctor_appointments.db"),
            "sqlite:///./doctor_appointments.db",
        )

    def test_booked_slot_index_is_partial_for_postgres_too(self):
        index = next(
            index
            for index in Appointment.__table__.indexes
            if index.name == "uq_appointments_booked_slot"
        )
        statement = str(
            CreateIndex(index).compile(dialect=postgresql.dialect())
        )
        self.assertIn("CREATE UNIQUE INDEX", statement)
        self.assertIn("WHERE status = 'booked'", statement)


if __name__ == "__main__":
    unittest.main()
