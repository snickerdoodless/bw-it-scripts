# JumpCloud Auto-Grant Admin

CLI tool to grant **temporary admin/sudo privileges** on JumpCloud-managed devices.

## Features

- ⏱️ **Configurable duration** — default 24h, options: 1h, 4h, 8h, 12h, 24h, 48h, 72h
- 👥 **Bulk users** — manual entry (comma-separated emails), CSV file, or passed as CLI arguments
- 🔍 **All Device Support** — grants admin on **all** bound devices (online and offline)
- ⏭️ **Graceful Skip** — safely skips devices that already have sudo privileges without spamming Slack
- ⏳ **Auto-expiry** — JumpCloud automatically revokes admin when the timer expires
- 🔄 **Error rollback** — if a grant fails mid-batch, all previous grants are revoked
- 🧪 **Dry-run mode** — preview everything without making changes
- 📨 **Slack reporting** — sends formatted report to Slack channel with CC
- 📝 **Audit logging** — JSON logs saved daily in `logs/` folder
- 🔑 **API key monitoring** — blocks + alerts on expired API key

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Setup Global Command (Tutorial - Optional):**
   If you want to run this script from anywhere without needing to navigate to this folder every time, you can register the `jc-admin` command globally on your system.
   
   **Option A: Using NPM Link (Recommended)**
   Creates a symlink to this directory.
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
   ```

## Usage

### Helpful Manual
To see the CLI options and usage instructions, simply run:
```bash
jc-admin --help
# or
jc-admin -h
```

### Interactive mode
```bash
node grant-admin.js
# Or if installed globally:
jc-admin
```

### Auto mode (Fast Lane)
Skip all prompts and grant admin immediately for the default 24 hours. Just pass the emails as arguments.
```bash
node grant-admin.js john@company.com jane@company.com
# Or if installed globally:
jc-admin john@company.com jane@company.com
```

### Dry-run mode (preview only)
```bash
node grant-admin.js --dry-run
# or
npm run dry-run
```

### Example session
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
     ⚠️  Desktop-John (offline, skipped)
   jane@company.com ... Jane Smith ✓
     ✅ MacBook-Air-Jane (online)

┌──────────────────────┬──────────────────┬───────┬────────────────────┐
│ User                 │ Device           │ OS    │ Expires            │
├──────────────────────┼──────────────────┼───────┼────────────────────┤
│ john@company.com     │ MacBook-Pro-John │ macOS │ 06 Jun 2026 11:16  │
│ jane@company.com     │ MacBook-Air-Jane │ macOS │ 06 Jun 2026 11:16  │
└──────────────────────┴──────────────────┴───────┴────────────────────┘

? Proceed with granting admin to 2 device(s)? Yes

🚀 Granting admin access...
   john@company.com → MacBook-Pro-John ... ✓
   jane@company.com → MacBook-Air-Jane ... ✓

📨 Slack report sent to channel.
📝 Audit log: logs/audit-2026-06-05.json

✨ Done! Admin granted to 2 device(s) (auto-expires in 24 hours)
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

If a grant fails mid-batch, the script will:
1. **Immediately stop** further grants
2. **Revoke all previously granted** access in this batch
3. **Send error report** to Slack with rollback status
4. **Log everything** to audit file

If the API key is expired, the script will:
1. **Block execution** — won't attempt any grants
2. **Send Slack alert** to notify the team

## File Structure

```
auto-granted-admin-jc/
├── .env                  # Config (secrets, gitignored)
├── .env.example          # Template
├── .gitignore
├── package.json
├── grant-admin.js        # Main CLI script
├── lib/
│   ├── jumpcloud-api.js  # JumpCloud API wrapper
│   ├── slack-notify.js   # Slack webhook notifications
│   ├── csv-handler.js    # CSV parsing
│   └── audit-logger.js   # Local audit logging
├── templates/
│   └── users-template.csv
├── logs/                 # Auto-created daily audit logs
└── README.md
```

## API Key

- JumpCloud API keys expire after **30 days**
- Generate a new key: JumpCloud Admin Console → API Settings
- The script checks validity on every run
