#!/bin/bash
# ═══════════════════════════════════════════
#  iMessage Bridge — One-Click Mac Setup
# ═══════════════════════════════════════════

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

echo ""
echo -e "${GREEN}${BOLD}  iMessage Bridge — Mac Server Setup${NC}"
echo -e "  ─────────────────────────────────────"
echo ""

# ─── Check macOS ───
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}  This must be run on macOS.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Running on macOS"

# ─── Check Node.js ───
if ! command -v node &> /dev/null; then
    echo -e "${RED}  Node.js not found.${NC}"
    echo -e "  ${YELLOW}Installing via Homebrew...${NC}"
    if command -v brew &> /dev/null; then
        brew install node
    else
        echo -e "  ${RED}Please install Node.js from https://nodejs.org/${NC}"
        exit 1
    fi
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node --version)"

# ─── Check chat.db ───
CHAT_DB="$HOME/Library/Messages/chat.db"
if [ ! -f "$CHAT_DB" ]; then
    echo -e "  ${RED}✗ iMessage database not found${NC}"
    echo -e "    Make sure Messages app is set up on this Mac"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} iMessage database found"

# ─── Install dependencies ───
echo ""
echo -e "  ${BLUE}Installing dependencies...${NC}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/mac-server"
npm install --silent 2>&1 | tail -1
echo -e "  ${GREEN}✓${NC} Dependencies installed"

# ─── Test database access ───
echo ""
echo -e "  ${BLUE}Testing database access...${NC}"
if node -e "
const Database = require('better-sqlite3');
try {
  const db = new Database('$CHAT_DB', { readonly: true });
  const count = db.prepare('SELECT COUNT(*) as c FROM message').get();
  console.log('MSGCOUNT:' + count.c);
  db.close();
} catch(e) {
  console.log('ERROR:' + e.message);
  process.exit(1);
}
" 2>/dev/null | grep -q "MSGCOUNT:"; then
    MSG_COUNT=$(node -e "
const Database = require('better-sqlite3');
const db = new Database('$CHAT_DB', { readonly: true });
const count = db.prepare('SELECT COUNT(*) as c FROM message').get();
console.log(count.c);
db.close();
" 2>/dev/null)
    echo -e "  ${GREEN}✓${NC} Database access OK — ${MSG_COUNT} messages found"
else
    echo -e "  ${RED}✗ Cannot access iMessage database${NC}"
    echo ""
    echo -e "  ${YELLOW}${BOLD}You need to grant Full Disk Access:${NC}"
    echo ""
    echo -e "  1. Open ${BOLD}System Settings${NC}"
    echo -e "  2. Go to ${BOLD}Privacy & Security → Full Disk Access${NC}"
    echo -e "  3. Click ${BOLD}+${NC} and add your terminal app:"
    echo -e "     • Terminal.app (in /Applications/Utilities/)"
    echo -e "     • or iTerm, Warp, etc."
    echo -e "  4. ${BOLD}Restart your terminal${NC} and run this script again"
    echo ""
    echo -e "  ${YELLOW}Opening System Settings...${NC}"
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" 2>/dev/null || true
    exit 1
fi

# ─── Get network address ───
IP_ADDR=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo ""
echo -e "  ${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo -e "  ${GREEN}${BOLD}  Setup Complete!${NC}"
echo -e "  ${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}To start the server:${NC}"
echo ""
echo -e "    cd $SCRIPT_DIR/mac-server && npm start"
echo ""
echo -e "  ${BOLD}On your Windows PC, connect to:${NC}"
echo ""
echo -e "    ${BLUE}${BOLD}http://${IP_ADDR}:3782${NC}"
echo ""
echo -e "  ${YELLOW}Tip: Keep the Mac awake and connected to the same${NC}"
echo -e "  ${YELLOW}WiFi network as your Windows PC.${NC}"
echo ""

# ─── Ask to start now ───
read -p "  Start the server now? [Y/n] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo -e "  Run ${BOLD}cd mac-server && npm start${NC} when ready."
else
    echo ""
    cd "$SCRIPT_DIR/mac-server"
    node server.js
fi
