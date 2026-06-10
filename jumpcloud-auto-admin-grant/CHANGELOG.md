# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-06-10

### Added
- **Multi-command CLI architecture** — the tool now uses subcommands: `jc-admin grant` and `jc-admin reset`.
- **Password Reset command** (`jc-admin reset`) — reset user passwords in batch or single mode.
  - Supports batch (CSV or comma-separated) and single user modes.
  - Default password configurable via `DEFAULT_RESET_PASSWORD` in `.env`.
  - Custom password via `--password "YourPassword"` flag.
  - Sets `password_never_expires: false` to enforce the organizational 3-month expiration policy.
  - Dry-run mode support (`--dry-run`).
  - Slack reporting with masked password display.
  - Audit logging (never logs actual passwords, only "default" or "custom").
- **New entry point** (`index.js`) — command router that dispatches to `commands/grant.js` or `commands/reset.js`.
- **Interactive mode** for both commands — run `jc-admin grant` or `jc-admin reset` without arguments for interactive prompts.
- **Per-command help** — `jc-admin grant --help` and `jc-admin reset --help` for command-specific usage.

### Changed
- **BREAKING:** CLI syntax changed from `jc-admin [emails...]` to `jc-admin grant [emails...]`. Users must specify the subcommand.
- Project renamed from `auto-granted-admin-jc` to `jc-admin-tools`.
- Version bumped to `2.0.0`.
- `package.json` bin entry now points to `index.js` instead of `grant-admin.js`.
- Running `jc-admin` without a subcommand now shows the top-level help menu.

### Removed
- `grant-admin.js` — logic moved to `commands/grant.js` and routed via `index.js`.

### Fixed
- Fixed `MODULE_NOT_FOUND` error (`Cannot find module '...grant-admin.js'`) when upgrading from `v1.0.1` by requiring re-running `npm link` to update the global executable path to the new `index.js`.

### Migration
- Run `npm unlink -g` then `npm link` to update the global `jc-admin` command.
- Add `DEFAULT_RESET_PASSWORD` to your `.env` file (see `.env.example`).

## [1.0.1] - 2026-06-08

### Added
- Added a manual entry / help menu accessible via the `-h` and `--help` flags.
- Added `bin` configuration to `package.json` to allow global CLI execution via the `jc-admin` command.
- Updated `dotenv` to explicitly load `.env` from the project's absolute installation path (`__dirname`) instead of the current working directory, enabling reliable global execution from any path.
- Added a `CHANGELOG.md` to track script changes.
- Updated `README.md` with global installation instructions.

### Fixed
- Fixed Slack notification logic to correctly tag user IDs using the `<@USER_ID>` syntax instead of the user group syntax `<!subteam^>`.

## [1.0.0] - Initial Release
- Initial stable release of the JumpCloud Auto-Grant Admin script.
- Support for interactive CLI or batch mode via arguments.
- Rollback execution via JumpCloud access requests if partial batch failure occurs.
- Activity slack reporting via webhooks.
- Audit logging into local daily JSON files.
