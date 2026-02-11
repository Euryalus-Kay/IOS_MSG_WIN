const { execSync } = require('child_process');

class ContactsManager {
  constructor() {
    this.cache = null;
    this.cacheTime = 0;
    this.CACHE_TTL = 60000; // 1 minute cache
  }

  async getContacts() {
    const now = Date.now();
    if (this.cache && (now - this.cacheTime) < this.CACHE_TTL) {
      return this.cache;
    }

    try {
      // Use AppleScript to get contacts from macOS Contacts app
      const script = `
        set contactList to {}
        tell application "Contacts"
          repeat with p in every person
            set contactInfo to ""
            set contactName to (first name of p as text) & " " & (last name of p as text)

            set phoneList to ""
            repeat with ph in every phone of p
              set phoneList to phoneList & (value of ph as text) & ","
            end repeat

            set emailList to ""
            repeat with em in every email of p
              set emailList to emailList & (value of em as text) & ","
            end repeat

            set contactInfo to contactName & "|||" & phoneList & "|||" & emailList
            set end of contactList to contactInfo
          end repeat
        end tell

        set AppleScript's text item delimiters to "###"
        return contactList as text
      `;

      const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
        timeout: 30000,
        encoding: 'utf-8'
      }).trim();

      if (!result) {
        this.cache = [];
        this.cacheTime = now;
        return [];
      }

      const contacts = result.split('###').map(entry => {
        const [name, phones, emails] = entry.split('|||');
        return {
          name: (name || '').trim().replace('missing value', '').trim(),
          phones: (phones || '').split(',').filter(p => p.trim()),
          emails: (emails || '').split(',').filter(e => e.trim())
        };
      }).filter(c => c.name && c.name !== ' ');

      this.cache = contacts;
      this.cacheTime = now;
      return contacts;
    } catch (err) {
      console.error('[Contacts] Error fetching contacts:', err.message);
      // Return cached data if available, otherwise empty
      return this.cache || [];
    }
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
    // Strip everything except digits for phone comparison
    return (id || '').replace(/\D/g, '').slice(-10);
  }
}

module.exports = { ContactsManager };
