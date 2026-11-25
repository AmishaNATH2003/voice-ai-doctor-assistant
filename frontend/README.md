# CareConnect dashboard

The React/Vite dashboard talks to the FastAPI service at `http://localhost:8000`
and the Pipecat SmallWebRTC agent at `http://localhost:7860/api/offer` by
default.

```powershell
npm install
npm run dev
```

Set `VITE_API_URL` or `VITE_BOT_URL` in a local `.env` file to use different
service URLs. See [`.env.example`](./.env.example) and the [project README](../README.md)
for backend setup and the complete voice pipeline.
