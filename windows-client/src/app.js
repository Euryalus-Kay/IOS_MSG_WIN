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
  // If it looks like a phone number, show last 2 digits
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

  const info = await apiFetch('/api/info');
  console.log('Connected to server:', info);

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
      for (const phone of contact.phones) {
        const norm = phone.replace(/\D/g, '').slice(-10);
        if (norm.length >= 7) state.contactMap[norm] = contact.name;
      }
      for (const email of contact.emails) {
        state.contactMap[email.toLowerCase()] = contact.name;
      }
    }
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
  const lower = identifier.toLowerCase();
  if (state.contactMap[lower]) return state.contactMap[lower];
  const norm = identifier.replace(/\D/g, '').slice(-10);
  if (norm.length >= 7 && state.contactMap[norm]) return state.contactMap[norm];
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

    // Group icon SVG for group chats
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

  try {
    const messages = await apiFetch(`/api/conversations/${conv.chatId}/messages?limit=100`);
    state.messages = messages;
    renderMessages(messages, conv.isGroup);
    scrollToBottom(false);
  } catch (err) {
    console.error('Failed to load messages:', err);
    messagesList.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);padding:40px;">Failed to load messages</p>';
  }

  messageInput.focus();
}

// ─── RENDER MESSAGES ───
function renderMessages(messages, isGroup) {
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
      sep.textContent = formatDateSeparator(msg.date);
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

    // Skip tapback/reaction messages
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
        img.onerror = () => { img.style.display = 'none'; };
        attEl.appendChild(img);
      } else {
        attEl.innerHTML = `
          <div class="attachment-file">
            <div class="attachment-file-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
            </div>
            <span>${escapeHtml(att.transferName || 'File')}</span>
          </div>
        `;
      }
      row.appendChild(attEl);
    }

    // Metadata (time + delivery status) — shown on hover or last message
    const isLastMsg = i === messages.length - 1;
    const nextIsDifferentSender = !nextMsg || (nextMsg.isFromMe !== msg.isFromMe);

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = formatMessageTime(msg.date);
    meta.appendChild(timeSpan);

    // Delivery / read status for sent messages
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

function scrollToBottom(smooth = true) {
  requestAnimationFrame(() => {
    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant'
    });
  });
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

  // Optimistic UI: show message immediately
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
    // Flash the input red briefly
    const wrapper = messageInput.closest('.message-input-wrapper');
    wrapper.style.borderColor = 'var(--red)';
    wrapper.style.boxShadow = '0 0 0 3px rgba(255,59,48,0.2)';
    setTimeout(() => {
      wrapper.style.borderColor = '';
      wrapper.style.boxShadow = '';
    }, 2000);
  }
}

// ─── SEARCH ───
async function handleSearch(query) {
  if (!query.trim()) {
    renderConversationList(state.conversations);
    return;
  }

  const q = query.toLowerCase();
  const filtered = state.conversations.filter(conv => {
    const name = getDisplayName(conv).toLowerCase();
    const preview = (conv.lastMessage.text || '').toLowerCase();
    return name.includes(q) || preview.includes(q);
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

    // Profile header
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

    // Participants section
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

    // Details section
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

// Escape to clear search
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

// Settings
settingsBtn.addEventListener('click', () => {
  settingsServerUrl.value = state.serverUrl;
  settingsModal.style.display = 'flex';

  apiFetch('/api/info').then(info => {
    serverInfo.innerHTML = `
      <p><strong>Host:</strong> ${info.hostname}</p>
      <p><strong>Network:</strong> ${info.addresses.join(', ')}</p>
      <p><strong>Uptime:</strong> ${Math.floor(info.uptime / 60)}m ${Math.floor(info.uptime % 60)}s</p>
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

// Escape to close modal
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
