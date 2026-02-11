# iMessage Bridge for Windows

Access your iMessages from Windows using your Mac as a bridge server. Read conversations, send replies, view group chats, search messages, and see contact profiles — all from your Windows PC.

> **Personal use only.** This project reads your local iMessage database via your own Mac. It does not reverse-engineer Apple's protocols and is not intended for commercial distribution.

## How It Works

```
┌──────────────┐     Local / Tunnel      ┌──────────────────┐
│  Mac Server  │ ◄──── HTTP + WS ────►   │  Windows Client  │
│              │                          │   (Electron App) │
│ - Reads      │      Port 3782          │                  │
│   chat.db    │   or Cloudflare URL     │ - iMessage UI    │
│ - Contacts   │                          │ - Real-time      │
│ - Send via   │                          │ - Reactions       │
│   AppleScript│                          │ - Search          │
└──────────────┘                          └──────────────────┘
```

## Features

- **All conversations** — View every iMessage and SMS conversation
- **Read & reply** — Send messages back through your Mac's Messages app
- **Group chats** — Full group chat support with member names
- **Tapback reactions** — See heart, thumbs up, laugh, and other reactions
- **Contact resolution** — Maps phone numbers/emails to contact names
- **Search by contact name** — Find conversations by searching contact names
- **Media attachments** — View images, play videos, and listen to audio inline
- **Link previews** — Clickable links with domain previews in messages
- **File attachments** — Color-coded file icons for PDFs, docs, zips, etc.
- **Search** — Search across all messages and contacts
- **Real-time updates** — New messages appear instantly via WebSocket
- **Saved connections** — Remember your server connections for quick reconnect
- **Connection code** — Server displays a 6-digit code for easy pairing
- **Cross-network access** — Use Cloudflare Tunnel to access from any WiFi
- **Background daemon** — Auto-start server on Mac login
- **Conversation details** — View participants and chat info

## Setup

### Prerequisites

- A Mac with iMessage signed in (always on)
- Node.js 18+ installed on the Mac
- Node.js 18+ installed on the Windows PC (for development) or just the built app

### 1. Mac Server Setup

```bash
# Clone the repo on your Mac
git clone https://github.com/Euryalus-Kay/IOS_MSG_WIN.git
cd IOS_MSG_WIN

# Run setup
chmod +x setup-mac.sh
./setup-mac.sh

# Grant Full Disk Access to Terminal:
#   System Settings > Privacy & Security > Full Disk Access > Add Terminal

# Start the server
cd mac-server
npm start
```

The server will display its local network IP address (e.g., `http://192.168.1.42:3782`) and a **6-digit connection code**.

### 2. Windows Client Setup

```bash
# On your Windows PC
cd windows-client
npm install
npm start
```

Enter the Mac server's network address when prompted. Your connection is automatically saved for next time.

### 3. Build Windows Executable

```bash
cd windows-client
npm run build
```

This creates a standalone `.exe` installer in `windows-client/dist/`.

### 4. Background Daemon (Optional)

Run the server automatically on Mac login:

```bash
chmod +x setup-daemon.sh
./setup-daemon.sh
```

The server will auto-start on login and restart if it crashes. Useful commands:
- **Stop:** `launchctl unload ~/Library/LaunchAgents/com.imessage.bridge.plist`
- **Start:** `launchctl load ~/Library/LaunchAgents/com.imessage.bridge.plist`
- **Logs:** `tail -f mac-server/logs/server.log`

### 5. Cross-Network Access (Optional)

Access your messages from any WiFi network using Cloudflare Tunnel:

```bash
chmod +x setup-tunnel.sh
./setup-tunnel.sh
```

This creates a free temporary tunnel URL (e.g., `https://random-name.trycloudflare.com`) that you can use from anywhere. Enter this URL in the Windows client instead of the local IP.

> **Note:** Requires `cloudflared` — the script will install it via Homebrew if needed.

## Project Structure

```
├── mac-server/              # Runs on your Mac
│   ├── server.js            # Express + Socket.IO server
│   └── lib/
│       ├── message-db.js    # SQLite reader for chat.db + reactions
│       ├── contacts.js      # macOS Contacts integration
│       ├── sender.js        # AppleScript message sender
│       └── attachments.js   # Attachment file server
├── windows-client/          # Runs on Windows
│   ├── main.js              # Electron main process
│   └── src/
│       ├── index.html       # App shell
│       ├── app.js           # Client application logic
│       └── styles/
│           └── app.css      # iMessage-style UI
├── setup-mac.sh             # Mac setup script
├── setup-daemon.sh          # Background daemon setup
├── setup-tunnel.sh          # Cross-network tunnel setup
└── README.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/conversations` | List all conversations |
| GET | `/api/conversations/:id/messages` | Get messages (supports `?limit=` and `?offset=`) |
| GET | `/api/conversations/:id` | Conversation details & participants |
| GET | `/api/conversations/:id/reactions` | Get tapback reactions for a conversation |
| GET | `/api/contacts` | Get macOS contacts |
| GET | `/api/search?q=` | Search all messages |
| POST | `/api/send` | Send a message (`{recipient, message}` or `{isGroup, groupName, message}`) |
| POST | `/api/verify-code` | Verify connection code (`{code}`) |
| GET | `/api/attachment-by-path?path=` | Serve attachment file |
| GET | `/api/info` | Server info, network addresses & connection code |
| WebSocket | `new-messages` | Real-time new message events |

## Troubleshooting

### "authorization denied" or "Operation not permitted"
Grant **Full Disk Access** to your terminal app in System Settings > Privacy & Security.

### Contacts not showing names
Grant **Contacts** access to your terminal app in System Settings > Privacy & Security.

### Can't connect from Windows
- Ensure both devices are on the same network (or use Cloudflare Tunnel)
- Check your Mac's firewall allows port 3782
- Try the IP address shown by the server, not `localhost`

### Messages not sending
- Make sure the Messages app is running on your Mac
- AppleScript automation must be allowed for your terminal

### Reactions not showing
- Reactions are loaded from the iMessage database and matched by message GUID
- Some very old messages may not have reaction data

## Security Notes

- The server binds to `0.0.0.0` — accessible to any device on your local network
- A 6-digit connection code is generated each time the server starts
- Messages are transmitted in plaintext over your local network
- When using Cloudflare Tunnel, traffic is encrypted via HTTPS
- For added security on local network, consider adding a shared secret/token

## License

MIT — Personal use only. Not affiliated with Apple.
