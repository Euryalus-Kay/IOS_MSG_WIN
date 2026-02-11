const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class AppleScriptSender {
  // Send a message to an individual recipient via iMessage
  async sendMessage(recipient, message) {
    const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedRecipient = recipient.replace(/"/g, '\\"');

    const script = `
      tell application "Messages"
        set targetService to 1st account whose service type = iMessage
        set targetBuddy to participant "${escapedRecipient}" of targetService
        send "${escapedMessage}" to targetBuddy
      end tell
    `;

    try {
      await this.runAppleScript(script);
      console.log(`[Send] Message sent to ${recipient}`);
      return true;
    } catch (err) {
      // Fallback: try using the buddy approach
      const fallbackScript = `
        tell application "Messages"
          set targetBuddy to a reference to buddy "${escapedRecipient}" of service 1
          send "${escapedMessage}" to targetBuddy
        end tell
      `;
      try {
        await this.runAppleScript(fallbackScript);
        console.log(`[Send] Message sent to ${recipient} (fallback)`);
        return true;
      } catch (err2) {
        console.error(`[Send] Failed to send to ${recipient}:`, err2.message);
        throw new Error(`Failed to send message: ${err2.message}`);
      }
    }
  }

  // Send a message to a group chat by name
  async sendToGroup(groupName, message) {
    const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedGroupName = groupName.replace(/"/g, '\\"');

    const script = `
      tell application "Messages"
        set targetChat to a reference to chat "${escapedGroupName}"
        send "${escapedMessage}" to targetChat
      end tell
    `;

    try {
      await this.runAppleScript(script);
      console.log(`[Send] Message sent to group "${groupName}"`);
      return true;
    } catch (err) {
      console.error(`[Send] Failed to send to group "${groupName}":`, err.message);
      throw new Error(`Failed to send to group: ${err.message}`);
    }
  }

  // Execute an AppleScript
  async runAppleScript(script) {
    const escaped = script.replace(/'/g, "'\\''");
    const { stdout, stderr } = await execAsync(`osascript -e '${escaped}'`, {
      timeout: 15000
    });
    if (stderr && !stderr.includes('missing value')) {
      console.warn('[AppleScript] Warning:', stderr);
    }
    return stdout.trim();
  }
}

module.exports = { AppleScriptSender };
