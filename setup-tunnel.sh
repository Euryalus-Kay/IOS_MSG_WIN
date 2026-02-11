#!/bin/bash
# ═══════════════════════════════════════════
#  iMessage Bridge — Cross-Network Tunnel Setup
#  Access your Mac server from ANY network
# ═══════════════════════════════════════════

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

echo ""
echo -e "${BLUE}${BOLD}  iMessage Bridge — Tunnel Setup${NC}"
echo -e "  ────────────────────────────────"
echo ""
echo -e "  This will let you access your iMessage server"
echo -e "  from ANY WiFi network (not just your home)."
echo ""

# ─── Check macOS ───
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}  This must be run on macOS.${NC}"
    exit 1
fi

# ─── Check/Install cloudflared ───
if ! command -v cloudflared &> /dev/null; then
    echo -e "  ${YELLOW}cloudflared not found. Installing...${NC}"
    if command -v brew &> /dev/null; then
        brew install cloudflared
        echo -e "  ${GREEN}✓${NC} cloudflared installed"
    else
        echo -e "  ${RED}Please install Homebrew first, then run:${NC}"
        echo -e "  ${BOLD}brew install cloudflared${NC}"
        echo ""
        echo -e "  Or download from: ${BLUE}https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/${NC}"
        exit 1
    fi
else
    echo -e "  ${GREEN}✓${NC} cloudflared found"
fi

# ─── Start tunnel ───
echo ""
echo -e "  ${BLUE}Starting Cloudflare Quick Tunnel...${NC}"
echo -e "  ${YELLOW}(No account needed — uses free temporary tunnel)${NC}"
echo ""

# Start the tunnel and capture the URL
cloudflared tunnel --url http://localhost:3782 2>&1 | while read line; do
    # Look for the tunnel URL
    if echo "$line" | grep -q "trycloudflare.com"; then
        URL=$(echo "$line" | grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
        if [ ! -z "$URL" ]; then
            echo ""
            echo -e "  ${GREEN}${BOLD}═══════════════════════════════════════${NC}"
            echo -e "  ${GREEN}${BOLD}  Tunnel is LIVE!${NC}"
            echo -e "  ${GREEN}${BOLD}═══════════════════════════════════════${NC}"
            echo ""
            echo -e "  ${BOLD}Your public URL:${NC}"
            echo -e "  ${BLUE}${BOLD}${URL}${NC}"
            echo ""
            echo -e "  Enter this URL in your Windows client to connect"
            echo -e "  from ANY network — no same-WiFi needed!"
            echo ""
            echo -e "  ${YELLOW}Press Ctrl+C to stop the tunnel${NC}"
            echo ""
        fi
    fi
    echo "  $line"
done
