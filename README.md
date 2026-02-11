# iMessage Bridge for Windows

Access your iMessages from Windows using your Mac as a bridge server. Read conversations, send replies, view group chats, search messages, and see contact profiles — all from your Windows PC.

> **Personal use only.** This project reads your local iMessage database via your own Mac. It does not reverse-engineer Apple's protocols and is not intended for commercial distribution.

## How It Works

```
┌──────────────┐         Local Network         ┌──────────────────┐
│  Mac Server  │ ◄──── HTTP + WebSocket ────► │  Windows Client  │
│              │                               │   (Electron App) │
│ - Reads      │         Port 3782             │                  │
│   chat.db    │                               │ - iMessage UI    │
│ - Contacts   │                               │ - Real-time      │
│ - Send via   │                               │ - Search         │
│   AppleScript│                               │ - Group chats    │
└──────────────┘                               └──────────────────┘
```

## Features

- **All conversations** — View every iMessage and SMS conversation
- **Read & reply** — Send messages back through your Mac's Messages app
- **Group chats** — Full group chat support with member names
- **Contact resolution** — Maps phone numbers/emails to contact names
- **Image attachments** — View images inline
- **Search** — Search across all messages
- **Real-time updates** — New messages appear instantly via WebSocket
- **Conversation details** — View participants and chat info

## Setup

### Prerequisites

- A Mac with iMessage signed in (always on, same network as your Windows PC)
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

The server will display its local network IP address (e.g., `http://192.168.1.42:3782`). Note this address.

### 2. Windows Client Setup

```bash
# On your Windows PC
cd windows-client
npm install
npm start
```

Enter the Mac server's network address when prompted.

### 3. Build Windows Executable

```bash
cd windows-client
npm run build
```

This creates a standalone `.exe` installer in `windows-client/dist/`.

## Project Structure

```
├── mac-server/              # Runs on your Mac
│   ├── server.js            # Express + Socket.IO server
│   └── lib/
│       ├── message-db.js    # SQLite reader for chat.db
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
└── README.md
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/conversations` | List all conversations |
| GET | `/api/conversations/:id/messages` | Get messages (supports `?limit=` and `?offset=`) |
| GET | `/api/conversations/:id` | Conversation details & participants |
| GET | `/api/contacts` | Get macOS contacts |
| GET | `/api/search?q=` | Search all messages |
| POST | `/api/send` | Send a message (`{recipient, message}` or `{isGroup, groupName, message}`) |
| GET | `/api/attachment-by-path?path=` | Serve attachment file |
| GET | `/api/info` | Server info & network addresses |
| WebSocket | `new-messages` | Real-time new message events |

## Troubleshooting

### "authorization denied" or "Operation not permitted"
Grant **Full Disk Access** to your terminal app in System Settings > Privacy & Security.

### Contacts not showing names
Grant **Contacts** access to your terminal app in System Settings > Privacy & Security.

### Can't connect from Windows
- Ensure both devices are on the same network
- Check your Mac's firewall allows port 3782
- Try the IP address shown by the server, not `localhost`

### Messages not sending
- Make sure the Messages app is running on your Mac
- AppleScript automation must be allowed for your terminal

## Security Notes

- The server binds to `0.0.0.0` — accessible to any device on your local network
- No authentication is included — only use on trusted home networks
- Messages are transmitted in plaintext over your local network
- For added security, consider adding a shared secret/token to the server

## License

MIT — Personal use only. Not affiliated with Apple.
