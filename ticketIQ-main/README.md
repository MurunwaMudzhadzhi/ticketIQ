# TicketIQ Enterprise

AI-Powered Smart Ticketing Platform — Next.js + FastAPI + SQLite

---

## ✅ FIXED ISSUES

The original project had these problems that are now resolved:

1. **Windows node_modules** — were compiled for Windows, won't work on other OS. Delete and reinstall.
2. **Missing `.env` files** — both `frontend/.env.local` and `backend/.env` were absent.
3. **Missing `node_modules`** — `npm install` was never run on your machine.
4. **Missing database** — `ticketiq.db` with demo data is now auto-created on first run.

---

## 🚀 HOW TO RUN IN VS CODE

Open the **ticketiq.code-workspace** file in VS Code (File → Open Workspace from File).

### Terminal 1 — Backend

```
cd backend
start.bat
```

The API will be at: http://localhost:8000  
Swagger docs: http://localhost:8000/api/v1/docs

### Terminal 2 — Frontend

```
cd frontend
start.bat
```

The app will be at: **http://localhost:3000**

---

## 🔑 Demo Login Accounts

| Role | Email | Password |
|------|-------|----------|
| **Admin** | admin@ticketiq.com | Admin@1234 |
| **AI Intern** (HR agent) | ai.intern@ticketiq.com | Agent@1234 |
| **IT Support Technician** | it.agent@ticketiq.com | Agent@1234 |
| **Junior Operations** | ops.agent@ticketiq.com | Agent@1234 |
| **Employee** (HR dept) | employee@ticketiq.com | Employee@1234 |
| **Employee** (IT dept) | sarah.k@ticketiq.com | Employee@1234 |
| **Employee** (Finance) | tom.w@ticketiq.com | Employee@1234 |
| **Employee** (Operations) | nina.p@ticketiq.com | Employee@1234 |

---

## 🤖 GROQ AI Setup (Optional)

Without a key the app uses smart keyword-based routing — everything still works.

To enable real AI classification:
1. Get a free API key at https://console.groq.com
2. Open `backend/.env`
3. Set `GROQ_API_KEY=gsk_your_key_here`
4. Restart the backend

---

## 🛠 Manual Setup (if start.bat doesn't work)

### Backend
```bash
cd backend
pip install -r requirements.txt
cd ..
python scripts/seed_data.py     # only needed once
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## 📁 Project Structure

```
ticketIQ-main/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   auth, tickets, analytics, admin
│   │   ├── core/               config.py, deps.py
│   │   ├── db/                 session.py
│   │   ├── models/             models.py
│   │   └── services/           ticket_service, groq_service, auth_service
│   ├── .env                    ← created for you
│   ├── start.bat               ← run this on Windows
│   └── requirements.txt
│
├── frontend/
│   ├── src/app/                Next.js App Router pages
│   ├── src/components/         shared layout, UI components
│   ├── src/stores/             Zustand auth store
│   ├── src/lib/                Axios API client
│   ├── .env.local              ← created for you
│   ├── start.bat               ← run this on Windows
│   └── package.json
│
├── scripts/
│   └── seed_data.py            Database seeder
│
└── ticketiq.code-workspace     ← Open this in VS Code
```
