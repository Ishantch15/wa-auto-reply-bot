#!/bin/bash
echo ""
echo " =========================================="
echo "  WhatsApp Auto-Reply Bot"
echo " =========================================="
echo ""

# Install if node_modules missing
if [ ! -d "node_modules" ]; then
    echo " Installing packages... (one-time setup)"
    echo ""
    npm install
    echo ""
fi

echo " Starting bot..."
echo " Dashboard: http://localhost:3000"
echo ""
echo " Open the link above in your browser, then scan QR with WhatsApp."
echo " Press Ctrl+C to stop."
echo ""

node index.js
