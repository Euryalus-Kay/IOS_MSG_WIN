const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { MessageDB } = require('./lib/message-db');
const { ContactsManager } = require('./lib/contacts');
const { AppleScriptSender } = require('./lib/sender');
const { AttachmentServer } = require('./lib/attachments');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// ─── CONNECTION CODE SYSTEM ───
// Generate a simple 6-digit connection code
const CONNECTION_CODE = crypto.randomInt(100000, 999999).toString();
console.log(`\n[CONNECTION CODE] ${CONNECTION_CODE}\n`);

const DB_PATH = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const ATTACHMENTS_BASE = path.join(os.homedir(), 'Library', 'Messages', 'Attachments');

let messageDB;
let contactsManager;
let sender;
let attachmentServer;

try {
  messageDB = new MessageDB(DB_PATH);
  contactsManager = new ContactsManager();
  sender = new AppleScriptSender();
  attachmentServer = new AttachmentServer(ATTACHMENTS_BASE);
  console.log('[OK] iMessage database connected');
} catch (err) {
  console.error('[ERROR] Failed to connect to iMessage database.');
  console.error('Make sure Terminal/Node has Full Disk Access in System Preferences > Privacy & Security > Full Disk Access');
  console.error(err.message);
  process.exit(1);
}

// ─── CONTACT LOOKUP HELPERS ───
function buildContactLookup(contacts) {
  const map = {};
  for (const contact of contacts) {
    if (!contact.name) continue;
    for (const phone of contact.phones) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 7) {
        map[digits] = contact.name;
        map[digits.slice(-10)] = contact.name;
        map[digits.slice(-7)] = contact.name;
      }
      // Also store with + prefix as-is (for exact match)
      const cleaned = phone.replace(/[\s()-]/g, '');
      map[cleaned] = contact.name;
    }
    for (const email of contact.emails) {
      map[email.toLowerCase()] = contact.name;
    }
  }
  return map;
}

function lookupName(identifier, lookup) {
  if (!identifier) return null;

  // Exact match (for emails and already-clean numbers)
  const lower = identifier.toLowerCase();
  if (lookup[lower]) return lookup[lower];

  // Cleaned phone (strip spaces, dashes, parens)
  const cleaned = identifier.replace(/[\s()-]/g, '');
  if (lookup[cleaned]) return lookup[cleaned];

  // Digits only
  const digits = identifier.replace(/\D/g, '');
  if (lookup[digits]) return lookup[digits];

  // Last 10 digits
  const last10 = digits.slice(-10);
  if (last10.length >= 7 && lookup[last10]) return lookup[last10];

  // Last 7 digits
  const last7 = digits.slice(-7);
  if (last7.length === 7 && lookup[last7]) return lookup[last7];

  return null;
}

// ─── REST API ROUTES ───

// Get all conversations (with server-side contact name resolution)
app.get('/api/conversations', async (req, res) => {
  try {
    const conversations = messageDB.getConversations();
    // Resolve contact names server-side
    const contacts = await contactsManager.getContacts();
    const contactLookup = buildContactLookup(contacts);

    for (const conv of conversations) {
      // Resolve display name from contacts
      if (!conv.isGroup && conv.chatIdentifier) {
        const resolved = lookupName(conv.chatIdentifier, contactLookup);
        if (resolved) {
          conv.displayName = resolved;
        }
      }
      // Resolve participant names
      if (conv.participants) {
        conv.participantNames = conv.participants.map(p => lookupName(p, contactLookup) || p);
      }
    }

    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages for a conversation (with resolved sender names)
app.get('/api/conversations/:chatId/messages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const messages = messageDB.getMessages(req.params.chatId, limit, offset);

    // Resolve sender names for group chats
    const contacts = await contactsManager.getContacts();
    const contactLookup = buildContactLookup(contacts);

    for (const msg of messages) {
      if (msg.senderId && !msg.isFromMe) {
        const resolved = lookupName(msg.senderId, contactLookup);
        if (resolved) {
          msg.senderDisplay = resolved;
        }
      }
    }

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get conversation details
app.get('/api/conversations/:chatId', (req, res) => {
  try {
    const details = messageDB.getConversationDetails(req.params.chatId);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search messages
app.get('/api/search', (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.json([]);
    const results = messageDB.searchMessages(query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get contacts
app.get('/api/contacts', async (req, res) => {
  try {
    const contacts = await contactsManager.getContacts();
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a message
app.post('/api/send', async (req, res) => {
  try {
    const { recipient, message, isGroup, groupName } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    if (isGroup && groupName) {
      await sender.sendToGroup(groupName, message);
    } else if (recipient) {
      await sender.sendMessage(recipient, message);
    } else {
      return res.status(400).json({ error: 'Recipient or group name is required' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve attachment files
app.get('/api/attachments/:filename', (req, res) => {
  try {
    const filePath = attachmentServer.getAttachmentPath(req.params.filename);
    if (filePath) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'Attachment not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve attachment by full path (encoded)
app.get('/api/attachment-by-path', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Path required' });

    const resolved = attachmentServer.resolveAttachmentPath(filePath);
    if (resolved) {
      res.sendFile(resolved);
    } else {
      res.status(404).json({ error: 'Attachment not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get reactions for a conversation
app.get('/api/conversations/:chatId/reactions', (req, res) => {
  try {
    const reactions = messageDB.getReactionsForChat(req.params.chatId);
    res.json(reactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify connection code
app.post('/api/verify-code', (req, res) => {
  const { code } = req.body;
  if (code === CONNECTION_CODE) {
    res.json({ success: true, serverName: os.hostname() });
  } else {
    res.status(401).json({ error: 'Invalid connection code' });
  }
});

// Get server info
let tunnelUrl = null;

app.get('/api/info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }
  res.json({
    hostname: os.hostname(),
    addresses,
    platform: os.platform(),
    uptime: process.uptime(),
    connectionCode: CONNECTION_CODE,
    tunnelUrl: tunnelUrl
  });
});

// ─── WEBSOCKET FOR REAL-TIME UPDATES ───

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// Poll for new messages every 2 seconds
let lastMessageRowId = messageDB.getLastRowId();

setInterval(() => {
  try {
    const newMessages = messageDB.getNewMessages(lastMessageRowId);
    if (newMessages.length > 0) {
      lastMessageRowId = newMessages[newMessages.length - 1].rowid;
      io.emit('new-messages', newMessages);
      console.log(`[WS] Broadcast ${newMessages.length} new message(s)`);
    }
  } catch (err) {
    // DB might be locked momentarily
  }
}, 2000);

// ─── START SERVER ───

const PORT = process.env.PORT || 3782;

server.listen(PORT, '0.0.0.0', () => {
  const interfaces = os.networkInterfaces();
  console.log('\n=== iMessage Bridge Server ===');
  console.log(`Local:   http://localhost:${PORT}`);
  for (const [name, iface] of Object.entries(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`Network: http://${addr.address}:${PORT}`);
      }
    }
  }
  console.log(`\n[CONNECTION CODE] ${CONNECTION_CODE}`);
  console.log('\nWaiting for Windows client connections...\n');

  // ─── AUTO-LAUNCH CLOUDFLARE TUNNEL ───
  // Tries to create a free tunnel automatically if cloudflared is installed
  if (process.env.TUNNEL !== '0' && process.env.TUNNEL !== 'false') {
    tryStartTunnel(PORT);
  }
});

// ─── CLOUDFLARE TUNNEL ───
function tryStartTunnel(port) {
  const { spawn, execSync } = require('child_process');

  // Check if cloudflared is installed
  let cloudflaredPath;
  try {
    cloudflaredPath = execSync('which cloudflared', { encoding: 'utf-8' }).trim();
  } catch {
    console.log('[TUNNEL] cloudflared not found. To enable cross-network access:');
    console.log('         brew install cloudflared');
    console.log('         Then restart the server.\n');
    return;
  }

  console.log('[TUNNEL] Starting Cloudflare tunnel...');
  const tunnel = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let urlFound = false;

  const handleOutput = (data) => {
    const text = data.toString();
    // Look for the tunnel URL in the output
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !urlFound) {
      urlFound = true;
      tunnelUrl = match[0];
      console.log(`\n[TUNNEL] ✓ Cross-network access enabled!`);
      console.log(`[TUNNEL] Public URL: ${tunnelUrl}`);
      console.log(`[TUNNEL] Use this URL in the Windows client to connect from ANY WiFi\n`);
    }
  };

  tunnel.stdout.on('data', handleOutput);
  tunnel.stderr.on('data', handleOutput);

  tunnel.on('error', (err) => {
    console.log(`[TUNNEL] Failed to start: ${err.message}`);
  });

  tunnel.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`[TUNNEL] Exited with code ${code}. Tunnel is offline.`);
    }
    tunnelUrl = null;
  });

  // Don't let the tunnel prevent the server from exiting
  tunnel.unref();

  // Clean up tunnel on process exit
  process.on('SIGINT', () => {
    tunnel.kill();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    tunnel.kill();
    process.exit(0);
  });
}
