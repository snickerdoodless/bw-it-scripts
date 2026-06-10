# JumpCloud Admin Tools

Multi-command CLI for JumpCloud administration tasks.

## Features

### 🔐 Grant — Temporary Admin Access
- ⏱️ **Configurable duration** — default 24h, options: 1h, 4h, 8h, 12h, 24h, 48h, 72h
- 👥 **Bulk users** — manual entry (comma-separated emails), CSV file, or passed as CLI arguments
- 🔍 **All Device Support** — grants admin on **all** bound devices (online and offline)
- ⏭️ **Graceful Skip** — safely skips devices that already have sudo privileges without spamming Slack
- ⏳ **Auto-expiry** — JumpCloud automatically revokes admin when the timer expires
- 🔄 **Error rollback** — if a grant fails mid-batch, all previous grants are revoked

### 🔑 Reset — Password Reset
- 🔒 **Default password** — configurable via `DEFAULT_RESET_PASSWORD` in `.env`
- ✏️ **Custom password** — override via `--password "YourPassword"` or interactive prompt
- 👥 **Bulk users** — same batch/single/CSV support as grant
- 🔄 **Force change** — sets `password_never_expires: false` so users must change their password according to the 3-month policy

### 🛠️ Shared Features
- 🧪 **Dry-run mode** — preview everything without making changes
- 📨 **Slack reporting** — sends formatted report to Slack channel with CC
- 📝 **Audit logging** — JSON logs saved daily in `logs/` folder
- 🔑 **API key monitoring** — blocks + alerts on expired API key

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Setup Global Command (Optional):**
   Register the `jc-admin` command globally on your system.

   **Option A: Using NPM Link (Recommended)**
   ```bash
   npm link
   ```

   **Option B: Using Global Install**
   ```bash
   npm install -g .
   ```

3. **Configure `.env` file:**
   ```env
   JC_API_KEY=your-jumpcloud-api-key
   JC_ORG_ID=your-org-id
   JC_API_URL=https://console.jumpcloud.com
   SLACK_WEBHOOK=https://hooks.slack.com/services/xxx/xxx/xxx
   SLACK_CHANNEL=your-channel-id
   SLACK_CC_USER=your-user-id
   DEFAULT_RESET_PASSWORD=YourDefaultPassword123!
   ```

## Usage

### Top-Level Help
```bash
jc-admin --help
# or
jc-admin -h
```

---

### Grant Command

Grant temporary admin/sudo privileges on JumpCloud-managed devices.

#### Interactive mode
```bash
jc-admin grant
```

#### Auto mode (Fast Lane)
Skip all prompts and grant admin immediately for the default 24 hours.
```bash
jc-admin grant john@company.com jane@company.com
```

#### Dry-run mode
```bash
jc-admin grant --dry-run
jc-admin grant user@company.com --dry-run
```

#### Grant help
```bash
jc-admin grant --help
```

#### Example session
```
🔐 JumpCloud Admin Grant Tool
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔑 Validating API key... OK ✓

? How do you want to input users?
  ❯ 📝 Manual entry (type/paste emails)
    📄 CSV file

? Enter user emails (comma-separated): john@company.com, jane@company.com

? Select admin duration: 24 hours (default)

? Enable dry-run mode? No

🔍 Looking up users...
   john@company.com ... John Doe ✓
     ✅ MacBook-Pro-John (online)
   jane@company.com ... Jane Smith ✓
     ✅ MacBook-Air-Jane (online)

┌──────────────────────┬──────────────────┬───────┬────────────────────┐
│ User                 │ Device           │ OS    │ Expires            │
├──────────────────────┼──────────────────┼───────┼────────────────────┤
│ john@company.com     │ MacBook-Pro-John │ macOS │ 11 Jun 2026 11:16  │
│ jane@company.com     │ MacBook-Air-Jane │ macOS │ 11 Jun 2026 11:16  │
└──────────────────────┴──────────────────┴───────┴────────────────────┘

? Proceed with granting admin to 2 device(s)? Yes

🚀 Granting admin access...
   john@company.com → MacBook-Pro-John ... ✓
   jane@company.com → MacBook-Air-Jane ... ✓

📨 Slack report sent to channel.
📝 Audit log: logs/audit-2026-06-10.json

✨ Done! Admin granted to 2 device(s) (auto-expires in 24 hours)
```

---

### Reset Command

Reset user passwords on JumpCloud.

#### Interactive mode
```bash
jc-admin reset
```

#### Auto mode (Default password)
```bash
jc-admin reset john@company.com jane@company.com
```

#### Auto mode (Custom password)
```bash
jc-admin reset john@company.com --password "NewPass123!"
```

#### Dry-run mode
```bash
jc-admin reset --dry-run
jc-admin reset user@company.com --dry-run
```

#### Reset help
```bash
jc-admin reset --help
```

#### Example session
```
🔑 JumpCloud Password Reset Tool
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔑 Validating API key... OK ✓

⚡ Auto-mode active for: john@company.com, jane@company.com

🔒 Using default password: Y********************!

🔍 Looking up users...
   john@company.com ... John Doe ✓
   jane@company.com ... Jane Smith ✓

┌──────────────────────┬──────────────────┬──────────────────────┐
│ User                 │ Display Name     │ Password             │
├──────────────────────┼──────────────────┼──────────────────────┤
│ john@company.com     │ John Doe         │ Default (Yo*****1!)  │
│ jane@company.com     │ Jane Smith       │ Default (Yo*****1!)  │
└──────────────────────┴──────────────────┴──────────────────────┘

⚡ Auto-mode: skipping confirmation.

🚀 Resetting passwords...
   john@company.com ... ✓
   jane@company.com ... ✓

📨 Slack report sent to channel.
📝 Audit log: logs/audit-2026-06-10.json

✨ Done! Password reset for 2 user(s).
```

## CSV Format

Create a CSV with an `email` column:

```csv
email
john@company.com
jane@company.com
bob@company.com
```

See `templates/users-template.csv` for a template.

## Error Handling

### Grant Command
If a grant fails mid-batch, the script will:
1. **Immediately stop** further grants
2. **Revoke all previously granted** access in this batch
3. **Send error report** to Slack with rollback status
4. **Log everything** to audit file

### Reset Command
If a reset fails, the script will:
1. **Continue** with remaining users (no rollback needed)
2. **Report failures** in the summary and Slack report
3. **Log everything** to audit file

### API Key
If the API key is expired, both commands will:
1. **Block execution** — won't attempt any operations
2. **Send Slack alert** to notify the team

## File Structure

```
jumpcloud-admin-tools/
├── .env                  # Config (secrets, gitignored)
├── .env.example          # Template
├── .gitignore
├── package.json
├── index.js              # CLI entry point & command router
├── commands/
│   ├── grant.js          # Grant admin command handler
│   └── reset.js          # Reset password command handler
├── lib/
│   ├── jumpcloud-api.js  # JumpCloud API wrapper
│   ├── slack-notify.js   # Slack webhook notifications
│   ├── csv-handler.js    # CSV parsing
│   └── audit-logger.js   # Local audit logging
├── templates/
│   └── users-template.csv
├── logs/                 # Auto-created daily audit logs
├── CHANGELOG.md
└── README.md
```

## API Key

- JumpCloud API keys expire after **30 days**
- Generate a new key: JumpCloud Admin Console → API Settings
- The script checks validity on every run
