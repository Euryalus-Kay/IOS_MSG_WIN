#!/bin/bash
# ═══════════════════════════════════════════
#  iMessage Bridge — Background Daemon Setup
#  Auto-start server on login
# ═══════════════════════════════════════════

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.imessage.bridge"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
NODE_PATH=$(which node)
SERVER_PATH="$SCRIPT_DIR/mac-server/server.js"
LOG_DIR="$SCRIPT_DIR/mac-server/logs"

echo ""
echo -e "${BLUE}${BOLD}  iMessage Bridge — Background Daemon Setup${NC}"
echo -e "  ─────────────────────────────────────────"
echo ""

# ─── Check macOS ───
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}  This must be run on macOS.${NC}"
    exit 1
fi

# ─── Check if already installed ───
if [ -f "$PLIST_PATH" ]; then
    echo -e "  ${YELLOW}Daemon already installed.${NC}"
    echo ""
    read -p "  Reinstall? [Y/n] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo ""
        echo -e "  ${BOLD}Commands:${NC}"
        echo -e "    Start:   ${BLUE}launchctl load $PLIST_PATH${NC}"
        echo -e "    Stop:    ${BLUE}launchctl unload $PLIST_PATH${NC}"
        echo -e "    Status:  ${BLUE}launchctl list | grep imessage${NC}"
        echo -e "    Logs:    ${BLUE}tail -f $LOG_DIR/server.log${NC}"
        echo ""
        exit 0
    fi
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# ─── Create log directory ───
mkdir -p "$LOG_DIR"

# ─── Create LaunchAgent plist ───
echo -e "  ${BLUE}Creating LaunchAgent...${NC}"

cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${SERVER_PATH}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}/mac-server</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/server.log</string>

    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/server-error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$(dirname $NODE_PATH)</string>
    </dict>
</dict>
</plist>
PLIST

echo -e "  ${GREEN}✓${NC} LaunchAgent created at $PLIST_PATH"

# ─── Load the daemon ───
echo -e "  ${BLUE}Loading daemon...${NC}"
launchctl load "$PLIST_PATH"
echo -e "  ${GREEN}✓${NC} Daemon loaded and running"

# ─── Verify ───
sleep 2
if launchctl list | grep -q "$PLIST_NAME"; then
    echo -e "  ${GREEN}✓${NC} Server is running in background"
else
    echo -e "  ${YELLOW}⚠${NC} Daemon may not have started. Check logs:"
    echo -e "    ${BLUE}tail -f $LOG_DIR/server.log${NC}"
fi

echo ""
echo -e "  ${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo -e "  ${GREEN}${BOLD}  Daemon Setup Complete!${NC}"
echo -e "  ${GREEN}${BOLD}═══════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}The iMessage Bridge server will now:${NC}"
echo -e "  • Start automatically when you log in"
echo -e "  • Restart if it crashes"
echo -e "  • Run silently in the background"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "    Stop:     ${BLUE}launchctl unload $PLIST_PATH${NC}"
echo -e "    Start:    ${BLUE}launchctl load $PLIST_PATH${NC}"
echo -e "    Status:   ${BLUE}launchctl list | grep imessage${NC}"
echo -e "    Logs:     ${BLUE}tail -f $LOG_DIR/server.log${NC}"
echo -e "    Remove:   ${BLUE}launchctl unload $PLIST_PATH && rm $PLIST_PATH${NC}"
echo ""
