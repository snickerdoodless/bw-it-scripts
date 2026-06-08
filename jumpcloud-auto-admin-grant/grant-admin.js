#!/usr/bin/env node

/**
 * JumpCloud Auto-Grant Admin Script
 *
 * Grants temporary admin/sudo privileges on JumpCloud-managed devices.
 * Supports bulk users via prompt or CSV, with Slack reporting and error rollback.
 *
 * Usage:
 *   node grant-admin.js            # Interactive mode
 *   node grant-admin.js --dry-run  # Preview only, no changes
 */

require("dotenv").config();

const inquirer = require("inquirer");
const chalk = require("chalk");
const Table = require("cli-table3");
const path = require("path");

const jc = require("./lib/jumpcloud-api");
const slack = require("./lib/slack-notify");
const csv = require("./lib/csv-handler");
const audit = require("./lib/audit-logger");

// ─── Duration Options ──────────────────────────────────────────────────────────

const DURATION_OPTIONS = [
  { name: "1 hour", value: 1 },
  { name: "4 hours", value: 4 },
  { name: "8 hours", value: 8 },
  { name: "12 hours", value: 12 },
  { name: "24 hours (default)", value: 24 },
  { name: "48 hours", value: 48 },
  { name: "72 hours", value: 72 },
];

// ─── Helpers ────────────────────────────────────────────────────────────────────

function isDryRun() {
  return process.argv.includes("--dry-run");
}

function getCliEmails() {
  const args = process.argv.slice(2).filter(arg => arg !== '--dry-run' && !arg.startsWith('--'));
  const validEmails = [];
  for (const arg of args) {
    const email = arg.trim().toLowerCase();
    if (csv.isValidEmail(email)) {
      validEmails.push(email);
    } else {
      console.log(chalk.red(`  ❌ Invalid email format ignored: ${arg}`));
    }
  }
  return [...new Set(validEmails)];
}

function calculateExpiry(hours) {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + hours);
  return expiry.toISOString();
}

function formatDateWIB(isoString) {
  return new Date(isoString).toLocaleString("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }) + " WIB";
}

function printBanner() {
  console.log("");
  console.log(chalk.bold.cyan("  🔐 JumpCloud Admin Grant Tool"));
  console.log(chalk.gray("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log("");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Step 1: Validate API Key ───────────────────────────────────────────────────

async function stepValidateApiKey() {
  process.stdout.write(chalk.yellow("  🔑 Validating API key... "));

  const result = await jc.validateApiKey();

  if (!result.valid) {
    console.log(chalk.red("FAILED"));
    console.log(chalk.red(`     ${result.message}`));
    console.log("");

    // Try to send Slack alert about expired key
    try {
      await slack.sendApiKeyAlert(
        `❌ API key is expired or invalid. Script cannot run.\n${result.message}`
      );
      console.log(chalk.gray("  📨 Slack alert sent about expired API key."));
    } catch (slackErr) {
      console.log(
        chalk.gray(`  ⚠️  Could not send Slack alert: ${slackErr.message}`)
      );
    }

    process.exit(1);
  }

  console.log(chalk.green("OK ✓"));
  console.log("");
}

// ─── Step 2: Get User Emails ─────────────────────────────────────────────────────

async function stepGetEmails() {
  const { inputMethod } = await inquirer.prompt([
    {
      type: "list",
      name: "inputMethod",
      message: "How do you want to input users?",
      choices: [
        { name: "📝 Manual entry (type/paste emails)", value: "manual" },
        { name: "📄 CSV file", value: "csv" },
      ],
    },
  ]);

  let emails = [];

  if (inputMethod === "manual") {
    const { emailInput } = await inquirer.prompt([
      {
        type: "input",
        name: "emailInput",
        message: "Enter user emails (comma-separated):",
        validate: (input) => {
          if (!input.trim()) return "Please enter at least one email";
          const parts = input.split(",").map((e) => e.trim()).filter(Boolean);
          const invalid = parts.filter((e) => !csv.isValidEmail(e));
          if (invalid.length > 0) {
            return `Invalid emails: ${invalid.join(", ")}`;
          }
          return true;
        },
      },
    ]);

    emails = emailInput
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  } else {
    const { csvPath } = await inquirer.prompt([
      {
        type: "input",
        name: "csvPath",
        message: "Enter path to CSV file:",
        default: "./templates/users-template.csv",
        validate: (input) => {
          try {
            csv.parseCSV(input);
            return true;
          } catch (err) {
            return err.message;
          }
        },
      },
    ]);

    emails = csv.parseCSV(csvPath);
  }

  // Remove duplicates
  emails = [...new Set(emails)];

  console.log(chalk.gray(`     Found ${emails.length} unique email(s).`));
  console.log("");

  return emails;
}

// ─── Step 3: Choose Duration ────────────────────────────────────────────────────

async function stepChooseDuration() {
  const { duration } = await inquirer.prompt([
    {
      type: "list",
      name: "duration",
      message: "Select admin duration:",
      choices: DURATION_OPTIONS,
      default: 24,
    },
  ]);

  return duration;
}

// ─── Step 4: Choose Dry Run ─────────────────────────────────────────────────────

async function stepCheckDryRun() {
  // If --dry-run flag is passed, skip the prompt
  if (isDryRun()) {
    console.log(chalk.yellow("  🧪 Dry-run mode enabled via --dry-run flag"));
    console.log("");
    return true;
  }

  const { dryRun } = await inquirer.prompt([
    {
      type: "confirm",
      name: "dryRun",
      message: "Enable dry-run mode? (preview only, no changes)",
      default: false,
    },
  ]);

  if (dryRun) {
    console.log("");
    console.log(chalk.yellow("  🧪 Dry-run mode — no changes will be made"));
  }

  console.log("");
  return dryRun;
}

// ─── Step 5: Lookup Users & Devices ─────────────────────────────────────────────

async function stepLookupUsersAndDevices(emails) {
  console.log(chalk.bold("  🔍 Looking up users..."));

  const results = {
    found: [], // { email, user, onlineDevices: [], offlineDevices: [] }
    notFound: [], // emails
  };

  for (const email of emails) {
    process.stdout.write(chalk.gray(`     ${email} ... `));

    try {
      const user = await jc.findUserByEmail(email);

      if (!user) {
        console.log(chalk.red("USER NOT FOUND"));
        results.notFound.push(email);
        audit.logNotFound({ email });
        continue;
      }

      console.log(chalk.green(`${user.displayName} ✓`));

      // Get devices bound to this user
      const deviceIds = await jc.getUserDevices(user.id);

      if (deviceIds.length === 0) {
        console.log(chalk.yellow(`       ⚠️  No devices bound to this user`));
        results.notFound.push(email);
        continue;
      }

      const onlineDevices = [];
      const offlineDevices = [];

      for (const deviceId of deviceIds) {
        const device = await jc.getDeviceDetails(deviceId);
        
        // Grant all devices regardless of online/offline status
        onlineDevices.push(device);
        console.log(chalk.green(`       ✅ ${device.displayName} (${device.active ? "online" : "offline"})`));
      }

      results.found.push({
        email,
        user,
        onlineDevices,
        offlineDevices,
      });
    } catch (err) {
      console.log(chalk.red(`ERROR: ${err.message}`));
      results.notFound.push(email);
    }

    // Small delay to avoid API rate limits
    await sleep(200);
  }

  console.log("");
  return results;
}

// ─── Step 6: Show Summary & Confirm ─────────────────────────────────────────────

async function stepConfirm(lookupResults, durationHours, dryRun, expiryISO, isAutoMode) {
  // Count total grants
  let totalGrants = 0;
  for (const r of lookupResults.found) {
    totalGrants += r.onlineDevices.length;
  }

  if (totalGrants === 0) {
    console.log(
      chalk.yellow("  ⚠️  No devices found for any user. Nothing to do.")
    );
    return false;
  }

  // Display summary table
  const table = new Table({
    head: [
      chalk.white.bold("User"),
      chalk.white.bold("Device"),
      chalk.white.bold("OS"),
      chalk.white.bold("Expires"),
    ],
    style: { head: [], border: [] },
  });

  for (const r of lookupResults.found) {
    for (const device of r.onlineDevices) {
      table.push([
        r.email,
        device.displayName,
        device.os,
        formatDateWIB(expiryISO),
      ]);
    }
  }

  console.log(table.toString());
  console.log("");

  if (dryRun) {
    console.log(
      chalk.yellow(
        `  🧪 DRY RUN — Would grant admin to ${totalGrants} device(s). No changes made.`
      )
    );
    return false;
  }

  if (isAutoMode) {
    console.log(chalk.green(`  ⚡ Auto-mode: skipping confirmation.`));
    console.log("");
    return true;
  }

  // Confirm
  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: `Proceed with granting admin to ${totalGrants} device(s)?`,
      default: true,
    },
  ]);

  console.log("");
  return proceed;
}

// ─── Step 7: Execute Grants ─────────────────────────────────────────────────────

async function stepExecuteGrants(lookupResults, durationHours, expiryISO) {
  console.log(chalk.bold("  🚀 Granting admin access..."));

  const durationLabel = DURATION_OPTIONS.find(
    (d) => d.value === durationHours
  ).name;

  const successful = []; // Tracks grants for rollback + reporting
  const skipped = []; // Offline devices
  const errors = [];

  try {
    for (const r of lookupResults.found) {
      // Log skipped (offline) devices
      for (const device of r.offlineDevices) {
        skipped.push({
          email: r.email,
          deviceName: device.displayName,
          reason: "offline",
        });
        audit.logSkipped({
          email: r.email,
          deviceName: device.displayName,
          deviceId: device.id,
          reason: "Device is offline",
        });
      }

      // Grant on online devices
      for (const device of r.onlineDevices) {
        process.stdout.write(
          chalk.gray(`     ${r.email} → ${device.displayName} ... `)
        );

        try {
          const result = await jc.grantAdminAccess(
            r.user.id,
            device.id,
            expiryISO
          );

          if (result.alreadyGranted) {
            console.log(chalk.yellow("already granted (skipped)"));
            // Do not track as successful or error to avoid Slack spam
          } else {
            successful.push({
              email: r.email,
              displayName: r.user.displayName,
              deviceName: device.displayName,
              deviceId: device.id,
              accessId: result.accessId,
              expiresAt: expiryISO,
            });

            audit.logGrant({
              email: r.email,
              displayName: r.user.displayName,
              deviceName: device.displayName,
              deviceId: device.id,
              accessId: result.accessId,
              duration: durationLabel,
              expiresAt: expiryISO,
            });

            console.log(chalk.green("✓"));
          }
        } catch (grantErr) {
          console.log(chalk.red(`FAILED: ${grantErr.message}`));

          // ── ERROR: Start rollback ──
          throw grantErr;
        }

        await sleep(300);
      }
    }
  } catch (err) {
    // ── ROLLBACK all successful grants ──
    console.log("");
    console.log(chalk.red.bold("  ❌ Error occurred! Rolling back grants..."));

    const rolledBack = [];
    const rollbackFailed = [];

    for (const grant of successful) {
      process.stdout.write(
        chalk.yellow(`     ↩️  Revoking ${grant.email} → ${grant.deviceName} ... `)
      );

      try {
        await jc.revokeAdminAccess(grant.accessId);
        console.log(chalk.green("revoked ✓"));

        rolledBack.push({
          email: grant.email,
          deviceName: grant.deviceName,
        });

        audit.logRollback({
          email: grant.email,
          deviceName: grant.deviceName,
          deviceId: grant.deviceId,
          accessId: grant.accessId,
          revokeSuccess: true,
        });
      } catch (revokeErr) {
        console.log(chalk.red(`FAILED: ${revokeErr.message}`));

        rollbackFailed.push({
          email: grant.email,
          deviceName: grant.deviceName,
          error: revokeErr.message,
        });

        audit.logRollback({
          email: grant.email,
          deviceName: grant.deviceName,
          deviceId: grant.deviceId,
          accessId: grant.accessId,
          revokeSuccess: false,
          error: revokeErr.message,
        });
      }
    }

    // Send error report to Slack
    console.log("");
    try {
      await slack.sendErrorReport({
        errorMessage: err.message,
        rolledBack,
        rollbackFailed,
      });
      console.log(chalk.gray("  📨 Error report sent to Slack."));
    } catch (slackErr) {
      console.log(
        chalk.red(`  ⚠️  Could not send Slack error report: ${slackErr.message}`)
      );
    }

    console.log(chalk.gray(`  📝 Audit log: ${audit.getLogFilePath()}`));
    console.log("");
    process.exit(1);
  }

  return { successful, skipped };
}

// ─── Step 8: Send Slack Report ──────────────────────────────────────────────────

async function stepSendReport(successful, skipped, notFound, durationHours, dryRun) {
  const durationLabel = DURATION_OPTIONS.find(
    (d) => d.value === durationHours
  ).name;

  try {
    await slack.sendReport({
      successful,
      skipped,
      notFound,
      duration: durationLabel,
      dryRun,
    });
    console.log(chalk.gray("  📨 Slack report sent to channel."));
  } catch (slackErr) {
    console.log(
      chalk.red(`  ⚠️  Could not send Slack report: ${slackErr.message}`)
    );
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  // Validate required env vars
  if (!process.env.JC_API_KEY) {
    console.log(chalk.red("  ❌ JC_API_KEY is missing. Set it in .env file."));
    process.exit(1);
  }
  if (!process.env.JC_ORG_ID) {
    console.log(chalk.red("  ❌ JC_ORG_ID is missing. Set it in .env file."));
    process.exit(1);
  }

  // Step 1: Validate API key
  await stepValidateApiKey();

  const cliEmails = getCliEmails();
  const isAutoMode = cliEmails.length > 0;

  if (isAutoMode) {
    console.log(chalk.cyan(`  ⚡ Auto-mode active for: ${cliEmails.join(", ")}`));
    console.log("");
  }

  // Step 2: Get user emails
  const emails = isAutoMode ? cliEmails : await stepGetEmails();

  // Step 3: Choose duration
  const durationHours = isAutoMode ? 24 : await stepChooseDuration();

  // Step 4: Check dry run
  const dryRun = isAutoMode ? isDryRun() : await stepCheckDryRun();

  // Calculate expiry
  const expiryISO = calculateExpiry(durationHours);

  // Step 5: Lookup users & devices
  const lookupResults = await stepLookupUsersAndDevices(emails);

  // Step 6: Show summary & confirm
  const proceed = await stepConfirm(lookupResults, durationHours, dryRun, expiryISO, isAutoMode);

  if (!proceed) {
    // If dry run, still send report for visibility
    if (dryRun) {
      const dryRunSuccessful = [];
      const dryRunSkipped = [];

      for (const r of lookupResults.found) {
        for (const device of r.onlineDevices) {
          dryRunSuccessful.push({
            email: r.email,
            displayName: r.user.displayName,
            deviceName: device.displayName,
            expiresAt: expiryISO,
            accessId: "DRY-RUN",
          });
        }
        for (const device of r.offlineDevices) {
          dryRunSkipped.push({
            email: r.email,
            deviceName: device.displayName,
            reason: "offline",
          });
        }
      }

      await stepSendReport(
        dryRunSuccessful,
        dryRunSkipped,
        lookupResults.notFound,
        durationHours,
        true
      );
    }

    console.log("");
    console.log(chalk.gray("  👋 Exiting. No changes were made."));
    console.log("");
    process.exit(0);
  }

  // Step 7: Execute grants
  const { successful, skipped } = await stepExecuteGrants(
    lookupResults,
    durationHours,
    expiryISO
  );

  // Step 8: Send Slack report
  console.log("");
  await stepSendReport(
    successful,
    skipped,
    lookupResults.notFound,
    durationHours,
    false
  );

  // Done!
  console.log(chalk.gray(`  📝 Audit log: ${audit.getLogFilePath()}`));
  console.log("");
  console.log(
    chalk.green.bold(
      `  ✨ Done! Admin granted to ${successful.length} device(s) (auto-expires in ${
        DURATION_OPTIONS.find((d) => d.value === durationHours).name
      })`
    )
  );
  console.log("");
}

// ─── Run ────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("");
  console.error(chalk.red(`  ❌ Unexpected error: ${err.message}`));
  console.error(chalk.gray(`     ${err.stack}`));
  console.error("");
  process.exit(1);
});
