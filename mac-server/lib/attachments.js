const path = require('path');
const fs = require('fs');
const os = require('os');

class AttachmentServer {
  constructor(basePath) {
    this.basePath = basePath;
  }

  // Get an attachment file path by filename
  getAttachmentPath(filename) {
    const searchPath = path.join(this.basePath, '**', filename);
    // Search recursively in the Attachments directory
    const found = this.findFile(this.basePath, filename);
    return found;
  }

  // Resolve a full attachment path (from the DB)
  resolveAttachmentPath(dbPath) {
    // DB stores paths like ~/Library/Messages/Attachments/xx/xx/GUID/filename.ext
    let resolved = dbPath;
    if (resolved.startsWith('~/')) {
      resolved = resolved.replace('~/', path.join(os.homedir(), '/'));
    }

    if (fs.existsSync(resolved)) {
      return resolved;
    }

    return null;
  }

  // Recursively find a file in a directory
  findFile(dir, filename, depth = 0) {
    if (depth > 5) return null;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === filename) {
          return fullPath;
        }
        if (entry.isDirectory()) {
          const found = this.findFile(fullPath, filename, depth + 1);
          if (found) return found;
        }
      }
    } catch (err) {
      // Permission denied or other error
    }
    return null;
  }
}

module.exports = { AttachmentServer };
