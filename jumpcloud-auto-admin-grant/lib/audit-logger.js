/**
 * Audit Logger Module
 * Saves grant/rollback activity to daily JSON log files.
 */

const fs = require("fs");
const path = require("path");

const LOGS_DIR = path.join(__dirname, "..", "logs");

/**
 * Make sure the logs directory exists.
 */
function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Get today's log file path.
 */
function getLogFilePath() {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(LOGS_DIR, `audit-${today}.json`);
}

/**
 * Read existing log entries for today, or return empty array.
 */
function readTodayLog() {
  const logFile = getLogFilePath();
  if (fs.existsSync(logFile)) {
    try {
      const content = fs.readFileSync(logFile, "utf-8");
      return JSON.parse(content);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Append an entry to today's log.
 */
function appendLog(entry) {
  ensureLogsDir();
  const entries = readTodayLog();
  entries.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  fs.writeFileSync(getLogFilePath(), JSON.stringify(entries, null, 2), "utf-8");
}

/**
 * Log a successful admin grant.
 */
function logGrant({ email, displayName, deviceName, deviceId, accessId, duration, expiresAt }) {
  appendLog({
    action: "GRANT",
    email,
    displayName,
    deviceName,
    deviceId,
    accessId,
    duration,
    expiresAt,
    status: "SUCCESS",
  });
}

/**
 * Log a skipped device (offline).
 */
function logSkipped({ email, deviceName, deviceId, reason }) {
  appendLog({
    action: "SKIP",
    email,
    deviceName,
    deviceId,
    reason,
    status: "SKIPPED",
  });
}

/**
 * Log a rollback (revocation due to error).
 */
function logRollback({ email, deviceName, deviceId, accessId, revokeSuccess, error }) {
  appendLog({
    action: "ROLLBACK",
    email,
    deviceName,
    deviceId,
    accessId,
    revokeSuccess,
    error: error || null,
    status: revokeSuccess ? "REVOKED" : "REVOKE_FAILED",
  });
}

/**
 * Log when a user is not found in JumpCloud.
 */
function logNotFound({ email }) {
  appendLog({
    action: "NOT_FOUND",
    email,
    status: "USER_NOT_FOUND",
  });
}

module.exports = {
  logGrant,
  logSkipped,
  logRollback,
  logNotFound,
  getLogFilePath,
};
