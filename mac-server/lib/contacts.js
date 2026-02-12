const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

class ContactsManager {
  constructor() {
    this.cache = null;
    this.cacheTime = 0;
    this.CACHE_TTL = 300000; // 5 minute cache
  }

  async getContacts() {
    const now = Date.now();
    if (this.cache && (now - this.cacheTime) < this.CACHE_TTL) {
      return this.cache;
    }

    try {
      const contacts = this._readContactsFromDB();
      console.log(`[Contacts] Loaded ${contacts.length} contacts from AddressBook database`);
      this.cache = contacts;
      this.cacheTime = now;
      return contacts;
    } catch (err) {
      console.error('[Contacts] Error reading contacts DB:', err.message);
      // Try AppleScript fallback
      try {
        const contacts = this._readContactsFromAppleScript();
        console.log(`[Contacts] Loaded ${contacts.length} contacts from AppleScript fallback`);
        this.cache = contacts;
        this.cacheTime = now;
        return contacts;
      } catch (fallbackErr) {
        console.error('[Contacts] AppleScript fallback also failed:', fallbackErr.message);
        return this.cache || [];
      }
    }
  }

  _readContactsFromDB() {
    const abDir = path.join(os.homedir(), 'Library', 'Application Support', 'AddressBook', 'Sources');

    if (!fs.existsSync(abDir)) {
      throw new Error('AddressBook Sources directory not found');
    }

    const sources = fs.readdirSync(abDir).filter(f => !f.startsWith('.'));
    const contactMap = new Map(); // keyed by name to deduplicate

    for (const source of sources) {
      const dbPath = path.join(abDir, source, 'AddressBook-v22.abcddb');
      if (!fs.existsSync(dbPath)) continue;

      let db;
      try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
      } catch (e) {
        console.warn(`[Contacts] Could not open source ${source}: ${e.message}`);
        continue;
      }

      try {
        // Get all contacts with their phones and emails in one query
        const rows = db.prepare(`
          SELECT
            r.Z_PK as id,
            r.ZFIRSTNAME as firstName,
            r.ZLASTNAME as lastName,
            r.ZORGANIZATION as org,
            r.ZNICKNAME as nickname
          FROM ZABCDRECORD r
          WHERE r.ZFIRSTNAME IS NOT NULL
             OR r.ZLASTNAME IS NOT NULL
             OR r.ZORGANIZATION IS NOT NULL
        `).all();

        // Batch load all phone numbers for this source
        const phoneRows = db.prepare(`
          SELECT ZOWNER as owner, ZFULLNUMBER as number
          FROM ZABCDPHONENUMBER
          WHERE ZFULLNUMBER IS NOT NULL
        `).all();

        // Batch load all emails for this source
        const emailRows = db.prepare(`
          SELECT ZOWNER as owner, ZADDRESS as address
          FROM ZABCDEMAILADDRESS
          WHERE ZADDRESS IS NOT NULL
        `).all();

        // Build lookup maps
        const phonesById = {};
        for (const p of phoneRows) {
          if (!phonesById[p.owner]) phonesById[p.owner] = [];
          phonesById[p.owner].push(p.number);
        }

        const emailsById = {};
        for (const e of emailRows) {
          if (!emailsById[e.owner]) emailsById[e.owner] = [];
          emailsById[e.owner].push(e.address);
        }

        for (const row of rows) {
          // Build the best name
          let name = '';
          if (row.firstName && row.lastName) {
            name = `${row.firstName} ${row.lastName}`;
          } else if (row.firstName) {
            name = row.firstName;
          } else if (row.lastName) {
            name = row.lastName;
          } else if (row.org) {
            name = row.org;
          }

          if (!name || name.trim().length === 0) continue;
          name = name.trim();

          const phones = (phonesById[row.id] || []).map(p => p.trim()).filter(Boolean);
          const emails = (emailsById[row.id] || []).map(e => e.trim()).filter(Boolean);

          // Skip contacts with no way to match them
          if (phones.length === 0 && emails.length === 0) continue;

          // Deduplicate by merging phones/emails into existing entry
          const key = name.toLowerCase();
          if (contactMap.has(key)) {
            const existing = contactMap.get(key);
            // Merge phones (deduplicate by digits)
            const existingDigits = new Set(existing.phones.map(p => p.replace(/\D/g, '')));
            for (const phone of phones) {
              const d = phone.replace(/\D/g, '');
              if (!existingDigits.has(d)) {
                existing.phones.push(phone);
                existingDigits.add(d);
              }
            }
            // Merge emails (deduplicate by lowercase)
            const existingEmails = new Set(existing.emails.map(e => e.toLowerCase()));
            for (const email of emails) {
              if (!existingEmails.has(email.toLowerCase())) {
                existing.emails.push(email);
                existingEmails.add(email.toLowerCase());
              }
            }
          } else {
            contactMap.set(key, { name, phones, emails });
          }
        }
      } catch (e) {
        console.warn(`[Contacts] Error reading source ${source}: ${e.message}`);
      } finally {
        try { db.close(); } catch (_) {}
      }
    }

    return Array.from(contactMap.values());
  }

  _readContactsFromAppleScript() {
    const { execSync } = require('child_process');
    const script = `
      set contactList to {}
      tell application "Contacts"
        repeat with p in every person
          set contactInfo to ""
          set fullName to ""
          try
            set fullName to name of p as text
            if fullName is "missing value" then set fullName to ""
          end try
          if fullName is "" then
            try
              set fullName to (first name of p as text) & " " & (last name of p as text)
              if fullName is "missing value missing value" then set fullName to ""
            end try
          end if

          set phoneList to ""
          repeat with ph in every phone of p
            try
              set phoneList to phoneList & (value of ph as text) & ","
            end try
          end repeat

          set emailList to ""
          repeat with em in every email of p
            try
              set emailList to emailList & (value of em as text) & ","
            end try
          end repeat

          if fullName is not "" then
            set contactInfo to fullName & "|||" & phoneList & "|||" & emailList
            set end of contactList to contactInfo
          end if
        end repeat
      end tell
      set AppleScript's text item delimiters to "###"
      return contactList as text
    `;

    const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: 120000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 10
    }).trim();

    if (!result) return [];

    return result.split('###').map(entry => {
      const [name, phones, emails] = entry.split('|||');
      return {
        name: (name || '').trim().replace(/missing value/gi, '').trim(),
        phones: (phones || '').split(',').map(p => p.trim()).filter(p => p && p !== 'missing value'),
        emails: (emails || '').split(',').map(e => e.trim()).filter(e => e && e !== 'missing value')
      };
    }).filter(c => c.name && c.name.length > 0);
  }

  // Look up a contact name by phone number or email
  async lookupContact(identifier) {
    const contacts = await this.getContacts();
    const normalized = this.normalizeIdentifier(identifier);

    for (const contact of contacts) {
      for (const phone of contact.phones) {
        if (this.normalizeIdentifier(phone) === normalized) {
          return contact;
        }
      }
      for (const email of contact.emails) {
        if (email.toLowerCase() === identifier.toLowerCase()) {
          return contact;
        }
      }
    }
    return null;
  }

  normalizeIdentifier(id) {
    return (id || '').replace(/\D/g, '').slice(-10);
  }
}

module.exports = { ContactsManager };
