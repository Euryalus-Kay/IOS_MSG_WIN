const { ipcRenderer } = require('electron');
const io = require('socket.io-client');

// ─── STATE ───
const state = {
  serverUrl: '',
  socket: null,
  conversations: [],
  currentChatId: null,
  currentChat: null,
  messages: [],
  contacts: [],
  contactMap: {},
  searchTimeout: null,
  isConnected: false
};

// ─── DOM REFS ───
const $ = (sel) => document.querySelector(sel);
const setupScreen = $('#setup-screen');
const mainApp = $('#main-app');
const serverUrlInput = $('#server-url-input');
const connectBtn = $('#connect-btn');
const connectionError = $('#connection-error');
const conversationList = $('#conversation-list');
const searchInput = $('#search-input');
const noChat = $('#no-chat');
const activeChat = $('#active-chat');
const chatName = $('#chat-name');
const chatSubtitle = $('#chat-subtitle');
const chatAvatarText = $('#chat-avatar-text');
const chatAvatar = $('#chat-avatar');
const messagesList = $('#messages-list');
const messagesContainer = $('#messages-container');
const messageInput = $('#message-input');
const sendBtn = $('#send-btn');
const settingsBtn = $('#settings-btn');
const settingsModal = $('#settings-modal');
const settingsServerUrl = $('#settings-server-url');
const settingsSave = $('#settings-save');
const settingsCancel = $('#settings-cancel');
const chatInfoBtn = $('#chat-info-btn');
const infoPanel = $('#info-panel');
const closeInfoBtn = $('#close-info-btn');
const infoPanelContent = $('#info-panel-content');
const serverInfo = $('#server-info');

// ─── AVATAR COLORS ───
const AVATAR_COLORS = ['blue', 'green', 'orange', 'purple', 'red', 'teal', 'pink'];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/[\s@+.]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// ─── TIME FORMATTING ───
function formatTime(isoDate) {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

function formatMessageTime(isoDate) {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateSeparator(isoDate) {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// ─── API ───
async function apiFetch(endpoint) {
  const res = await fetch(`${state.serverUrl}${endpoint}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${state.serverUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Send failed');
  }
  return res.json();
}

// ─── CONNECTION ───
async function connectToServer(url) {
  state.serverUrl = url.replace(/\/$/, '');

  try {
    // Test connection
    const info = await apiFetch('/api/info');
    console.log('Connected to server:', info);

    // Save URL
    await ipcRenderer.invoke('set-server-url', state.serverUrl);

    // Connect WebSocket
    if (state.socket) state.socket.disconnect();
    state.socket = io(state.serverUrl, { transports: ['websocket', 'polling'] });

    state.socket.on('connect', () => {
      state.isConnected = true;
      console.log('WebSocket connected');
    });

    state.socket.on('disconnect', () => {
      state.isConnected = false;
      console.log('WebSocket disconnected');
    });

    state.socket.on('new-messages', (messages) => {
      handleNewMessages(messages);
    });

    // Load data
    await loadConversations();
    await loadContacts();

    // Switch to main app
    setupScreen.style.display = 'none';
    mainApp.style.display = 'flex';

    return true;
  } catch (err) {
    console.error('Connection failed:', err);
    throw err;
  }
}

// ─── LOAD DATA ───
async function loadConversations() {
  try {
    state.conversations = await apiFetch('/api/conversations');
    renderConversationList(state.conversations);
  } catch (err) {
    console.error('Failed to load conversations:', err);
  }
}

async function loadContacts() {
  try {
    state.contacts = await apiFetch('/api/contacts');
    // Build lookup map
    state.contactMap = {};
    for (const contact of state.contacts) {
      for (const phone of contact.phones) {
        const norm = phone.replace(/\D/g, '').slice(-10);
        state.contactMap[norm] = contact.name;
      }
      for (const email of contact.emails) {
        state.contactMap[email.toLowerCase()] = contact.name;
      }
    }
  } catch (err) {
    console.error('Failed to load contacts:', err);
  }
}

function resolveContactName(identifier) {
  if (!identifier) return null;
  // Direct lookup
  if (state.contactMap[identifier.toLowerCase()]) {
    return state.contactMap[identifier.toLowerCase()];
  }
  // Phone number lookup
  const norm = identifier.replace(/\D/g, '').slice(-10);
  if (state.contactMap[norm]) {
    return state.contactMap[norm];
  }
  return null;
}

function getDisplayName(conv) {
  if (conv.displayName && conv.displayName !== conv.chatIdentifier) {
    return conv.displayName;
  }
  if (conv.isGroup) {
    // Try to build group name from participants
    const names = conv.participants.map(p => resolveContactName(p) || p).slice(0, 3);
    return names.join(', ') + (conv.participants.length > 3 ? ` +${conv.participants.length - 3}` : '');
  }
  return resolveContactName(conv.chatIdentifier) || conv.chatIdentifier;
}

// ─── RENDER CONVERSATIONS ───
function renderConversationList(conversations) {
  conversationList.innerHTML = '';

  for (const conv of conversations) {
    const displayName = getDisplayName(conv);
    const color = conv.isGroup ? 'group' : getAvatarColor(displayName);
    const initials = conv.isGroup ? (conv.participants.length + '') : getInitials(displayName);
    const isActive = state.currentChatId === conv.chatId;

    const item = document.createElement('div');
    item.className = `conversation-item${isActive ? ' active' : ''}`;
    item.dataset.chatId = conv.chatId;

    let previewText = conv.lastMessage.text || '';
    if (conv.lastMessage.hasAttachments && !previewText) {
      previewText = 'Attachment';
    }
    if (conv.lastMessage.isFromMe && previewText) {
      previewText = previewText;
    }

    item.innerHTML = `
      <div class="conv-avatar ${color}">${initials}</div>
      <div class="conv-content">
        <div class="conv-top-row">
          <span class="conv-name">${escapeHtml(displayName)}</span>
          <span class="conv-time">${formatTime(conv.lastMessage.date)}</span>
        </div>
        <div class="conv-preview">${escapeHtml(previewText)}</div>
      </div>
    `;

    item.addEventListener('click', () => openConversation(conv));
    conversationList.appendChild(item);
  }
}

// ─── OPEN CONVERSATION ───
async function openConversation(conv) {
  state.currentChatId = conv.chatId;
  state.currentChat = conv;

  // Update sidebar selection
  document.querySelectorAll('.conversation-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.chatId) === conv.chatId);
  });

  const displayName = getDisplayName(conv);

  // Update header
  noChat.style.display = 'none';
  activeChat.style.display = 'flex';
  infoPanel.style.display = 'none';

  chatName.textContent = displayName;
  chatAvatarText.textContent = conv.isGroup ? conv.participants.length : getInitials(displayName);
  chatAvatar.style.background = conv.isGroup ? '#8e8e93' : '';

  if (conv.isGroup) {
    chatSubtitle.textContent = `${conv.participants.length} people`;
  } else {
    chatSubtitle.textContent = conv.service === 'iMessage' ? 'iMessage' : 'SMS';
  }

  // Load messages
  try {
    const messages = await apiFetch(`/api/conversations/${conv.chatId}/messages?limit=100`);
    state.messages = messages;
    renderMessages(messages, conv.isGroup);
    scrollToBottom();
  } catch (err) {
    console.error('Failed to load messages:', err);
    messagesList.innerHTML = '<p style="text-align:center;color:#8e8e93;padding:20px;">Failed to load messages</p>';
  }

  messageInput.focus();
}

// ─── RENDER MESSAGES ───
function renderMessages(messages, isGroup) {
  messagesList.innerHTML = '';
  let lastDate = null;
  let lastSender = null;

  for (const msg of messages) {
    // Date separator
    const msgDate = msg.date ? new Date(msg.date).toDateString() : null;
    if (msgDate && msgDate !== lastDate) {
      lastDate = msgDate;
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      sep.textContent = formatDateSeparator(msg.date);
      messagesList.appendChild(sep);
      lastSender = null;
    }

    // Skip group actions / system messages with no text
    if (msg.isGroupAction && !msg.text) {
      const action = document.createElement('div');
      action.className = 'group-action';
      action.textContent = 'Group updated';
      messagesList.appendChild(action);
      continue;
    }

    // Skip tapback/reaction messages (associated_message_type != 0)
    if (msg.associatedMessageType && msg.associatedMessageType !== 0) {
      continue;
    }

    if (!msg.text && msg.attachments.length === 0) continue;

    const row = document.createElement('div');
    row.className = `message-row ${msg.isFromMe ? 'from-me' : 'from-them'}`;

    // Show sender name in group chats
    const senderName = resolveContactName(msg.senderId) || msg.senderDisplay || msg.senderId;
    if (isGroup && !msg.isFromMe && senderName !== lastSender) {
      const senderEl = document.createElement('div');
      senderEl.className = 'message-sender';
      senderEl.textContent = senderName;
      row.appendChild(senderEl);
    }
    lastSender = msg.isFromMe ? null : senderName;

    // Message bubble
    if (msg.text) {
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.textContent = msg.text;
      row.appendChild(bubble);
    }

    // Attachments
    for (const att of msg.attachments) {
      const attEl = document.createElement('div');
      attEl.className = 'message-attachment';

      if (att.mimeType && att.mimeType.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = `${state.serverUrl}/api/attachment-by-path?path=${encodeURIComponent(att.filename)}`;
        img.alt = att.transferName;
        img.loading = 'lazy';
        attEl.appendChild(img);
      } else {
        attEl.innerHTML = `
          <div class="attachment-file">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 1h5.586L13 4.414V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z"/>
            </svg>
            <span>${escapeHtml(att.transferName || 'File')}</span>
          </div>
        `;
      }
      row.appendChild(attEl);
    }

    // Timestamp
    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = formatMessageTime(msg.date);
    row.appendChild(time);

    messagesList.appendChild(row);
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ─── HANDLE NEW MESSAGES (REAL-TIME) ───
function handleNewMessages(newMessages) {
  // Update conversation list
  for (const msg of newMessages) {
    const conv = state.conversations.find(c => c.chatId === msg.chatId);
    if (conv) {
      conv.lastMessage = {
        text: msg.text,
        date: msg.date,
        isFromMe: msg.isFromMe,
        hasAttachments: msg.hasAttachments
      };
    }
  }

  // Re-sort and render conversation list
  state.conversations.sort((a, b) => {
    const dateA = a.lastMessage.date ? new Date(a.lastMessage.date) : 0;
    const dateB = b.lastMessage.date ? new Date(b.lastMessage.date) : 0;
    return dateB - dateA;
  });
  renderConversationList(state.conversations);

  // If viewing a conversation that received new messages, append them
  const relevantMessages = newMessages.filter(m => m.chatId === state.currentChatId);
  if (relevantMessages.length > 0 && state.currentChat) {
    for (const msg of relevantMessages) {
      state.messages.push(msg);
      appendMessageToView(msg, state.currentChat.isGroup);
    }
    scrollToBottom();
  }
}

function appendMessageToView(msg, isGroup) {
  if (msg.associatedMessageType && msg.associatedMessageType !== 0) return;
  if (!msg.text && (!msg.attachments || msg.attachments.length === 0)) return;

  const row = document.createElement('div');
  row.className = `message-row ${msg.isFromMe ? 'from-me' : 'from-them'}`;

  if (isGroup && !msg.isFromMe) {
    const senderName = resolveContactName(msg.senderId) || msg.senderDisplay || msg.senderId;
    const senderEl = document.createElement('div');
    senderEl.className = 'message-sender';
    senderEl.textContent = senderName;
    row.appendChild(senderEl);
  }

  if (msg.text) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = msg.text;
    row.appendChild(bubble);
  }

  if (msg.attachments) {
    for (const att of msg.attachments) {
      const attEl = document.createElement('div');
      attEl.className = 'message-attachment';
      if (att.mimeType && att.mimeType.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = `${state.serverUrl}/api/attachment-by-path?path=${encodeURIComponent(att.filename)}`;
        img.alt = att.transferName;
        attEl.appendChild(img);
      } else {
        attEl.innerHTML = `<div class="attachment-file"><span>${escapeHtml(att.transferName || 'File')}</span></div>`;
      }
      row.appendChild(attEl);
    }
  }

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = formatMessageTime(msg.date);
  row.appendChild(time);

  messagesList.appendChild(row);
}

// ─── SEND MESSAGE ───
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !state.currentChat) return;

  const conv = state.currentChat;
  messageInput.value = '';
  autoResizeTextarea();
  sendBtn.disabled = true;

  try {
    if (conv.isGroup) {
      await apiPost('/api/send', {
        isGroup: true,
        groupName: conv.chatGuid,
        message: text
      });
    } else {
      await apiPost('/api/send', {
        recipient: conv.chatIdentifier,
        message: text
      });
    }
  } catch (err) {
    console.error('Failed to send:', err);
    // Show error in the message input
    messageInput.value = text;
    messageInput.style.borderColor = '#ff3b30';
    setTimeout(() => { messageInput.style.borderColor = ''; }, 2000);
  }
}

// ─── SEARCH ───
async function handleSearch(query) {
  if (!query.trim()) {
    renderConversationList(state.conversations);
    return;
  }

  // Filter conversations locally first
  const filtered = state.conversations.filter(conv => {
    const name = getDisplayName(conv).toLowerCase();
    const preview = (conv.lastMessage.text || '').toLowerCase();
    const q = query.toLowerCase();
    return name.includes(q) || preview.includes(q);
  });

  if (filtered.length > 0) {
    renderConversationList(filtered);
  } else {
    // Search messages on server
    try {
      const results = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
      renderSearchResults(results, query);
    } catch (err) {
      console.error('Search failed:', err);
    }
  }
}

function renderSearchResults(results, query) {
  conversationList.innerHTML = '';

  if (results.length === 0) {
    conversationList.innerHTML = '<p style="text-align:center;color:#8e8e93;padding:20px;">No results found</p>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'search-results';

  for (const result of results) {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    const chatDisplayName = resolveContactName(result.chatName) || result.chatName;
    const highlightedText = (result.text || '').replace(
      new RegExp(`(${escapeRegExp(query)})`, 'gi'),
      '<mark>$1</mark>'
    );

    item.innerHTML = `
      <div class="search-result-chat">${escapeHtml(chatDisplayName)}</div>
      <div class="search-result-text">${highlightedText}</div>
    `;

    item.addEventListener('click', () => {
      const conv = state.conversations.find(c => c.chatId === result.chatId);
      if (conv) {
        searchInput.value = '';
        renderConversationList(state.conversations);
        openConversation(conv);
      }
    });

    wrapper.appendChild(item);
  }

  conversationList.appendChild(wrapper);
}

// ─── INFO PANEL ───
async function showInfoPanel() {
  if (!state.currentChat) return;

  try {
    const details = await apiFetch(`/api/conversations/${state.currentChatId}`);
    infoPanelContent.innerHTML = '';

    // Participants section
    const section = document.createElement('div');
    section.className = 'info-section';
    section.innerHTML = `<h4>${details.isGroup ? 'Members' : 'Contact'}</h4>`;

    for (const p of details.participants) {
      const contactName = resolveContactName(p.id) || p.displayId;
      const color = getAvatarColor(contactName);

      const pEl = document.createElement('div');
      pEl.className = 'info-participant';
      pEl.innerHTML = `
        <div class="info-participant-avatar" style="background:var(--bubble-${color === 'blue' ? 'blue' : 'green'})">${getInitials(contactName)}</div>
        <div>
          <div class="info-participant-name">${escapeHtml(contactName)}</div>
          <div class="info-participant-id">${escapeHtml(p.id)} - ${p.service}</div>
        </div>
      `;
      section.appendChild(pEl);
    }

    infoPanelContent.appendChild(section);

    // Chat info section
    const infoSection = document.createElement('div');
    infoSection.className = 'info-section';
    infoSection.innerHTML = `
      <h4>Chat Info</h4>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">Service: ${details.service}</p>
      <p style="font-size:13px;color:var(--text-secondary);">ID: ${details.chatIdentifier}</p>
    `;
    infoPanelContent.appendChild(infoSection);

    infoPanel.style.display = 'flex';
  } catch (err) {
    console.error('Failed to load chat details:', err);
  }
}

// ─── TEXTAREA AUTO-RESIZE ───
function autoResizeTextarea() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  sendBtn.disabled = !messageInput.value.trim();
}

// ─── UTILITIES ───
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── EVENT LISTENERS ───

// Connect button
connectBtn.addEventListener('click', async () => {
  const url = serverUrlInput.value.trim();
  if (!url) return;

  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';
  connectionError.style.display = 'none';

  try {
    await connectToServer(url);
  } catch (err) {
    connectionError.textContent = `Connection failed: ${err.message}. Make sure the server is running on your Mac.`;
    connectionError.style.display = 'block';
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
  }
});

// Enter key on server URL input
serverUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectBtn.click();
});

// Search
searchInput.addEventListener('input', (e) => {
  clearTimeout(state.searchTimeout);
  state.searchTimeout = setTimeout(() => handleSearch(e.target.value), 300);
});

// Message input
messageInput.addEventListener('input', autoResizeTextarea);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Send button
sendBtn.addEventListener('click', sendMessage);

// Settings
settingsBtn.addEventListener('click', () => {
  settingsServerUrl.value = state.serverUrl;
  settingsModal.style.display = 'flex';

  // Load server info
  apiFetch('/api/info').then(info => {
    serverInfo.innerHTML = `
      <p><strong>Host:</strong> ${info.hostname}</p>
      <p><strong>IPs:</strong> ${info.addresses.join(', ')}</p>
      <p><strong>Uptime:</strong> ${Math.floor(info.uptime / 60)} min</p>
    `;
  }).catch(() => {
    serverInfo.innerHTML = '<p>Could not fetch server info</p>';
  });
});

settingsCancel.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});

settingsSave.addEventListener('click', async () => {
  const url = settingsServerUrl.value.trim();
  if (!url) return;

  try {
    await connectToServer(url);
    settingsModal.style.display = 'none';
  } catch (err) {
    alert(`Failed to connect: ${err.message}`);
  }
});

// Close modal on overlay click
document.querySelector('.modal-overlay')?.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});

// Info panel
chatInfoBtn.addEventListener('click', () => {
  if (infoPanel.style.display === 'flex') {
    infoPanel.style.display = 'none';
  } else {
    showInfoPanel();
  }
});

closeInfoBtn.addEventListener('click', () => {
  infoPanel.style.display = 'none';
});

// ─── INIT ───
async function init() {
  try {
    const savedUrl = await ipcRenderer.invoke('get-server-url');
    if (savedUrl && savedUrl !== 'http://localhost:3782') {
      serverUrlInput.value = savedUrl;
      // Try auto-connect
      try {
        await connectToServer(savedUrl);
      } catch (e) {
        // Show setup screen
        serverUrlInput.value = savedUrl;
      }
    }
  } catch (err) {
    console.log('Not in Electron, running in browser mode');
  }
}

init();
