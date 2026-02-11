const { execSync } = require('child_process');

class ContactsManager {
  constructor() {
    this.cache = null;
    this.cacheTime = 0;
    this.CACHE_TTL = 300000; // 5 minute cache (was 1 min — contacts don't change often)
  }

  async getContacts() {
    const now = Date.now();
    if (this.cache && (now - this.cacheTime) < this.CACHE_TTL) {
      return this.cache;
    }

    try {
      // Use AppleScript to get contacts from macOS Contacts app
      // Handles missing first/last names gracefully
      const script = `
        set contactList to {}
        tell application "Contacts"
          repeat with p in every person
            set contactInfo to ""

            set firstName to ""
            set lastName to ""
            try
              set firstName to first name of p as text
              if firstName is "missing value" then set firstName to ""
            end try
            try
              set lastName to last name of p as text
              if lastName is "missing value" then set lastName to ""
            end try

            -- Also try the full name/display name
            set fullName to ""
            try
              set fullName to name of p as text
              if fullName is "missing value" then set fullName to ""
            end try

            -- Build the best name we can
            set contactName to ""
            if fullName is not "" then
              set contactName to fullName
            else if firstName is not "" and lastName is not "" then
              set contactName to firstName & " " & lastName
            else if firstName is not "" then
              set contactName to firstName
            else if lastName is not "" then
              set contactName to lastName
            end if

            -- Also grab the company/organization name as fallback
            set orgName to ""
            try
              set orgName to organization of p as text
              if orgName is "missing value" then set orgName to ""
            end try

            if contactName is "" and orgName is not "" then
              set contactName to orgName
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

            if contactName is not "" then
              set contactInfo to contactName & "|||" & phoneList & "|||" & emailList
              set end of contactList to contactInfo
            end if
          end repeat
        end tell

        set AppleScript's text item delimiters to "###"
        return contactList as text
      `;

      const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
        timeout: 60000, // Give it 60s for large contact lists
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer for large contact lists
      }).trim();

      if (!result) {
        this.cache = [];
        this.cacheTime = now;
        return [];
      }

      const contacts = result.split('###').map(entry => {
        const [name, phones, emails] = entry.split('|||');
        return {
          name: (name || '').trim()
            .replace(/missing value/gi, '')
            .replace(/\s+/g, ' ')
            .trim(),
          phones: (phones || '').split(',').map(p => p.trim()).filter(p => p && p !== 'missing value'),
          emails: (emails || '').split(',').map(e => e.trim()).filter(e => e && e !== 'missing value')
        };
      }).filter(c => c.name && c.name.length > 0);

      console.log(`[Contacts] Loaded ${contacts.length} contacts`);
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
