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
  reactions: {},
  searchTimeout: null,
  isConnected: false,
  loadingOlder: false,
  hasMoreMessages: true,
  messageOffset: 0,
  MESSAGE_PAGE_SIZE: 500
};

// ─── DOM REFS ───
const $ = (sel) => document.querySelector(sel);
const setupScreen = $('#setup-screen');
const mainApp = $('#main-app');
const serverUrlInput = $('#server-url-input');
const connectBtn = $('#connect-btn');
const connectBtnText = $('#connect-btn-text');
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
const chatHeaderInfoClick = $('#chat-header-info-click');
const infoPanel = $('#info-panel');
const closeInfoBtn = $('#close-info-btn');
const infoPanelContent = $('#info-panel-content');
const serverInfo = $('#server-info');

// ─── AVATAR COLORS ───
const AVATAR_COLORS = ['blue', 'green', 'orange', 'purple', 'red', 'teal', 'pink', 'indigo'];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name) {
  if (!name) return '?';
  if (/^[\d+\s()-]+$/.test(name) && name.replace(/\D/g, '').length >= 7) {
    const digits = name.replace(/\D/g, '');
    return digits.slice(-2);
  }
  const parts = name.trim().split(/[\s]+/).filter(Boolean);
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
  } else if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
  }
}

function formatMessageTime(isoDate) {
  if (!isoDate) return '';
  return new Date(isoDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateSeparator(isoDate) {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'long' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// ─── URL/LINK DETECTION ───
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  return matches || [];
}

function linkifyText(text) {
  if (!text) return '';
  return escapeHtml(text).replace(
    /https?:\/\/[^\s<>&"{}|\\^`\[\]]+/gi,
    match => `<a href="#" class="message-link" data-url="${match}">${match}</a>`
  );
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch { return url; }
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

// ─── SAVED CONNECTIONS ───
function getSavedConnections() {
  try {
    const saved = localStorage.getItem('savedConnections');
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveConnection(url, name) {
  const connections = getSavedConnections();
  const existing = connections.findIndex(c => c.url === url);
  if (existing !== -1) {
    connections[existing].name = name;
    connections[existing].lastUsed = Date.now();
  } else {
    connections.push({ url, name, lastUsed: Date.now() });
  }
  localStorage.setItem('savedConnections', JSON.stringify(connections));
  renderSavedConnections();
}

function removeSavedConnection(url) {
  const connections = getSavedConnections().filter(c => c.url !== url);
  localStorage.setItem('savedConnections', JSON.stringify(connections));
  renderSavedConnections();
}

function renderSavedConnections() {
  const container = $('#saved-connections-list');
  if (!container) return;
  const connections = getSavedConnections();

  if (connections.length === 0) {
    container.parentElement.style.display = 'none';
    return;
  }

  container.parentElement.style.display = 'block';
  container.innerHTML = '';

  for (const conn of connections.sort((a, b) => b.lastUsed - a.lastUsed)) {
    const item = document.createElement('div');
    item.className = 'saved-connection-item';
    item.innerHTML = `
      <div class="conn-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
      </div>
      <div class="conn-info">
        <div class="conn-name">${escapeHtml(conn.name || 'Mac Server')}</div>
        <div class="conn-url">${escapeHtml(conn.url)}</div>
      </div>
      <button class="conn-delete" title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;

    item.querySelector('.conn-info').addEventListener('click', () => {
      serverUrlInput.value = conn.url;
      connectBtn.click();
    });

    item.querySelector('.conn-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      removeSavedConnection(conn.url);
    });

    container.appendChild(item);
  }
}

// ─── CONNECTION ───
async function connectToServer(url) {
  state.serverUrl = url.replace(/\/$/, '');

  const info = await apiFetch('/api/info');
  console.log('Connected to server:', info);

  // Save the connection
  saveConnection(state.serverUrl, info.hostname);

  await ipcRenderer.invoke('set-server-url', state.serverUrl);

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

  await Promise.all([loadConversations(), loadContacts()]);

  setupScreen.style.display = 'none';
  mainApp.style.display = 'flex';
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
    state.contactMap = {};
    for (const contact of state.contacts) {
      if (!contact.name) continue;
      for (const phone of contact.phones) {
        // Store under multiple normalizations for best matching
        const digits = phone.replace(/\D/g, '');
        // Full digits (e.g., "12125551234")
        if (digits.length >= 7) state.contactMap[digits] = contact.name;
        // Last 10 digits (US number without country code)
        const last10 = digits.slice(-10);
        if (last10.length >= 7) state.contactMap[last10] = contact.name;
        // Last 7 digits (local number)
        const last7 = digits.slice(-7);
        state.contactMap[last7] = contact.name;
        // Also store the raw phone with + prefix stripped
        const cleaned = phone.replace(/[\s()-]/g, '');
        state.contactMap[cleaned.toLowerCase()] = contact.name;
      }
      for (const email of contact.emails) {
        state.contactMap[email.toLowerCase()] = contact.name;
      }
    }
    console.log(`[Contacts] Mapped ${Object.keys(state.contactMap).length} identifiers from ${state.contacts.length} contacts`);
    // Re-render conversations with resolved names
    if (state.conversations.length > 0) {
      renderConversationList(state.conversations);
    }
  } catch (err) {
    console.error('Failed to load contacts:', err);
  }
}

function resolveContactName(identifier) {
  if (!identifier) return null;

  // Try exact match first (for emails)
  const lower = identifier.toLowerCase();
  if (state.contactMap[lower]) return state.contactMap[lower];

  // Try cleaned phone (strip spaces, dashes, parens)
  const cleaned = identifier.replace(/[\s()-]/g, '').toLowerCase();
  if (state.contactMap[cleaned]) return state.contactMap[cleaned];

  // Try digits only
  const digits = identifier.replace(/\D/g, '');
  if (state.contactMap[digits]) return state.contactMap[digits];

  // Try last 10 digits
  const last10 = digits.slice(-10);
  if (last10.length >= 7 && state.contactMap[last10]) return state.contactMap[last10];

  // Try last 7 digits (local number match)
  const last7 = digits.slice(-7);
  if (last7.length === 7 && state.contactMap[last7]) return state.contactMap[last7];

  return null;
}

function getDisplayName(conv) {
  if (conv.displayName && conv.displayName !== conv.chatIdentifier) {
    return conv.displayName;
  }
  if (conv.isGroup) {
    const names = conv.participants.map(p => resolveContactName(p) || formatPhoneNumber(p)).slice(0, 3);
    const suffix = conv.participants.length > 3 ? `, +${conv.participants.length - 3}` : '';
    return names.join(', ') + suffix;
  }
  return resolveContactName(conv.chatIdentifier) || formatPhoneNumber(conv.chatIdentifier);
}

function formatPhoneNumber(str) {
  if (!str) return '?';
  const digits = str.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  }
  return str;
}

// ─── RENDER CONVERSATIONS ───
function renderConversationList(conversations) {
  conversationList.innerHTML = '';

  if (conversations.length === 0) {
    conversationList.innerHTML = '<div class="empty-conversations"><p>No conversations yet</p></div>';
    return;
  }

  for (const conv of conversations) {
    const displayName = getDisplayName(conv);
    const color = conv.isGroup ? 'group' : getAvatarColor(displayName);
    const isActive = state.currentChatId === conv.chatId;

    const item = document.createElement('div');
    item.className = `conversation-item${isActive ? ' active' : ''}`;
    item.dataset.chatId = conv.chatId;

    let previewText = conv.lastMessage.text || '';
    if (conv.lastMessage.hasAttachments && !previewText) previewText = 'Attachment';
    if (conv.lastMessage.isFromMe && previewText) {
      previewText = 'You: ' + previewText;
    }

    const avatarContent = conv.isGroup
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="white" opacity="0.9"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`
      : getInitials(displayName);

    item.innerHTML = `
      <div class="conv-avatar ${color}">${avatarContent}</div>
      <div class="conv-content">
        <div class="conv-top-row">
          <span class="conv-name">${escapeHtml(displayName)}</span>
          <span class="conv-time">${formatTime(conv.lastMessage.date)}</span>
        </div>
        <div class="conv-bottom-row">
          <span class="conv-preview">${escapeHtml(previewText)}</span>
        </div>
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

  document.querySelectorAll('.conversation-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.chatId) === conv.chatId);
  });

  const displayName = getDisplayName(conv);
  const color = conv.isGroup ? 'group' : getAvatarColor(displayName);

  noChat.style.display = 'none';
  activeChat.style.display = 'flex';
  infoPanel.style.display = 'none';

  chatName.textContent = displayName;

  if (conv.isGroup) {
    chatAvatarText.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="white" opacity="0.9"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`;
    chatAvatar.className = 'chat-avatar';
    chatAvatar.style.background = 'linear-gradient(135deg, #636366, #48484a)';
    chatSubtitle.innerHTML = `${conv.participants.length} people`;
  } else {
    chatAvatarText.textContent = getInitials(displayName);
    chatAvatar.className = 'chat-avatar';
    chatAvatar.style.background = '';
    chatAvatar.classList.add(color);
    const serviceLabel = conv.service === 'iMessage' ? 'iMessage' : 'SMS';
    chatSubtitle.innerHTML = `<span class="status-dot"></span> ${serviceLabel}`;
  }

  messagesList.innerHTML = '<div style="display:flex;justify-content:center;padding:40px;"><div class="loading-spinner"></div></div>';

  // Reset pagination state
  state.messageOffset = 0;
  state.hasMoreMessages = true;
  state.loadingOlder = false;

  try {
    // Load messages and reactions in parallel
    const [messages, reactions] = await Promise.all([
      apiFetch(`/api/conversations/${conv.chatId}/messages?limit=${state.MESSAGE_PAGE_SIZE}`),
      apiFetch(`/api/conversations/${conv.chatId}/reactions`).catch(() => ({}))
    ]);
    state.messages = messages;
    state.reactions = reactions;
    state.messageOffset = messages.length;
    state.hasMoreMessages = messages.length >= state.MESSAGE_PAGE_SIZE;
    renderMessages(messages, conv.isGroup, reactions);
    scrollToBottom(false);
  } catch (err) {
    console.error('Failed to load messages:', err);
    messagesList.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);padding:40px;">Failed to load messages</p>';
  }

  messageInput.focus();
}

// ─── RENDER MESSAGES ───
function renderMessages(messages, isGroup, reactions = {}) {
  messagesList.innerHTML = '';
  let lastDate = null;
  let lastSenderId = null;
  let lastIsFromMe = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const nextMsg = messages[i + 1];

    // Date separator
    const msgDate = msg.date ? new Date(msg.date).toDateString() : null;
    if (msgDate && msgDate !== lastDate) {
      lastDate = msgDate;
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      sep.innerHTML = `<span style="background:var(--bg-primary);padding:0 12px;position:relative;z-index:1">${escapeHtml(formatDateSeparator(msg.date))}</span>`;
      messagesList.appendChild(sep);
      lastSenderId = null;
      lastIsFromMe = null;
    }

    // Skip group actions with no text
    if (msg.isGroupAction && !msg.text) {
      const action = document.createElement('div');
      action.className = 'group-action';
      action.textContent = 'Group updated';
      messagesList.appendChild(action);
      continue;
    }

    // Skip tapback/reaction messages (they are rendered as badges)
    if (msg.associatedMessageType && msg.associatedMessageType !== 0) continue;
    if (!msg.text && msg.attachments.length === 0) continue;

    const row = document.createElement('div');
    row.className = `message-row ${msg.isFromMe ? 'from-me' : 'from-them'}`;

    // Show sender name in group chats (only when sender changes)
    const currentSenderId = msg.isFromMe ? '__me__' : (msg.senderId || msg.senderDisplay);
    const showSender = isGroup && !msg.isFromMe && currentSenderId !== lastSenderId;

    if (showSender) {
      const senderName = resolveContactName(msg.senderId) || msg.senderDisplay || formatPhoneNumber(msg.senderId);
      const senderEl = document.createElement('div');
      senderEl.className = 'message-sender';
      senderEl.textContent = senderName;
      row.appendChild(senderEl);
    }

    // Message bubble with link detection
    if (msg.text) {
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      const urls = extractUrls(msg.text);
      if (urls.length > 0) {
        bubble.innerHTML = linkifyText(msg.text);
        // Add click handlers for links
        bubble.querySelectorAll('.message-link').forEach(link => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const url = link.getAttribute('data-url');
            require('electron').shell.openExternal(url);
          });
        });
      } else {
        bubble.textContent = msg.text;
      }
      row.appendChild(bubble);

      // Render link preview for the first URL
      if (urls.length > 0) {
        const linkPreview = createLinkPreview(urls[0]);
        row.appendChild(linkPreview);
      }
    }

    // Attachments - improved handling
    for (const att of msg.attachments) {
      const attEl = document.createElement('div');
      attEl.className = 'message-attachment';

      if (att.mimeType && att.mimeType.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = `${state.serverUrl}/api/attachment-by-path?path=${encodeURIComponent(att.filename)}`;
        img.alt = att.transferName;
        img.loading = 'lazy';
        img.onerror = () => { img.style.display = 'none'; };
        img.addEventListener('click', () => {
          require('electron').shell.openExternal(img.src);
        });
        attEl.appendChild(img);
      } else if (att.mimeType && att.mimeType.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = `${state.serverUrl}/api/attachment-by-path?path=${encodeURIComponent(att.filename)}`;
        video.controls = true;
        video.preload = 'metadata';
        video.onerror = () => { video.style.display = 'none'; };
        attEl.appendChild(video);
      } else if (att.mimeType && att.mimeType.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.src = `${state.serverUrl}/api/attachment-by-path?path=${encodeURIComponent(att.filename)}`;
        audio.controls = true;
        audio.preload = 'metadata';
        attEl.appendChild(audio);
      } else {
        // Generic file attachment with better icon
        const fileExt = (att.transferName || '').split('.').pop().toLowerCase();
        const fileIcon = getFileIcon(fileExt);
        attEl.innerHTML = `
          <div class="attachment-file" title="${escapeHtml(att.transferName || 'File')}">
            <div class="attachment-file-icon" style="background:${fileIcon.color}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="${fileIcon.path}"/></svg>
            </div>
            <span>${escapeHtml(att.transferName || 'File')}</span>
          </div>
        `;
        attEl.querySelector('.attachment-file').addEventListener('click', () => {
          require('electron').shell.openExternal(
            `${state.serverUrl}/api/attachment-by-path?path=${encodeURIComponent(att.filename)}`
          );
        });
      }
      row.appendChild(attEl);
    }

    // Tapback reactions
    const msgReactions = reactions[msg.guid] || [];
    if (msgReactions.length > 0) {
      const reactionsEl = createReactionsElement(msgReactions);
      row.appendChild(reactionsEl);
    }

    // Metadata (time + delivery status)
    const isLastMsg = i === messages.length - 1;
    const nextIsDifferentSender = !nextMsg || (nextMsg.isFromMe !== msg.isFromMe);

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = formatMessageTime(msg.date);
    meta.appendChild(timeSpan);

    if (msg.isFromMe && (isLastMsg || nextIsDifferentSender)) {
      const statusSpan = document.createElement('span');
      if (msg.dateRead) {
        statusSpan.className = 'message-status read';
        statusSpan.textContent = 'Read';
      } else if (msg.dateDelivered) {
        statusSpan.className = 'message-status delivered';
        statusSpan.textContent = 'Delivered';
      } else {
        statusSpan.className = 'message-status';
        statusSpan.textContent = 'Sent';
      }
      meta.appendChild(statusSpan);
    }

    row.appendChild(meta);
    messagesList.appendChild(row);

    lastSenderId = currentSenderId;
    lastIsFromMe = msg.isFromMe;
  }
}

// ─── REACTION BADGES ───
function createReactionsElement(reactions) {
  const container = document.createElement('div');
  container.className = 'message-reactions';

  // Group by emoji type
  const grouped = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = [];
    grouped[r.emoji].push(r);
  }

  for (const [emoji, reactors] of Object.entries(grouped)) {
    const badge = document.createElement('span');
    badge.className = 'reaction-badge';
    badge.innerHTML = `${emoji}${reactors.length > 1 ? `<span class="reaction-count">${reactors.length}</span>` : ''}`;
    badge.title = reactors.map(r => {
      if (r.isFromMe) return 'You';
      return resolveContactName(r.senderId) || formatPhoneNumber(r.senderId) || 'Someone';
    }).join(', ');
    container.appendChild(badge);
  }

  return container;
}

// ─── LINK PREVIEW ───
function createLinkPreview(url) {
  const preview = document.createElement('a');
  preview.className = 'link-preview';
  preview.href = '#';
  preview.addEventListener('click', (e) => {
    e.preventDefault();
    require('electron').shell.openExternal(url);
  });

  const domain = getDomain(url);

  preview.innerHTML = `
    <div class="link-preview-body">
      <div class="link-preview-domain">${escapeHtml(domain)}</div>
      <div class="link-preview-title">${escapeHtml(url)}</div>
    </div>
  `;

  return preview;
}

// ─── FILE ICON HELPER ───
function getFileIcon(ext) {
  const icons = {
    pdf: { color: '#FF3B30', path: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z' },
    doc: { color: '#007AFF', path: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z' },
    docx: { color: '#007AFF', path: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z' },
    xls: { color: '#34C759', path: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z' },
    xlsx: { color: '#34C759', path: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z' },
    zip: { color: '#AF52DE', path: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z' },
    mp3: { color: '#FF9500', path: 'M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z' },
    wav: { color: '#FF9500', path: 'M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z' },
  };
  return icons[ext] || { color: 'var(--accent)', path: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z' };
}

function scrollToBottom(smooth = true) {
  requestAnimationFrame(() => {
    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant'
    });
  });
}

// ─── LOAD OLDER MESSAGES (INFINITE SCROLL) ───
async function loadOlderMessages() {
  if (state.loadingOlder || !state.hasMoreMessages || !state.currentChat) return;

  state.loadingOlder = true;

  // Show loading indicator at the top
  const loadingEl = document.createElement('div');
  loadingEl.className = 'load-more-spinner';
  loadingEl.innerHTML = '<div class="loading-spinner"></div>';
  messagesList.prepend(loadingEl);

  // Remember scroll position so we can maintain it after inserting
  const prevScrollHeight = messagesContainer.scrollHeight;

  try {
    const olderMessages = await apiFetch(
      `/api/conversations/${state.currentChatId}/messages?limit=${state.MESSAGE_PAGE_SIZE}&offset=${state.messageOffset}`
    );

    // Remove loading indicator
    loadingEl.remove();

    if (olderMessages.length === 0) {
      state.hasMoreMessages = false;
      // Show "beginning of conversation" marker
      const beginEl = document.createElement('div');
      beginEl.className = 'conversation-begin';
      beginEl.innerHTML = `
        <div class="conversation-begin-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" opacity="0.3"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        </div>
        <p>Beginning of conversation</p>
      `;
      messagesList.prepend(beginEl);
    } else {
      state.messageOffset += olderMessages.length;
      state.hasMoreMessages = olderMessages.length >= state.MESSAGE_PAGE_SIZE;

      // Prepend older messages to state
      state.messages = [...olderMessages, ...state.messages];

      // Re-render all messages with full history
      renderMessages(state.messages, state.currentChat.isGroup, state.reactions);

      // Maintain scroll position
      requestAnimationFrame(() => {
        const newScrollHeight = messagesContainer.scrollHeight;
        messagesContainer.scrollTop = newScrollHeight - prevScrollHeight;
      });
    }
  } catch (err) {
    console.error('Failed to load older messages:', err);
    loadingEl.remove();
  }

  state.loadingOlder = false;
}

// ─── HANDLE NEW MESSAGES (REAL-TIME) ───
function handleNewMessages(newMessages) {
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

  state.conversations.sort((a, b) => {
    const dateA = a.lastMessage.date ? new Date(a.lastMessage.date) : 0;
    const dateB = b.lastMessage.date ? new Date(b.lastMessage.date) : 0;
    return dateB - dateA;
  });
  renderConversationList(state.conversations);

  const relevantMessages = newMessages.filter(m => m.chatId === state.currentChatId);
  if (relevantMessages.length > 0 && state.currentChat) {
    for (const msg of relevantMessages) {
      state.messages.push(msg);
      appendMessageToView(msg, state.currentChat.isGroup);
    }
    scrollToBottom(true);
  }
}

function appendMessageToView(msg, isGroup) {
  if (msg.associatedMessageType && msg.associatedMessageType !== 0) return;
  if (!msg.text && (!msg.attachments || msg.attachments.length === 0)) return;

  const row = document.createElement('div');
  row.className = `message-row ${msg.isFromMe ? 'from-me' : 'from-them'}`;

  if (isGroup && !msg.isFromMe) {
    const senderName = resolveContactName(msg.senderId) || msg.senderDisplay || formatPhoneNumber(msg.senderId);
    const senderEl = document.createElement('div');
    senderEl.className = 'message-sender';
    senderEl.textContent = senderName;
    row.appendChild(senderEl);
  }

  if (msg.text) {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    const urls = extractUrls(msg.text);
    if (urls.length > 0) {
      bubble.innerHTML = linkifyText(msg.text);
      bubble.querySelectorAll('.message-link').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          require('electron').shell.openExternal(link.getAttribute('data-url'));
        });
      });
      const linkPreview = createLinkPreview(urls[0]);
      row.appendChild(bubble);
      row.appendChild(linkPreview);
    } else {
      bubble.textContent = msg.text;
      row.appendChild(bubble);
    }
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
      } else if (att.mimeType && att.mimeType.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = `${state.serverUrl}/api/attachment-by-path?path=${encodeURIComponent(att.filename)}`;
        video.controls = true;
        video.preload = 'metadata';
        attEl.appendChild(video);
      } else if (att.mimeType && att.mimeType.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.src = `${state.serverUrl}/api/attachment-by-path?path=${encodeURIComponent(att.filename)}`;
        audio.controls = true;
        attEl.appendChild(audio);
      } else {
        attEl.innerHTML = `<div class="attachment-file"><div class="attachment-file-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg></div><span>${escapeHtml(att.transferName || 'File')}</span></div>`;
      }
      row.appendChild(attEl);
    }
  }

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = formatMessageTime(msg.date);
  meta.appendChild(timeSpan);

  if (msg.isFromMe) {
    const statusSpan = document.createElement('span');
    statusSpan.className = 'message-status';
    statusSpan.textContent = 'Sent';
    meta.appendChild(statusSpan);
  }

  row.appendChild(meta);
  messagesList.appendChild(row);
}

// ─── SEND MESSAGE ───
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !state.currentChat) return;

  const conv = state.currentChat;

  const tempMsg = {
    text,
    date: new Date().toISOString(),
    isFromMe: true,
    senderId: null,
    attachments: [],
    associatedMessageType: 0
  };
  appendMessageToView(tempMsg, conv.isGroup);
  scrollToBottom(true);

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
    messageInput.value = text;
    autoResizeTextarea();
    const wrapper = messageInput.closest('.message-input-wrapper');
    wrapper.style.borderColor = 'var(--red)';
    wrapper.style.boxShadow = '0 0 0 3px rgba(255,59,48,0.2)';
    setTimeout(() => {
      wrapper.style.borderColor = '';
      wrapper.style.boxShadow = '';
    }, 2000);
  }
}

// ─── SEARCH (with contact name support) ───
async function handleSearch(query) {
  if (!query.trim()) {
    renderConversationList(state.conversations);
    return;
  }

  const q = query.toLowerCase();

  // Search conversations by display name (which includes resolved contact names)
  const filtered = state.conversations.filter(conv => {
    const name = getDisplayName(conv).toLowerCase();
    const preview = (conv.lastMessage.text || '').toLowerCase();
    const chatId = (conv.chatIdentifier || '').toLowerCase();

    // Also search individual participant contact names
    if (conv.participants) {
      for (const p of conv.participants) {
        const contactName = resolveContactName(p);
        if (contactName && contactName.toLowerCase().includes(q)) return true;
      }
    }

    return name.includes(q) || preview.includes(q) || chatId.includes(q);
  });

  if (filtered.length > 0) {
    renderConversationList(filtered);
  } else {
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
    conversationList.innerHTML = '<div class="empty-conversations"><p>No results found</p></div>';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'search-results';

  for (const result of results) {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    const chatDisplayName = resolveContactName(result.chatName) || formatPhoneNumber(result.chatName);
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
    const displayName = getDisplayName(state.currentChat);
    const color = state.currentChat.isGroup ? 'group' : getAvatarColor(displayName);

    infoPanelContent.innerHTML = '';

    const profile = document.createElement('div');
    profile.className = 'info-profile';

    const avatarBg = state.currentChat.isGroup
      ? 'linear-gradient(135deg, #636366, #48484a)'
      : `var(--${color === 'blue' ? 'accent' : color})`;

    const avatarContent = state.currentChat.isGroup
      ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="white" opacity="0.9"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`
      : getInitials(displayName);

    profile.innerHTML = `
      <div class="info-profile-avatar" style="background:${avatarBg}">${avatarContent}</div>
      <div class="info-profile-name">${escapeHtml(displayName)}</div>
      <div class="info-profile-id">${escapeHtml(details.chatIdentifier)} &middot; ${details.service}</div>
    `;
    infoPanelContent.appendChild(profile);

    if (details.participants.length > 0) {
      const section = document.createElement('div');
      section.className = 'info-section';
      section.innerHTML = `<h4>${details.isGroup ? 'Members' : 'Contact'}</h4>`;

      for (const p of details.participants) {
        const contactName = resolveContactName(p.id) || p.displayId || formatPhoneNumber(p.id);
        const pColor = getAvatarColor(contactName);

        const pEl = document.createElement('div');
        pEl.className = 'info-participant';
        pEl.innerHTML = `
          <div class="info-participant-avatar" style="background:linear-gradient(135deg, var(--${pColor}), var(--${pColor}))">${getInitials(contactName)}</div>
          <div>
            <div class="info-participant-name">${escapeHtml(contactName)}</div>
            <div class="info-participant-id">${escapeHtml(p.id)}</div>
          </div>
        `;
        section.appendChild(pEl);
      }

      infoPanelContent.appendChild(section);
    }

    const detailSection = document.createElement('div');
    detailSection.className = 'info-section';
    detailSection.innerHTML = `
      <h4>Details</h4>
      <div class="info-detail-row">
        <span class="info-detail-label">Service</span>
        <span class="info-detail-value">${details.service}</span>
      </div>
      <div class="info-detail-row">
        <span class="info-detail-label">Type</span>
        <span class="info-detail-value">${details.isGroup ? 'Group Chat' : 'Direct Message'}</span>
      </div>
      <div class="info-detail-row">
        <span class="info-detail-label">Members</span>
        <span class="info-detail-value">${details.participants.length}</span>
      </div>
    `;
    infoPanelContent.appendChild(detailSection);

    infoPanel.style.display = 'flex';
  } catch (err) {
    console.error('Failed to load chat details:', err);
  }
}

// ─── TEXTAREA AUTO-RESIZE ───
function autoResizeTextarea() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + 'px';
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
  connectBtn.classList.add('connecting');
  connectBtnText.textContent = 'Connecting...';
  connectionError.style.display = 'none';

  try {
    await connectToServer(url);
  } catch (err) {
    connectionError.textContent = `Could not connect. Make sure the server is running on your Mac and both devices are on the same network.`;
    connectionError.style.display = 'block';
  } finally {
    connectBtn.disabled = false;
    connectBtn.classList.remove('connecting');
    connectBtnText.textContent = 'Connect';
  }
});

serverUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectBtn.click();
});

// Search
searchInput.addEventListener('input', (e) => {
  clearTimeout(state.searchTimeout);
  state.searchTimeout = setTimeout(() => handleSearch(e.target.value), 250);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    renderConversationList(state.conversations);
    searchInput.blur();
  }
});

// Message input
messageInput.addEventListener('input', autoResizeTextarea);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// Scroll to load older messages
messagesContainer.addEventListener('scroll', () => {
  if (messagesContainer.scrollTop < 150 && state.hasMoreMessages && !state.loadingOlder) {
    loadOlderMessages();
  }
});

// Settings
settingsBtn.addEventListener('click', () => {
  settingsServerUrl.value = state.serverUrl;
  settingsModal.style.display = 'flex';

  apiFetch('/api/info').then(info => {
    let tunnelHtml = '';
    if (info.tunnelUrl) {
      tunnelHtml = `
        <div class="tunnel-status active">
          <span class="tunnel-dot"></span>
          <div>
            <strong>Tunnel Active</strong><br>
            <span class="tunnel-url">${escapeHtml(info.tunnelUrl)}</span>
          </div>
        </div>
      `;
    } else {
      tunnelHtml = `
        <div class="tunnel-status inactive">
          <span class="tunnel-dot"></span>
          <span>Tunnel not active — install cloudflared on Mac for cross-network access</span>
        </div>
      `;
    }

    serverInfo.innerHTML = `
      <p><strong>Host:</strong> ${info.hostname}</p>
      <p><strong>Network:</strong> ${info.addresses.join(', ')}</p>
      <p><strong>Connection Code:</strong> <span style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${info.connectionCode || 'N/A'}</span></p>
      <p><strong>Uptime:</strong> ${Math.floor(info.uptime / 60)}m ${Math.floor(info.uptime % 60)}s</p>
      ${tunnelHtml}
    `;
  }).catch(() => {
    serverInfo.innerHTML = '<p>Could not reach server</p>';
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
    alert(`Connection failed: ${err.message}`);
  }
});

document.querySelector('.modal-overlay')?.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (settingsModal.style.display !== 'none') {
      settingsModal.style.display = 'none';
    } else if (infoPanel.style.display !== 'none') {
      infoPanel.style.display = 'none';
    }
  }
});

// Info panel
chatInfoBtn.addEventListener('click', () => {
  if (infoPanel.style.display === 'flex') {
    infoPanel.style.display = 'none';
  } else {
    showInfoPanel();
  }
});

chatHeaderInfoClick.addEventListener('click', () => {
  showInfoPanel();
});

closeInfoBtn.addEventListener('click', () => {
  infoPanel.style.display = 'none';
});

// ─── INIT ───
async function init() {
  // Render saved connections on setup screen
  renderSavedConnections();

  try {
    const savedUrl = await ipcRenderer.invoke('get-server-url');
    if (savedUrl && savedUrl !== 'http://localhost:3782') {
      serverUrlInput.value = savedUrl;
      try {
        connectBtn.disabled = true;
        connectBtnText.textContent = 'Reconnecting...';
        await connectToServer(savedUrl);
      } catch (e) {
        connectBtn.disabled = false;
        connectBtnText.textContent = 'Connect';
      }
    }
  } catch (err) {
    console.log('Not in Electron environment');
  }
}

init();
