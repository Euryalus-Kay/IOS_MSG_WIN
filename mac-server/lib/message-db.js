const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

class MessageDB {
  constructor(dbPath) {
    this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
    this.db.pragma('journal_mode = WAL');
  }

  // Get all conversations with last message preview
  getConversations() {
    const stmt = this.db.prepare(`
      SELECT
        c.ROWID as chat_id,
        c.guid as chat_guid,
        c.display_name,
        c.chat_identifier,
        c.service_name,
        c.style as chat_style,
        (SELECT COUNT(*) FROM chat_message_join cmj2 WHERE cmj2.chat_id = c.ROWID) as message_count,
        m.ROWID as last_message_rowid,
        m.text as last_message_text,
        m.date as last_message_date,
        m.is_from_me as last_message_from_me,
        m.cache_has_attachments as has_attachments,
        GROUP_CONCAT(DISTINCT h.id) as participant_ids
      FROM chat c
      LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
      LEFT JOIN message m ON m.ROWID = cmj.message_id
      LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
      LEFT JOIN handle h ON h.ROWID = chj.handle_id
      WHERE m.ROWID = (
        SELECT MAX(cmj3.message_id)
        FROM chat_message_join cmj3
        WHERE cmj3.chat_id = c.ROWID
      )
      GROUP BY c.ROWID
      ORDER BY m.date DESC
    `);

    const rows = stmt.all();
    return rows.map(row => ({
      chatId: row.chat_id,
      chatGuid: row.chat_guid,
      displayName: row.display_name || row.chat_identifier,
      chatIdentifier: row.chat_identifier,
      service: row.service_name,
      isGroup: row.chat_style === 43,
      messageCount: row.message_count,
      lastMessage: {
        text: row.last_message_text,
        date: this.convertAppleTimestamp(row.last_message_date),
        isFromMe: row.last_message_from_me === 1,
        hasAttachments: row.has_attachments === 1
      },
      participants: row.participant_ids ? row.participant_ids.split(',') : []
    }));
  }

  // Get messages for a specific conversation
  getMessages(chatId, limit = 50, offset = 0) {
    const stmt = this.db.prepare(`
      SELECT
        m.ROWID as rowid,
        m.guid as message_guid,
        m.text,
        m.date as message_date,
        m.date_delivered,
        m.date_read,
        m.is_from_me,
        m.cache_has_attachments as has_attachments,
        m.associated_message_guid,
        m.associated_message_type,
        m.expressive_send_style_id,
        m.thread_originator_guid,
        m.thread_originator_part,
        m.group_action_type,
        m.item_type,
        h.id as sender_id,
        h.uncanonicalized_id as sender_display,
        (
          SELECT GROUP_CONCAT(a.filename || '|||' || a.mime_type || '|||' || a.transfer_name, '###')
          FROM message_attachment_join maj
          JOIN attachment a ON a.ROWID = maj.attachment_id
          WHERE maj.message_id = m.ROWID
        ) as attachments_raw
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE cmj.chat_id = ?
      ORDER BY m.date DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(chatId, limit, offset);
    return rows.map(row => this.formatMessage(row)).reverse();
  }

  // Get conversation details including participants
  getConversationDetails(chatId) {
    const chatStmt = this.db.prepare(`
      SELECT
        c.ROWID as chat_id,
        c.guid as chat_guid,
        c.display_name,
        c.chat_identifier,
        c.service_name,
        c.style as chat_style
      FROM chat c
      WHERE c.ROWID = ?
    `);

    const chat = chatStmt.get(chatId);
    if (!chat) return null;

    const participantsStmt = this.db.prepare(`
      SELECT h.id, h.uncanonicalized_id, h.service
      FROM chat_handle_join chj
      JOIN handle h ON h.ROWID = chj.handle_id
      WHERE chj.chat_id = ?
    `);

    const participants = participantsStmt.all(chatId);

    return {
      chatId: chat.chat_id,
      chatGuid: chat.chat_guid,
      displayName: chat.display_name || chat.chat_identifier,
      chatIdentifier: chat.chat_identifier,
      service: chat.service_name,
      isGroup: chat.chat_style === 43,
      participants: participants.map(p => ({
        id: p.id,
        displayId: p.uncanonicalized_id || p.id,
        service: p.service
      }))
    };
  }

  // Search messages across all conversations
  searchMessages(query, limit = 50) {
    const stmt = this.db.prepare(`
      SELECT
        m.ROWID as rowid,
        m.text,
        m.date as message_date,
        m.is_from_me,
        h.id as sender_id,
        c.ROWID as chat_id,
        c.display_name,
        c.chat_identifier
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.text LIKE ?
      ORDER BY m.date DESC
      LIMIT ?
    `);

    const rows = stmt.all(`%${query}%`, limit);
    return rows.map(row => ({
      rowid: row.rowid,
      text: row.text,
      date: this.convertAppleTimestamp(row.message_date),
      isFromMe: row.is_from_me === 1,
      senderId: row.sender_id,
      chatId: row.chat_id,
      chatName: row.display_name || row.chat_identifier
    }));
  }

  // Get new messages since a given ROWID
  getNewMessages(sinceRowId) {
    const stmt = this.db.prepare(`
      SELECT
        m.ROWID as rowid,
        m.guid as message_guid,
        m.text,
        m.date as message_date,
        m.is_from_me,
        m.cache_has_attachments as has_attachments,
        h.id as sender_id,
        h.uncanonicalized_id as sender_display,
        c.ROWID as chat_id,
        c.display_name,
        c.chat_identifier,
        c.style as chat_style,
        (
          SELECT GROUP_CONCAT(a.filename || '|||' || a.mime_type || '|||' || a.transfer_name, '###')
          FROM message_attachment_join maj
          JOIN attachment a ON a.ROWID = maj.attachment_id
          WHERE maj.message_id = m.ROWID
        ) as attachments_raw
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.ROWID > ?
      ORDER BY m.date ASC
    `);

    return stmt.all(sinceRowId).map(row => ({
      ...this.formatMessage(row),
      chatId: row.chat_id,
      chatName: row.display_name || row.chat_identifier,
      isGroup: row.chat_style === 43
    }));
  }

  // Get the last message ROWID
  getLastRowId() {
    const stmt = this.db.prepare('SELECT MAX(ROWID) as maxId FROM message');
    const result = stmt.get();
    return result ? result.maxId : 0;
  }

  // Get tapback reactions for messages in a chat
  getReactionsForChat(chatId) {
    const stmt = this.db.prepare(`
      SELECT
        m.associated_message_guid,
        m.associated_message_type,
        m.is_from_me,
        h.id as sender_id
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE cmj.chat_id = ?
        AND m.associated_message_type IS NOT NULL
        AND m.associated_message_type != 0
    `);

    const rows = stmt.all(chatId);
    const reactionMap = {};

    for (const row of rows) {
      const guid = row.associated_message_guid;
      if (!guid) continue;

      // Clean up the GUID - remove the "p:X/" prefix if present
      const cleanGuid = guid.replace(/^p:\d+\//, '').replace(/^bp:/, '');

      if (!reactionMap[cleanGuid]) reactionMap[cleanGuid] = [];

      const type = row.associated_message_type;
      const isRemoval = type >= 3000 && type <= 3005;
      const reactionType = type >= 3000 ? type - 1000 : type;

      const REACTION_EMOJIS = {
        2000: '\u2764\uFE0F',
        2001: '\uD83D\uDC4D',
        2002: '\uD83D\uDC4E',
        2003: '\uD83D\uDE02',
        2004: '\u2757\u2757',
        2005: '\u2753'
      };

      if (isRemoval) {
        const idx = reactionMap[cleanGuid].findIndex(
          r => r.type === reactionType && r.senderId === (row.sender_id || (row.is_from_me ? '__me__' : null))
        );
        if (idx !== -1) reactionMap[cleanGuid].splice(idx, 1);
      } else {
        reactionMap[cleanGuid].push({
          type: reactionType,
          emoji: REACTION_EMOJIS[reactionType] || '\u2764\uFE0F',
          senderId: row.sender_id || (row.is_from_me ? '__me__' : null),
          isFromMe: row.is_from_me === 1
        });
      }
    }

    return reactionMap;
  }

  // Format a message row into a clean object
  formatMessage(row) {
    const attachments = [];
    if (row.attachments_raw) {
      const parts = row.attachments_raw.split('###');
      for (const part of parts) {
        const [filename, mimeType, transferName] = part.split('|||');
        if (filename) {
          attachments.push({
            filename: filename.replace('~/', path.join(os.homedir(), '/')),
            mimeType: mimeType || 'application/octet-stream',
            transferName: transferName || path.basename(filename)
          });
        }
      }
    }

    return {
      rowid: row.rowid,
      guid: row.message_guid,
      text: row.text,
      date: this.convertAppleTimestamp(row.message_date),
      dateDelivered: row.date_delivered ? this.convertAppleTimestamp(row.date_delivered) : null,
      dateRead: row.date_read ? this.convertAppleTimestamp(row.date_read) : null,
      isFromMe: row.is_from_me === 1,
      senderId: row.sender_id,
      senderDisplay: row.sender_display || row.sender_id,
      hasAttachments: row.has_attachments === 1,
      attachments,
      associatedMessageGuid: row.associated_message_guid || null,
      associatedMessageType: row.associated_message_type || 0,
      expressiveSendStyle: row.expressive_send_style_id || null,
      threadOriginatorGuid: row.thread_originator_guid || null,
      isGroupAction: row.group_action_type > 0,
      itemType: row.item_type || 0
    };
  }

  // Convert Apple's Core Data timestamp to JS Date ISO string
  // Apple uses nanoseconds since 2001-01-01
  convertAppleTimestamp(timestamp) {
    if (!timestamp) return null;
    // Handle both nanosecond and second timestamps
    const seconds = timestamp > 1e15 ? timestamp / 1e9 : timestamp;
    const appleEpoch = new Date('2001-01-01T00:00:00Z').getTime() / 1000;
    const unixTimestamp = seconds + appleEpoch;
    return new Date(unixTimestamp * 1000).toISOString();
  }

  close() {
    this.db.close();
  }
}

module.exports = { MessageDB };
