# Nudge — reminder alarm app

React (Vite) + FastAPI + SQLite. When a reminder is due, the screen is taken over by a blinking
alarm with a looping beep and the description read aloud. Free to run and deploy.

## Run in VS Code (two terminals: Terminal > New Terminal, then split)

**Terminal 1 — backend**
```
cd backend
python -m venv .venv
# Windows:   .venv\Scripts\activate
# Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env        # Mac/Linux: cp .env.example .env
uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend**
```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, create an account, click **Switch on alarms**, add a reminder
for 1-2 minutes from now, and keep the tab open.

## Google login (optional)
1. Google Cloud Console > APIs & Services > Credentials > Create OAuth client ID (Web).
2. Add `http://localhost:5173` under Authorized JavaScript origins.
3. Put the client ID in `backend/.env` (GOOGLE_CLIENT_ID) and `frontend/.env` (VITE_GOOGLE_CLIENT_ID).
   Copy `frontend/.env.example` to `frontend/.env`. Restart both servers.

## Notes
- The alarm rings only while the tab is open. Browsers do not allow sound or a screen takeover from a closed page.
- Times are stored in UTC and shown in your local time.
- Set a real `JWT_SECRET` in `backend/.env` before deploying.
