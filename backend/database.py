
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def ensure_patient_address_column(database_engine) -> None:
    columns = {
        column["name"]
        for column in inspect(database_engine).get_columns("appointments")
    }
    if "patient_address" in columns:
        return

    with database_engine.begin() as connection:
        connection.execute(
            text(
                "ALTER TABLE appointments "
                "ADD COLUMN patient_address TEXT NOT NULL DEFAULT ''"
            )
        )


DATABASE_URL = normalize_database_url(
    os.getenv("DATABASE_URL", "sqlite:///./doctor_appointments.db")
)
engine_options = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_options)

# Create database session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base class for database models
Base = declarative_base()


# Database dependency for FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
