/**
 * Slack Notification Module
 * Sends formatted reports to Slack via webhook.
 */

const https = require("https");

/**
 * Send a message to Slack via webhook.
 */
function sendSlackMessage(blocks, text) {
  return new Promise((resolve, reject) => {
    const webhookUrl = process.env.SLACK_WEBHOOK;
    if (!webhookUrl) {
      return reject(new Error("SLACK_WEBHOOK is not configured in .env"));
    }

    const url = new URL(webhookUrl);
    const payload = JSON.stringify({ text, blocks });

    const options = {
      method: "POST",
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          reject(
            new Error(`Slack webhook returned HTTP ${res.statusCode}: ${data}`)
          );
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

/**
 * Format a date to WIB timezone string.
 */
function formatDateWIB(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }) + " WIB";
}

/**
 * Send a success report to Slack.
 *
 * @param {Object} params
 * @param {Array} params.successful - Array of { email, displayName, deviceName, expiresAt, accessId }
 * @param {Array} params.skipped - Array of { email, deviceName, reason }
 * @param {Array} params.notFound - Array of emails not found in JumpCloud
 * @param {string} params.duration - Duration label (e.g., "24 hours")
 * @param {boolean} params.dryRun - Whether this was a dry run
 */
async function sendReport({ successful, skipped, notFound, duration, dryRun }) {
  const ccUser = process.env.SLACK_CC_USER;
  const now = formatDateWIB(new Date().toISOString());

  const modeLabel = dryRun ? "🧪 DRY RUN (no changes made)" : "✅ EXECUTED";

  // Build the success list
  let successText = "";
  if (successful.length > 0) {
    successText = successful
      .map(
        (s) =>
          `• ${s.email} → \`${s.deviceName}\` (expires ${formatDateWIB(s.expiresAt)})`
      )
      .join("\n");
  } else {
    successText = "• None";
  }

  // Build the skipped list
  let skippedText = "";
  if (skipped.length > 0) {
    skippedText = skipped
      .map((s) => `• ${s.email} → \`${s.deviceName}\` (${s.reason})`)
      .join("\n");
  }

  // Build the not found list
  let notFoundText = "";
  if (notFound.length > 0) {
    notFoundText = notFound.map((e) => `• ${e}`).join("\n");
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🔐 JumpCloud Admin Grant Report",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Mode:* ${modeLabel}`,
          `*Date:* ${now}`,
          `*Duration:* ${duration}`,
          `*Total Grants:* ${successful.length} users/devices`,
        ].join("\n"),
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*✅ Successful Grants:*\n${successText}`,
      },
    },
  ];

  // Add skipped section if any
  if (skipped.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⚠️ Skipped (offline devices):*\n${skippedText}`,
      },
    });
  }

  // Add not-found section if any
  if (notFound.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*❓ Users Not Found in JumpCloud:*\n${notFoundText}`,
      },
    });
  }

  // Add CC
  if (ccUser) {
    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `CC: <!subteam^${ccUser}>`,
          },
        ],
      }
    );
  }

  const fallbackText = `JumpCloud Admin Grant Report — ${successful.length} grants, ${skipped.length} skipped`;
  await sendSlackMessage(blocks, fallbackText);
}

/**
 * Send an error report to Slack (with rollback info).
 *
 * @param {Object} params
 * @param {string} params.errorMessage - What went wrong
 * @param {Array} params.rolledBack - Array of { email, deviceName } that were revoked
 * @param {Array} params.rollbackFailed - Array of { email, deviceName, error } that failed to revoke
 */
async function sendErrorReport({ errorMessage, rolledBack, rollbackFailed }) {
  const ccUser = process.env.SLACK_CC_USER;
  const now = formatDateWIB(new Date().toISOString());

  let rollbackText = "";
  if (rolledBack.length > 0) {
    rollbackText = rolledBack
      .map((r) => `• ↩️ ${r.email} → \`${r.deviceName}\` — revoked`)
      .join("\n");
  } else {
    rollbackText = "• No grants to rollback";
  }

  let rollbackFailedText = "";
  if (rollbackFailed.length > 0) {
    rollbackFailedText =
      "\n\n*🚨 Failed to Rollback (MANUAL ACTION REQUIRED):*\n" +
      rollbackFailed
        .map(
          (r) =>
            `• ${r.email} → \`${r.deviceName}\` — Error: ${r.error}`
        )
        .join("\n");
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "❌ JumpCloud Admin Grant — ERROR",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Date:* ${now}\n*Error:* ${errorMessage}`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🔄 Rollback Status:*\n${rollbackText}${rollbackFailedText}`,
      },
    },
  ];

  if (ccUser) {
    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `CC: <!subteam^${ccUser}> — Please review and take action if needed.`,
          },
        ],
      }
    );
  }

  const fallbackText = `❌ JumpCloud Admin Grant ERROR: ${errorMessage}`;
  await sendSlackMessage(blocks, fallbackText);
}

/**
 * Send an API key expiry alert to Slack.
 */
async function sendApiKeyAlert(message) {
  const ccUser = process.env.SLACK_CC_USER;
  const now = formatDateWIB(new Date().toISOString());

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🔑 JumpCloud API Key Alert",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Date:* ${now}\n*Status:* ${message}\n\n_Please generate a new API key in JumpCloud Admin Console → API Settings._`,
      },
    },
  ];

  if (ccUser) {
    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `CC: <!subteam^${ccUser}>`,
          },
        ],
      }
    );
  }

  await sendSlackMessage(blocks, `🔑 JumpCloud API Key Alert: ${message}`);
}

/**
 * Send a password reset report to Slack.
 *
 * @param {Object} params
 * @param {Array} params.successful - Array of { email, displayName, userId }
 * @param {Array} params.errors - Array of { email, displayName, error }
 * @param {Array} params.notFound - Array of emails not found in JumpCloud
 * @param {string} params.password - Masked password string
 * @param {boolean} params.dryRun - Whether this was a dry run
 */
async function sendResetReport({ successful, errors, notFound, password, dryRun }) {
  const ccUser = process.env.SLACK_CC_USER;
  const now = formatDateWIB(new Date().toISOString());

  const modeLabel = dryRun ? "🧪 DRY RUN (no changes made)" : "✅ EXECUTED";

  // Build the success list
  let successText = "";
  if (successful.length > 0) {
    successText = successful
      .map((s) => `• ${s.email} (${s.displayName})`)
      .join("\n");
  } else {
    successText = "• None";
  }

  // Build the errors list
  let errorsText = "";
  if (errors && errors.length > 0) {
    errorsText = errors
      .map((e) => `• ${e.email} — ${e.error}`)
      .join("\n");
  }

  // Build the not found list
  let notFoundText = "";
  if (notFound.length > 0) {
    notFoundText = notFound.map((e) => `• ${e}`).join("\n");
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🔑 JumpCloud Password Reset Report",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Mode:* ${modeLabel}`,
          `*Date:* ${now}`,
          `*Password:* \`${password}\``,
          `*Total Resets:* ${successful.length} user(s)`,
        ].join("\n"),
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*✅ Successful Resets:*\n${successText}`,
      },
    },
  ];

  // Add errors section if any
  if (errors && errors.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*❌ Failed Resets:*\n${errorsText}`,
      },
    });
  }

  // Add not-found section if any
  if (notFound.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*❓ Users Not Found in JumpCloud:*\n${notFoundText}`,
      },
    });
  }

  // Add CC
  if (ccUser) {
    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `CC: <!subteam^${ccUser}>`,
          },
        ],
      }
    );
  }

  const fallbackText = `JumpCloud Password Reset Report — ${successful.length} resets${errors && errors.length > 0 ? `, ${errors.length} failed` : ""}`;
  await sendSlackMessage(blocks, fallbackText);
}

/**
 * Send a user import report to Slack.
 *
 * @param {Object} params
 * @param {Array} params.successful - Array of { email, displayName, groups, directory }
 * @param {Array} params.errors - Array of { email, error, rolledBack }
 * @param {Array} params.skipped - Array of { email, reason }
 * @param {boolean} params.dryRun - Whether this was a dry run
 */
async function sendImportReport({ successful, errors, skipped, dryRun }) {
  const ccUser = process.env.SLACK_CC_USER;
  const now = formatDateWIB(new Date().toISOString());

  const modeLabel = dryRun ? "🧪 DRY RUN (no changes made)" : "✅ EXECUTED";

  // Build the success list
  let successText = "";
  if (successful.length > 0) {
    successText = successful
      .map((s) => `• ${s.email} (${s.displayName}) — Groups: ${s.groups.join(", ") || "None"}`)
      .join("\n");
  } else {
    successText = "• None";
  }

  // Build the errors list
  let errorsText = "";
  if (errors && errors.length > 0) {
    errorsText = errors
      .map((e) => `• ${e.email} — Error: ${e.error} (Rolled back: ${e.rolledBack ? "Yes" : "No/Failed"})`)
      .join("\n");
  }

  // Build the skipped list
  let skippedText = "";
  if (skipped && skipped.length > 0) {
    skippedText = skipped.map((e) => `• ${e.email} (${e.reason})`).join("\n");
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "📁 JumpCloud User Import Report",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Mode:* ${modeLabel}`,
          `*Date:* ${now}`,
          `*Total Processed:* ${successful.length + (errors ? errors.length : 0) + (skipped ? skipped.length : 0)}`,
        ].join("\n"),
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*✅ Successful Imports:*\n${successText}`,
      },
    },
  ];

  if (errors && errors.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*❌ Failed Imports:*\n${errorsText}`,
      },
    });
  }

  if (skipped && skipped.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⏭️ Skipped Users:*\n${skippedText}`,
      },
    });
  }

  if (ccUser) {
    blocks.push(
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `CC: <!subteam^${ccUser}>`,
          },
        ],
      }
    );
  }

  const fallbackText = `JumpCloud Import Report — ${successful.length} successful, ${(errors || []).length} failed, ${(skipped || []).length} skipped`;
  await sendSlackMessage(blocks, fallbackText);
}

module.exports = {
  sendReport,
  sendErrorReport,
  sendApiKeyAlert,
  sendResetReport,
  sendImportReport,
};
