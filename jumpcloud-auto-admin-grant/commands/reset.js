/**
 * JumpCloud Admin Tools — Reset Password Command
 *
 * Resets user passwords on JumpCloud with batch or single user support.
 * Default password is configurable via DEFAULT_RESET_PASSWORD in .env.
 *
 * Usage:
 *   jc-admin reset                                  # Interactive mode
 *   jc-admin reset user@company.com                 # Auto mode (default password)
 *   jc-admin reset user@company.com --password "X"  # Auto mode (custom password)
 *   jc-admin reset --dry-run                        # Preview only
 */

const chalk = require("chalk");
const inquirer = require("inquirer");
const Table = require("cli-table3");

const jc = require("../lib/jumpcloud-api");
const slack = require("../lib/slack-notify");
const csv = require("../lib/csv-handler");
const audit = require("../lib/audit-logger");

// ─── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PASSWORD = process.env.DEFAULT_RESET_PASSWORD;

// ─── Helpers ────────────────────────────────────────────────────────────────────

function isDryRun() {
  return process.argv.includes("--dry-run");
}

function getCliEmails() {
  const args = process.argv.slice(2).filter(arg =>
    arg !== '--dry-run' &&
    !arg.startsWith('--') &&
    arg !== getCliPassword()
  );

  // Also filter out the value after --password
  const cleanArgs = [];
  const allArgs = process.argv.slice(2);
  for (let i = 0; i < allArgs.length; i++) {
    if (allArgs[i] === '--password') {
      i++; // Skip the next arg (password value)
      continue;
    }
    if (allArgs[i].startsWith('--')) continue;
    cleanArgs.push(allArgs[i]);
  }

  const validEmails = [];
  for (const arg of cleanArgs) {
    const email = arg.trim().toLowerCase();
    if (csv.isValidEmail(email)) {
      validEmails.push(email);
    } else {
      console.log(chalk.red(`  ❌ Invalid email format ignored: ${arg}`));
    }
  }
  return [...new Set(validEmails)];
}

function getCliPassword() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--password' && args[i + 1]) {
      return args[i + 1];
    }
  }
  return null;
}

function maskPassword(password) {
  if (password.length <= 4) return "****";
  return password.substring(0, 2) + "*".repeat(password.length - 4) + password.substring(password.length - 2);
}

function printBanner() {
  console.log("");
  console.log(chalk.bold.cyan("  🔑 JumpCloud Password Reset Tool"));
  console.log(chalk.gray("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log("");
}

function showHelp() {
  printBanner();
  console.log("  Resets user passwords on JumpCloud-managed accounts.");
  console.log("  Supports bulk users via prompt or CSV/XLSX, with Slack reporting.");
  console.log("");
  console.log(chalk.bold("  Usage:"));
  console.log("    jc-admin reset [emails...] [options]");
  console.log("");
  console.log(chalk.bold("  Options:"));
  console.log("    emails...              Whitespace-separated list of valid user emails (enables auto-mode)");
  console.log('    --password "pass"      Set a custom password (default: from DEFAULT_RESET_PASSWORD in .env)');
  console.log("    --dry-run              Preview what the script will do without making any changes");
  console.log("    -h, --help             Show this help manual and exit");
  console.log("");
  console.log(chalk.bold("  Examples:"));
  console.log("    jc-admin reset                                             # Interactive mode");
  console.log("    jc-admin reset --dry-run                                   # Interactive dry-run mode");
  console.log("    jc-admin reset user@company.com                            # Reset with default password");
  console.log('    jc-admin reset user@company.com --password "NewPass123!"   # Reset with custom password');
  console.log("    jc-admin reset dev1@company.com dev2@company.com           # Batch reset");
  console.log("");
  process.exit(0);
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
        { name: "📄 CSV or XLSX file", value: "csv" },
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
        message: "Enter path to CSV or XLSX file:",
        default: "./templates/users-template.csv",
        validate: (input) => {
          try {
            csv.parseFile(input);
            return true;
          } catch (err) {
            return err.message;
          }
        },
      },
    ]);

    emails = csv.parseFile(csvPath);
  }

  emails = [...new Set(emails)];

  console.log(chalk.gray(`     Found ${emails.length} unique email(s).`));
  console.log("");

  return emails;
}

// ─── Step 3: Get Password ───────────────────────────────────────────────────────

async function stepGetPassword() {
  const choices = [];
  if (DEFAULT_PASSWORD) {
    choices.push({ name: `🔒 Default password (${maskPassword(DEFAULT_PASSWORD)})`, value: "default" });
  }
  choices.push({ name: "✏️  Custom password", value: "custom" });

  const { passwordChoice } = await inquirer.prompt([
    {
      type: "list",
      name: "passwordChoice",
      message: "Which password to use?",
      choices,
    },
  ]);

  if (passwordChoice === "default") {
    return DEFAULT_PASSWORD;
  }

  const { customPassword } = await inquirer.prompt([
    {
      type: "password",
      name: "customPassword",
      message: "Enter custom password:",
      mask: "*",
      validate: (input) => {
        if (!input || input.length < 8) {
          return "Password must be at least 8 characters";
        }
        return true;
      },
    },
  ]);

  return customPassword;
}

// ─── Step 4: Check Dry Run ──────────────────────────────────────────────────────

async function stepCheckDryRun() {
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

// ─── Step 5: Lookup Users ───────────────────────────────────────────────────────

async function stepLookupUsers(emails) {
  console.log(chalk.bold("  🔍 Looking up users..."));

  const results = {
    found: [],
    notFound: [],
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
      results.found.push({ email, user });
    } catch (err) {
      console.log(chalk.red(`ERROR: ${err.message}`));
      results.notFound.push(email);
    }

    await sleep(200);
  }

  console.log("");
  return results;
}

// ─── Step 6: Show Summary & Confirm ─────────────────────────────────────────────

async function stepConfirm(lookupResults, password, dryRun, isAutoMode) {
  if (lookupResults.found.length === 0) {
    console.log(
      chalk.yellow("  ⚠️  No users found in JumpCloud. Nothing to do.")
    );
    return false;
  }

  const isDefaultPw = password === DEFAULT_PASSWORD;

  const table = new Table({
    head: [
      chalk.white.bold("User"),
      chalk.white.bold("Display Name"),
      chalk.white.bold("Password"),
    ],
    style: { head: [], border: [] },
  });

  for (const r of lookupResults.found) {
    table.push([
      r.email,
      r.user.displayName,
      isDefaultPw ? `Default (${maskPassword(password)})` : `Custom (${maskPassword(password)})`,
    ]);
  }

  console.log(table.toString());
  console.log("");

  if (dryRun) {
    console.log(
      chalk.yellow(
        `  🧪 DRY RUN — Would reset password for ${lookupResults.found.length} user(s). No changes made.`
      )
    );
    return false;
  }

  if (isAutoMode) {
    console.log(chalk.green(`  ⚡ Auto-mode: skipping confirmation.`));
    console.log("");
    return true;
  }

  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: `Proceed with resetting password for ${lookupResults.found.length} user(s)?`,
      default: true,
    },
  ]);

  console.log("");
  return proceed;
}

// ─── Step 7: Execute Password Resets ────────────────────────────────────────────

async function stepExecuteResets(lookupResults, password) {
  console.log(chalk.bold("  🚀 Resetting passwords..."));

  const isDefaultPw = password === DEFAULT_PASSWORD;
  const successful = [];
  const errors = [];

  for (const r of lookupResults.found) {
    process.stdout.write(
      chalk.gray(`     ${r.email} ... `)
    );

    try {
      await jc.resetPassword(r.user.id, password);

      successful.push({
        email: r.email,
        displayName: r.user.displayName,
        userId: r.user.id,
      });

      audit.logPasswordReset({
        email: r.email,
        displayName: r.user.displayName,
        userId: r.user.id,
        passwordUsed: isDefaultPw ? "default" : "custom",
      });

      console.log(chalk.green("✓"));
    } catch (err) {
      console.log(chalk.red(`FAILED: ${err.message}`));

      errors.push({
        email: r.email,
        displayName: r.user.displayName,
        error: err.message,
      });
    }

    await sleep(300);
  }

  console.log("");
  return { successful, errors };
}

// ─── Step 8: Send Slack Report ──────────────────────────────────────────────────

async function stepSendReport(successful, errors, notFound, password, dryRun) {
  try {
    await slack.sendResetReport({
      successful,
      errors,
      notFound,
      password: maskPassword(password),
      dryRun,
    });
    console.log(chalk.gray("  📨 Slack report sent to channel."));
  } catch (slackErr) {
    console.log(
      chalk.red(`  ⚠️  Could not send Slack report: ${slackErr.message}`)
    );
  }
}

// ─── Main Run Function ──────────────────────────────────────────────────────────

async function run() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
  }

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

  // Step 3: Get password
  const cliPassword = getCliPassword();
  let password;
  if (isAutoMode) {
    password = cliPassword || DEFAULT_PASSWORD;
    if (!password) {
      console.log(chalk.red("  ❌ No custom password provided and DEFAULT_RESET_PASSWORD is not set in .env."));
      console.log(chalk.gray("     Set DEFAULT_RESET_PASSWORD in your .env file or use --password \"X\""));
      process.exit(1);
    }
    const isDefault = password === DEFAULT_PASSWORD;
    console.log(chalk.gray(`  🔒 Using ${isDefault ? "default" : "custom"} password: ${maskPassword(password)}`));
    console.log("");
  } else {
    password = await stepGetPassword();
  }

  // Step 4: Check dry run
  const dryRun = isAutoMode ? isDryRun() : await stepCheckDryRun();

  // Step 5: Lookup users
  const lookupResults = await stepLookupUsers(emails);

  // Step 6: Show summary & confirm
  const proceed = await stepConfirm(lookupResults, password, dryRun, isAutoMode);

  if (!proceed) {
    if (dryRun) {
      const dryRunSuccessful = lookupResults.found.map((r) => ({
        email: r.email,
        displayName: r.user.displayName,
        userId: r.user.id,
      }));

      await stepSendReport(
        dryRunSuccessful,
        [],
        lookupResults.notFound,
        password,
        true
      );
    }

    console.log("");
    console.log(chalk.gray("  👋 Exiting. No changes were made."));
    console.log("");
    process.exit(0);
  }

  // Step 7: Execute password resets
  const { successful, errors } = await stepExecuteResets(lookupResults, password);

  // Step 8: Send Slack report
  await stepSendReport(
    successful,
    errors,
    lookupResults.notFound,
    password,
    false
  );

  // Done!
  console.log(chalk.gray(`  📝 Audit log: ${audit.getLogFilePath()}`));
  console.log("");

  if (errors.length > 0) {
    console.log(
      chalk.yellow.bold(
        `  ⚠️ Done! Reset ${successful.length} password(s), ${errors.length} failed.`
      )
    );
  } else {
    console.log(
      chalk.green.bold(
        `  ✨ Done! Password reset for ${successful.length} user(s).`
      )
    );
  }
  console.log("");
}

module.exports = { run };
