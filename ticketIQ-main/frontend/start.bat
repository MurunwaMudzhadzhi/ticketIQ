@echo off
echo ========================================
echo  TicketIQ Enterprise - Frontend
echo ========================================
cd /d "%~dp0"

REM Check Node
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from nodejs.org
    pause
    exit /b 1
)

REM Install dependencies if node_modules missing
if not exist node_modules (
    echo [1/2] Installing npm packages...
    npm install
) else (
    echo [1/2] node_modules found - skipping install.
)

REM Start dev server
echo [2/2] Starting Next.js on http://localhost:3000
echo.
npm run dev
