# CareConnect — Voice Doctor Appointment Assistant

CareConnect is a browser-based voice assistant for checking doctor availability,
booking appointments, and cancelling an existing appointment. The app uses
SQLite-backed sample doctors and appointments so the complete flow can be run
locally.

## Stack and pipeline

- **Voice orchestration:** Pipecat, using a SmallWebRTC transport between the
  browser and the Python agent.
- **Speech recognition and speech generation:** ElevenLabs real-time STT and
  TTS.
- **Conversation and tool selection:** Google Gemini through Pipecat's
  `GoogleLLMService`.
- **Voice activity detection:** Silero VAD.
- **Data and dashboard API:** FastAPI and SQLAlchemy with SQLite.
- **Dashboard:** React and Vite, using Pipecat's JavaScript client SDK.

Audio travels from the browser microphone through WebRTC to ElevenLabs STT,
then Pipecat sends the transcript and appointment tools to Gemini. Tool calls
read and update the same SQLite database as the dashboard API. Gemini's spoken
reply is synthesized by ElevenLabs and streamed back through WebRTC. The agent
is instructed to repeat and confirm the caller's spoken phone number before
booking or cancellation. Booking also requires a full street address; the agent
reads it back for confirmation and stores it with the appointment. The phone
number—not caller ID, login, or OTP—is used to look up appointments.

## Run locally

Use Python 3.11–3.14 and Node.js 18 or newer. From the repository root, open
three terminals.

### 1. Configure the voice agent

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Add your `GOOGLE_API_KEY` and `ELEVENLABS_API_KEY` to `backend/.env`. The
ElevenLabs voice ID and Gemini model can also be changed there.
Create your own keys in [Google AI Studio](https://aistudio.google.com/apikey)
and [ElevenLabs](https://elevenlabs.io/app/settings/api-keys). Provider accounts
and credentials are user-owned; keep real keys in the ignored `.env` file and
never paste them into source code or commit them.

### 2. Start the dashboard API

In the first terminal, from `backend/`:

```powershell
uvicorn main:app --reload --port 8000
```

### 3. Start the Pipecat agent

In the second terminal, also from `backend/` and with the virtual environment
activated:

```powershell
python voice_agent.py
```

The local SmallWebRTC agent listens at `http://localhost:7860`.

### 4. Start the dashboard

In the third terminal, from `frontend/`:

```powershell
npm install
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`), choose **Try a call**, and
allow microphone access. API and agent URLs can be overridden with
`VITE_API_URL` and `VITE_BOT_URL` in a frontend `.env` file; see
`frontend/.env.example`.

## Deploy with Render and Vercel

The root `render.yaml` defines a Render Blueprint with a PostgreSQL database,
the FastAPI service, and the Pipecat WebRTC agent. `frontend/vercel.json`
configures the Vite dashboard as a Vercel single-page app.

1. Create a GitHub repository and push this project. Do not add either `.env`
   file; the root `.gitignore` excludes them.
2. Import the repository in Vercel with `frontend/` as the **Root Directory**
   and deploy once to get its production domain.
3. In Render, create a **Blueprint** from the repository root and apply
   `render.yaml`. Set `CORS_ORIGINS` and `PIPECAT_ALLOWED_ORIGINS` to the exact
   Vercel production origin, for example `https://your-project.vercel.app`.
   Enter `GOOGLE_API_KEY` and `ELEVENLABS_API_KEY` as Render environment
   secrets; do not put them in GitHub or Vercel.
4. Copy the deployed Render API URL and agent URL into Vercel's production
   environment variables:
   - `VITE_API_URL=https://<your-api-service>.onrender.com`
   - `VITE_BOT_URL=https://<your-agent-service>.onrender.com/api/offer`
   Then redeploy the Vercel project.
5. Test `/health` on the API, then test a full booking call from the deployed
   dashboard. If WebRTC cannot establish media from your network, configure a
   TURN service in Render's `PIPECAT_ICE_SERVERS`, for example as a JSON array
   containing the TURN URL, username, and credential. Use the values from your
   TURN provider and keep them out of the frontend.

The Blueprint uses Render's free plans to avoid creating paid resources by
default. Free web services sleep after 15 minutes without traffic and can take
about a minute to wake; the dashboard allows up to 75 seconds for the voice
agent's initial connection. Free Postgres expires 30 days after creation, has
no backups, and is deleted after its 14-day upgrade grace period. Use paid,
always-on services and persistent database backups for a production deployment.
The free configuration is suitable for a short assignment demo, not patient
records or long-term storage.

## Using the assistant

Ask for a specialty and a date to hear available slots. To book, give the
patient name, full street address, and phone number; confirm the address and
number when they are read back, then choose an available doctor and time. To
cancel, provide and confirm the same phone number; if more than one active
appointment is found, specify which one and confirm the cancellation.

The sample data has four fixed appointment times (10:00, 11:00, 14:00, and
15:00). Doctors are only available on the weekdays listed in the database.
Phone numbers use the sample application's 10-digit format.
The dashboard refreshes appointment and slot data while a voice call is active,
so bookings and cancellations made by the assistant appear without a page reload.
The address is stored with the booking but is not included in the appointment
list response.

This is an assignment demo, not a production patient-record system. It has no
user authentication or access controls and sends voice conversation data to
the configured AI providers. Use synthetic data only; do not enter real patient
addresses or medical information.

## Recording the demo

Start the API, agent, and dashboard, then record a short browser walkthrough:
start a call, say a phone number, ask for a doctor's availability, confirm a
slot, and show the new appointment in the dashboard. Do not include API keys in
the recording.

## Notes

The root `README.md` describes the implementation and setup. API keys belong in
`backend/.env` and must not be committed. The local database is
`backend/doctor_appointments.db`; the API and voice agent should both be started
from `backend/` so they share that file.
