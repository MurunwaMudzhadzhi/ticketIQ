@echo off
echo ========================================
echo  TicketIQ Enterprise - Backend
echo ========================================
cd /d "%~dp0"

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install from python.org
    pause
    exit /b 1
)

REM Install / update dependencies
echo [1/3] Installing Python dependencies...
pip install -r requirements.txt -q

REM Seed the database if it doesn't exist
if not exist ticketiq.db (
    echo [2/3] First run - seeding database with demo data...
    python ..\scripts\seed_data.py
) else (
    echo [2/3] Database already exists - skipping seed.
)

REM Start the server
echo [3/3] Starting FastAPI server on http://localhost:8000
echo [DOCS] http://localhost:8000/api/v1/docs
echo.
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
