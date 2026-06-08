# Changelog

All notable changes to this project will be documented in this file.

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
