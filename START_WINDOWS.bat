@echo off
echo.
echo  ==========================================
echo   WhatsApp Auto-Reply Bot
echo  ==========================================
echo.

:: Check if node_modules exists
if not exist "node_modules" (
    echo  Installing packages... (one-time setup)
    echo.
    npm install
    echo.
)

echo  Starting bot...
echo  Dashboard: http://localhost:3000
echo.
echo  Open the link above in your browser, then scan QR with WhatsApp.
echo  Press Ctrl+C to stop.
echo.

node index.js

pause
