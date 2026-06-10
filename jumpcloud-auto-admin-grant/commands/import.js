/**
 * JumpCloud Admin Tools — Import Command
 *
 * Imports users from Google Workspace into JumpCloud.
 *
 * Usage:
 *   jc-admin import                                          # Interactive mode
 *   jc-admin import user@company.com --flags...              # Single auto mode
 *   jc-admin import user@company.com jane@company.com        # Multi auto mode
 *   jc-admin import --csv users.csv                          # Bulk from CSV
 *   jc-admin import --dry-run                                # Preview only
 */

const chalk = require("chalk");
const inquirer = require("inquirer");
const Table = require("cli-table3");

const jc = require("../lib/jumpcloud-api");
const slack = require("../lib/slack-notify");
const csv = require("../lib/csv-handler");
const audit = require("../lib/audit-logger");

// ─── Helpers ────────────────────────────────────────────────────────────────────

function isDryRun() {
  return process.argv.includes("--dry-run");
}

function hasCsvFlag() {
  return process.argv.includes("--csv");
}

function getCsvPathFromArgs() {
  const args = process.argv;
  const idx = args.indexOf("--csv");
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return null;
}

function getCliEmails() {
  const args = process.argv.slice(2);
  const cleanArgs = [];
  
  // Skip --csv and its value, and any other flags and values
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv' || args[i] === '--alt-email' || args[i] === '--title' || args[i] === '--department') {
      i++; // Skip flag and its value
      continue;
    }
    if (args[i].startsWith('-')) continue; // Skip standalone flags like --dry-run or -y
    cleanArgs.push(args[i]);
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

function getFlagValue(flagName) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flagName);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return "";
}

function getDomainGroupsConfig() {
  const configRaw = process.env.IMPORT_DOMAIN_GROUPS;
  if (!configRaw) {
    console.log(chalk.red("  ❌ IMPORT_DOMAIN_GROUPS missing in .env file."));
    process.exit(1);
  }
  try {
    return JSON.parse(configRaw);
  } catch (err) {
    console.log(chalk.red(`  ❌ Failed to parse IMPORT_DOMAIN_GROUPS JSON in .env: ${err.message}`));
    process.exit(1);
  }
}

function getGroupsForEmail(email, domainGroups) {
  const domain = "@" + email.split("@")[1];
  return domainGroups[domain]; // Returns array of group names or undefined
}

function printBanner() {
  console.log("");
  console.log(chalk.bold.cyan("  📁 JumpCloud User Import Tool"));
  console.log(chalk.gray("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log("");
}

function showHelp() {
  printBanner();
  console.log("  Imports users into JumpCloud and assigns them to groups based on domain.");
  console.log("  Supports interactive input, CSV file, or auto-mode via CLI arguments.");
  console.log("");
  console.log(chalk.bold("  Usage:"));
  console.log("    jc-admin import [emails...] [options]");
  console.log("");
  console.log(chalk.bold("  Options:"));
  console.log("    emails...                  Valid user emails (triggers auto-mode)");
  console.log('    --csv <path>               Import users from a CSV file');
  console.log('    --alt-email <email>        Set alternate email (for single-user auto mode)');
  console.log('    --title <title>            Set job title (for single-user auto mode)');
  console.log('    --department <dept>        Set department (for single-user auto mode)');
  console.log("    --dry-run                  Preview what the script will do without making changes");
  console.log("    -y, --yes                  Skip all confirmation prompts (auto-approve)");
  console.log("    -h, --help                 Show this help manual and exit");
  console.log("");
  console.log(chalk.bold("  Examples:"));
  console.log("    jc-admin import                                            # Interactive mode");
  console.log("    jc-admin import --csv users.csv                            # Bulk from CSV mode");
  console.log("    jc-admin import user@company.com jane@company.com          # Multi auto mode");
  console.log('    jc-admin import user@company.com --title "Engineer"        # Single auto mode');
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

// ─── Step 2: Prepare Users Information ──────────────────────────────────────────

async function stepPrepareUsers(cliEmails, domainGroups) {
  let users = [];

  // Check CSV via flag
  if (hasCsvFlag()) {
    const csvPath = getCsvPathFromArgs() || "./templates/import-template.csv";
    console.log(chalk.cyan(`  📄 Importing via CSV: ${csvPath}`));
    try {
      users = csv.parseImportCSV(csvPath);
    } catch (err) {
      console.log(chalk.red(`  ❌ CSV Error: ${err.message}`));
      process.exit(1);
    }
    return checkDomainsAndReturn(users, domainGroups);
  }

  // Single Auto Mode via CLI args (if ONLY 1 email is provided and flags exist)
  const altEmailFlag = getFlagValue('--alt-email');
  const titleFlag = getFlagValue('--title');
  const deptFlag = getFlagValue('--department');
  
  if (cliEmails.length === 1 && (altEmailFlag || titleFlag || deptFlag)) {
    const email = cliEmails[0];
    const derived = csv.deriveUserDetailsFromEmail(email);
    users.push({
      email,
      username: derived.username,
      firstname: derived.firstname,
      lastname: derived.lastname,
      alternateEmail: altEmailFlag,
      jobTitle: titleFlag,
      department: deptFlag
    });
    return checkDomainsAndReturn(users, domainGroups);
  }

  // Multi Auto Mode (emails via CLI, prompt for details) or fully Interactive
  let emailsToProcess = cliEmails;

  if (emailsToProcess.length === 0) {
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

    if (inputMethod === "csv") {
      const { csvPath } = await inquirer.prompt([
        {
          type: "input",
          name: "csvPath",
          message: "Enter path to CSV file:",
          default: "./templates/import-template.csv",
        },
      ]);
      try {
        users = csv.parseImportCSV(csvPath);
      } catch (err) {
        console.log(chalk.red(`  ❌ CSV Error: ${err.message}`));
        process.exit(1);
      }
      return checkDomainsAndReturn(users, domainGroups);
    }

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
    emailsToProcess = emailInput.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  }

  // Get details for each email interactively
  for (const email of emailsToProcess) {
    const derived = csv.deriveUserDetailsFromEmail(email);
    console.log("");
    console.log(chalk.cyan(`  Auto-derived for ${email}:`));
    console.log(chalk.gray(`  • Name: ${derived.firstname} ${derived.lastname}`));
    console.log(chalk.gray(`  • Username: ${derived.username}`));
    
    const details = await inquirer.prompt([
      {
        type: "input",
        name: "alternateEmail",
        message: `Alternate Email for ${derived.username}:`,
        validate: (input) => {
          if (!input.trim()) return true; // Optional, or enforce? Leaving optional but recommended.
          if (!csv.isValidEmail(input)) return "Invalid email format";
          if (input.toLowerCase() === email.toLowerCase()) return "Alternate email cannot be the same as company email";
          return true;
        }
      },
      {
        type: "input",
        name: "jobTitle",
        message: `Job Title for ${derived.username}:`,
      },
      {
        type: "input",
        name: "department",
        message: `Department for ${derived.username}:`,
      }
    ]);

    users.push({
      email,
      username: derived.username,
      firstname: derived.firstname,
      lastname: derived.lastname,
      alternateEmail: details.alternateEmail.trim(),
      jobTitle: details.jobTitle.trim(),
      department: details.department.trim(),
    });
  }

  return checkDomainsAndReturn(users, domainGroups);
}

function checkDomainsAndReturn(users, domainGroups) {
  console.log("");
  for (const user of users) {
    const groups = getGroupsForEmail(user.email, domainGroups);
    if (!groups) {
      console.log(chalk.red(`  ❌ Error: Domain for ${user.email} is not configured in IMPORT_DOMAIN_GROUPS.`));
      console.log(chalk.gray("     Supported domains are defined in your .env file."));
      process.exit(1);
    }
  }
  return users;
}

// ─── Step 3: Check Dry Run ──────────────────────────────────────────────────────

async function stepCheckDryRun() {
  if (isDryRun()) {
    console.log(chalk.yellow("  🧪 Dry-run mode enabled via --dry-run flag"));
    console.log("");
    return true;
  }

  if (process.argv.includes("-y") || process.argv.includes("--yes")) {
    return false;
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

// ─── Step 4: Pre-flight Validations ─────────────────────────────────────────────

async function stepPreFlightChecks(users, domainGroups) {
  console.log(chalk.bold("  🔍 Running pre-flight checks..."));
  
  const results = {
    validUsers: [],
    skippedUsers: [],
    groupCache: {},
    gsuiteDirId: null
  };

  // 1. Check if users already exist
  for (const user of users) {
    process.stdout.write(chalk.gray(`     Checking ${user.email} ... `));
    try {
      const existingUser = await jc.findUserByEmail(user.email);
      if (existingUser) {
        console.log(chalk.yellow("already exists (skipped)"));
        results.skippedUsers.push({ email: user.email, reason: "Already exists in JumpCloud" });
      } else {
        console.log(chalk.green("new user ✓"));
        results.validUsers.push(user);
      }
    } catch (err) {
      console.log(chalk.red(`ERROR: ${err.message}`));
      results.skippedUsers.push({ email: user.email, reason: `Lookup error: ${err.message}` });
    }
    await sleep(200);
  }

  if (results.validUsers.length === 0) {
    return results; // Nothing to do
  }

  // 2. Resolve Group IDs
  process.stdout.write(chalk.gray(`     Resolving JumpCloud user groups ... `));
  const groupsToResolve = new Set();
  for (const user of results.validUsers) {
    const roles = getGroupsForEmail(user.email, domainGroups);
    roles.forEach(r => groupsToResolve.add(r));
  }

  for (const groupName of groupsToResolve) {
    try {
      const groupData = await jc.findGroupByName(groupName);
      if (!groupData) {
        console.log(chalk.red(`FAILED`));
        console.log(chalk.red(`  ❌ Could not find JumpCloud group: "${groupName}"`));
        process.exit(1);
      }
      results.groupCache[groupName] = groupData.id;
    } catch (err) {
      console.log(chalk.red(`FAILED`));
      console.log(chalk.red(`  ❌ API error resolving group "${groupName}": ${err.message}`));
      process.exit(1);
    }
  }
  console.log(chalk.green("OK ✓"));

  // 3. Resolve GSuite Directory
  process.stdout.write(chalk.gray(`     Locating Google Workspace directory ... `));
  try {
    const gdir = await jc.getGSuiteDirectory();
    if (!gdir) {
      console.log(chalk.red(`FAILED`));
      console.log(chalk.red(`  ❌ No directory of type 'g_suite' found in JumpCloud.`));
      process.exit(1);
    }
    results.gsuiteDirId = gdir.id;
    console.log(chalk.green(`OK (${gdir.name}) ✓`));
  } catch (err) {
    console.log(chalk.red(`FAILED`));
    console.log(chalk.red(`  ❌ API error locating directory: ${err.message}`));
    process.exit(1);
  }

  console.log("");
  return results;
}

// ─── Step 5: Show Summary & Confirm ─────────────────────────────────────────────

async function stepConfirm(validUsers, skippedUsers, domainGroups, dryRun) {
  if (validUsers.length === 0) {
    console.log(chalk.yellow("  ⚠️  No valid new users to import. Nothing to do."));
    return false;
  }

  const table = new Table({
    head: [
      chalk.white.bold("User"),
      chalk.white.bold("Name"),
      chalk.white.bold("Groups to Assign"),
    ],
    style: { head: [], border: [] },
  });

  for (const user of validUsers) {
    const groups = getGroupsForEmail(user.email, domainGroups);
    table.push([
      user.email,
      `${user.firstname} ${user.lastname}`,
      groups.join("\n"),
    ]);
  }

  console.log(table.toString());
  console.log("");

  if (skippedUsers.length > 0) {
    console.log(chalk.yellow(`  ⚠️  ${skippedUsers.length} user(s) will be skipped (already exist).`));
    console.log("");
  }

  if (dryRun) {
    console.log(chalk.yellow(`  🧪 DRY RUN — Would import ${validUsers.length} user(s). No changes made.`));
    return false;
  }

  // If CSV or auto single user was used, we still prompt unless process.argv implies complete automation.
  // We'll prompt by default for safety unless we implement a --yes flag, but let's just prompt.
  // Wait, the specification said "Fully non-interactive when using --csv flag."
  if (hasCsvFlag()) {
    console.log(chalk.green(`  ⚡ CSV Auto-mode: skipping confirmation.`));
    console.log("");
    return true;
  }
  
  if (getCliEmails().length > 0) { // Auto mode
    console.log(chalk.green(`  ⚡ Auto-mode: skipping confirmation.`));
    console.log("");
    return true;
  }

  if (process.argv.includes("-y") || process.argv.includes("--yes")) {
    console.log(chalk.green(`  ⚡ [-y] Auto-confirming import.`));
    console.log("");
    return true;
  }

  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: `Proceed with importing ${validUsers.length} user(s)?`,
      default: true,
    },
  ]);

  console.log("");
  return proceed;
}

// ─── Step 6: Execute Import ─────────────────────────────────────────────────────

async function stepExecuteImport(validUsers, groupCache, gsuiteDirId, domainGroups) {
  console.log(chalk.bold("  🚀 Importing users..."));

  const successful = [];
  const errors = [];

  for (const user of validUsers) {
    console.log(chalk.cyan(`  ▶ Processing ${user.email} ...`));
    
    let createdUserId = null;
    let rollbackHappened = false;
    let rollbackSuccess = false;
    let errorCausedBy = null;

    try {
      // Step A: Create User
      process.stdout.write(chalk.gray(`     Creating user (staged) ... `));
      const jcUser = await jc.createStagedUser(user);
      createdUserId = jcUser.id;
      console.log(chalk.green("✓"));

      // Step B: Assign Groups
      process.stdout.write(chalk.gray(`     Assigning groups ... `));
      const groupNames = getGroupsForEmail(user.email, domainGroups);
      for (const gname of groupNames) {
        const gid = groupCache[gname];
        await jc.addUserToGroup(gid, createdUserId);
      }
      console.log(chalk.green("✓"));

      // Step C: Bind to Google Workspace
      process.stdout.write(chalk.gray(`     Binding to Google Workspace ... `));
      await jc.bindUserToDirectory(createdUserId, gsuiteDirId);
      console.log(chalk.green("✓"));

      // Step D: Activate and email
      process.stdout.write(chalk.gray(`     Activating user & sending invite ... `));
      await jc.activateUser(createdUserId);
      console.log(chalk.green("✓"));

      successful.push({
        email: user.email,
        displayName: `${user.firstname} ${user.lastname}`,
        userId: createdUserId,
        groups: groupNames,
        directory: "Google Workspace"
      });

      audit.logImport({
        email: user.email,
        displayName: `${user.firstname} ${user.lastname}`,
        userId: createdUserId,
        groups: groupNames,
        directory: "Google Workspace",
        status: "SUCCESS"
      });

    } catch (err) {
      console.log(chalk.red(`FAILED`));
      console.log(chalk.red(`     Error: ${err.message}`));
      errorCausedBy = err.message;
      rollbackHappened = true;
    }

    // Rollback if something failed mid-way
    if (rollbackHappened && createdUserId) {
      process.stdout.write(chalk.yellow(`     ↩️  Rolling back (deleting user) ... `));
      try {
        await jc.deleteUser(createdUserId);
        rollbackSuccess = true;
        console.log(chalk.green("✓"));
      } catch (rbErr) {
        rollbackSuccess = false;
        console.log(chalk.red(`FAILED: ${rbErr.message}`));
      }

      audit.logImportRollback({
        email: user.email,
        userId: createdUserId,
        deleteSuccess: rollbackSuccess,
        error: errorCausedBy
      });

      errors.push({
        email: user.email,
        error: errorCausedBy,
        rolledBack: rollbackSuccess
      });
    }

    console.log("");
  }

  return { successful, errors };
}

// ─── Step 7: Send Slack Report ──────────────────────────────────────────────────

async function stepSendReport(successful, errors, skipped, dryRun) {
  try {
    await slack.sendImportReport({
      successful,
      errors,
      skipped,
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

  if (!process.env.JC_API_KEY || !process.env.JC_ORG_ID) {
    console.log(chalk.red("  ❌ JC_API_KEY or JC_ORG_ID is missing. Set it in .env file."));
    process.exit(1);
  }

  const domainGroups = getDomainGroupsConfig();

  await stepValidateApiKey();

  const cliEmails = getCliEmails();
  
  const users = await stepPrepareUsers(cliEmails, domainGroups);

  const dryRun = await stepCheckDryRun();

  const { validUsers, skippedUsers, groupCache, gsuiteDirId } = await stepPreFlightChecks(users, domainGroups);

  const proceed = await stepConfirm(validUsers, skippedUsers, domainGroups, dryRun);

  if (!proceed) {
    if (dryRun) {
      const mockSuccess = validUsers.map(u => ({
        email: u.email,
        displayName: `${u.firstname} ${u.lastname}`,
        groups: getGroupsForEmail(u.email, domainGroups),
        directory: "Google Workspace"
      }));
      await stepSendReport(mockSuccess, [], skippedUsers, true);
    }
    console.log("");
    console.log(chalk.gray("  👋 Exiting. No changes were made."));
    console.log("");
    process.exit(0);
  }

  const { successful, errors } = await stepExecuteImport(validUsers, groupCache, gsuiteDirId, domainGroups);

  console.log("");
  await stepSendReport(successful, errors, skippedUsers, false);

  console.log(chalk.gray(`  📝 Audit log: ${audit.getLogFilePath()}`));
  console.log("");
  if (errors.length > 0) {
    console.log(chalk.yellow.bold(`  ⚠️  Done! Imported ${successful.length} user(s), ${errors.length} failed.`));
  } else {
    console.log(chalk.green.bold(`  ✨ Done! Successfully imported ${successful.length} user(s).`));
  }
  console.log("");
}

module.exports = { run };
