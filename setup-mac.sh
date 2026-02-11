#!/bin/bash
# ─── iMessage Bridge - Mac Server Setup ───
# Run this on your Mac to set up the server component

echo "╔══════════════════════════════════════════╗"
echo "║   iMessage Bridge - Mac Server Setup     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed."
    echo "Install it from: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "[OK] Node.js $NODE_VERSION found"

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "[ERROR] This script must be run on macOS"
    exit 1
fi
echo "[OK] Running on macOS"

# Check for chat.db
CHAT_DB="$HOME/Library/Messages/chat.db"
if [ ! -f "$CHAT_DB" ]; then
    echo "[ERROR] iMessage database not found at $CHAT_DB"
    echo "Make sure you have Messages app set up on this Mac"
    exit 1
fi
echo "[OK] iMessage database found"

# Install dependencies
echo ""
echo "Installing server dependencies..."
cd "$(dirname "$0")/mac-server"
npm install

if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install dependencies"
    exit 1
fi
echo "[OK] Dependencies installed"

# Remind about Full Disk Access
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  IMPORTANT: Full Disk Access Required                      ║"
echo "║                                                            ║"
echo "║  The server needs access to the iMessage database.         ║"
echo "║  Go to:                                                    ║"
echo "║    System Settings > Privacy & Security > Full Disk Access ║"
echo "║  Then add Terminal (or iTerm/your terminal app)            ║"
echo "║                                                            ║"
echo "║  You may also need to grant access to the Contacts app     ║"
echo "║  for contact name resolution.                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "To start the server, run:"
echo "  cd mac-server && npm start"
echo ""
echo "The server will display its network address."
echo "Enter that address in the Windows client to connect."
