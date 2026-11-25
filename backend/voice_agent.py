import os
import re
from datetime import datetime

from dotenv import load_dotenv

from appointment_service import book_appointment as book_appointment_record
from appointment_service import cancel_appointment as cancel_appointment_record
from appointment_service import check_doctor_availability as find_available_slots
from database import SessionLocal
from models import Appointment
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.base_transport import TransportParams
from pipecat.workers.runner import WorkerRunner

load_dotenv()

SYSTEM_INSTRUCTION = """\
You are CareConnect, a warm and concise doctor appointment assistant. You can
check doctor availability, book appointments, and cancel appointments using
your tools. Do not give medical advice.

For a booking, collect the patient's name, requested specialty or doctor, date,
time, full street address, and the 10-digit phone number they speak. Read every
digit of the phone number back and ask the caller to confirm it. Read the
address back and ask the caller to confirm it too. Do not call the booking tool
until the caller clearly confirms both details and has chosen an available
slot. Never infer, invent, or use caller ID for a phone number.

For a cancellation, ask for the phone number, read it back digit by digit, and
wait for confirmation before looking up appointments. If there are multiple
appointments, ask which one they mean. Read the selected appointment details
back and wait for an explicit cancellation confirmation before cancelling it.
Use only the confirmed spoken phone number to find or cancel the appointment.

Keep replies short and natural for speech. Say dates and times clearly. If a
tool reports an error or no matching record, explain that honestly.
"""


def valid_phone_number(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9]{10}", value.strip()))


async def run_bot(runner_args: RunnerArguments):
    if not os.getenv("GOOGLE_API_KEY"):
        raise RuntimeError("GOOGLE_API_KEY is required to start the voice agent.")
    if not os.getenv("ELEVENLABS_API_KEY"):
        raise RuntimeError("ELEVENLABS_API_KEY is required to start the voice agent.")

    async def check_doctor_availability(
        params: FunctionCallParams,
        specialization: str,
        appointment_date: str,
    ):
        """Find available appointment times for a specialty and date.

        Args:
            specialization: The doctor's specialty, such as Cardiology.
            appointment_date: The requested date in YYYY-MM-DD format.
        """
        try:
            requested_date = datetime.strptime(appointment_date, "%Y-%m-%d").date()
        except ValueError:
            await params.result_callback(
                {"success": False, "message": "Use a date in YYYY-MM-DD format."}
            )
            return

        if requested_date < datetime.now().date():
            await params.result_callback(
                {"success": False, "message": "The requested date is in the past."}
            )
            return

        with SessionLocal() as db:
            slots = find_available_slots(db, specialization.strip(), requested_date)
        await params.result_callback({"success": True, "doctors": slots})

    async def book_appointment(
        params: FunctionCallParams,
        patient_name: str,
        phone_number: str,
        patient_address: str,
        doctor_id: int,
        appointment_time: str,
    ):
        """Book an available appointment for the caller.

        Args:
            patient_name: The name the caller provided for the appointment.
            phone_number: The confirmed 10-digit phone number spoken by the caller.
            patient_address: The confirmed full street address provided by the caller.
            doctor_id: The ID of the doctor whose slot the caller selected.
            appointment_time: The selected local appointment time in ISO 8601 format.
        """
        phone = phone_number.strip()
        if not valid_phone_number(phone):
            await params.result_callback(
                {"success": False, "message": "A confirmed 10-digit phone number is required."}
            )
            return
        if not patient_name.strip():
            await params.result_callback(
                {"success": False, "message": "The patient's name is required."}
            )
            return
        if not patient_address.strip():
            await params.result_callback(
                {"success": False, "message": "The patient's address is required."}
            )
            return
        try:
            selected_time = datetime.fromisoformat(
                appointment_time.strip().replace("Z", "+00:00")
            ).replace(tzinfo=None)
        except ValueError:
            await params.result_callback(
                {"success": False, "message": "The selected appointment time is invalid."}
            )
            return

        with SessionLocal() as db:
            result = book_appointment_record(
                db,
                patient_name.strip(),
                phone,
                patient_address.strip(),
                doctor_id,
                selected_time,
            )
        await params.result_callback(result)

    async def cancel_appointment(
        params: FunctionCallParams,
        phone_number: str,
        appointment_id: int = 0,
    ):
        """Find or cancel the caller's appointment using their confirmed phone number.

        Args:
            phone_number: The confirmed 10-digit phone number spoken by the caller.
            appointment_id: The appointment ID to cancel after the caller confirms; use 0 to look up appointments.
        """
        phone = phone_number.strip()
        if not valid_phone_number(phone):
            await params.result_callback(
                {"success": False, "message": "A confirmed 10-digit phone number is required."}
            )
            return

        with SessionLocal() as db:
            if appointment_id <= 0:
                appointments = (
                    db.query(Appointment)
                    .filter(
                        Appointment.phone_number == phone,
                        Appointment.status == "booked",
                    )
                    .order_by(Appointment.appointment_time)
                    .all()
                )
                matches = [
                    {
                        "appointment_id": appointment.id,
                        "doctor_name": appointment.doctor.name,
                        "appointment_time": appointment.appointment_time.strftime(
                            "%A, %d %B %Y at %I:%M %p"
                        ),
                    }
                    for appointment in appointments
                ]
                if not matches:
                    result = {
                        "success": False,
                        "message": "No active appointments were found for that phone number.",
                    }
                else:
                    result = {"success": True, "appointments": matches}
            else:
                result = cancel_appointment_record(db, appointment_id, phone)

        await params.result_callback(result)

    stt = ElevenLabsRealtimeSTTService(api_key=os.environ["ELEVENLABS_API_KEY"])
    tts = ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        settings=ElevenLabsTTSService.Settings(
            voice=os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
        ),
    )
    llm = GoogleLLMService(
        api_key=os.environ["GOOGLE_API_KEY"],
        settings=GoogleLLMService.Settings(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            system_instruction=SYSTEM_INSTRUCTION,
            temperature=0.3,
        ),
    )

    context = LLMContext(
        tools=[
            check_doctor_availability,
            book_appointment,
            cancel_appointment,
        ]
    )
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    transport = await create_transport(
        runner_args,
        {
            "webrtc": lambda: TransportParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
            ),
        },
    )
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
    )
    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(worker)

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        context.add_message(
            {
                "role": "developer",
                "content": "Greet the caller and ask how you can help with an appointment.",
            }
        )
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        await runner.cancel()

    await runner.run()


async def bot(runner_args: RunnerArguments):
    await run_bot(runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
