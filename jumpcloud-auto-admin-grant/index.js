#!/usr/bin/env node

/**
 * JumpCloud Admin Tools — CLI Entry Point
 *
 * Multi-command CLI for JumpCloud administration tasks.
 * Routes to the appropriate command handler based on the subcommand.
 *
 * Usage:
 *   jc-admin grant [emails...] [options]   # Grant temporary admin access
 *   jc-admin reset [emails...] [options]   # Reset user passwords
 *   jc-admin --help                        # Show this help
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const chalk = require("chalk");

// ─── Top-Level Help ─────────────────────────────────────────────────────────────

function showTopLevelHelp() {
  console.log("");
  console.log(chalk.bold.cyan("  🔧 JumpCloud Admin Tools"));
  console.log(chalk.gray("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log("");
  console.log("  Multi-command CLI for JumpCloud administration tasks.");
  console.log("");
  console.log(chalk.bold("  Commands:"));
  console.log("    grant    Grant temporary admin/sudo privileges on devices");
  console.log("    reset    Reset user passwords");
  console.log("    import   Import users from Google Workspace");
  console.log("");
  console.log(chalk.bold("  Usage:"));
  console.log("    jc-admin <command> [emails...] [options]");
  console.log("");
  console.log(chalk.bold("  Options:"));
  console.log("    -h, --help    Show help (use with a command for command-specific help)");
  console.log("");
  console.log(chalk.bold("  Examples:"));
  console.log("    jc-admin import                               # Interactive import");
  console.log("    jc-admin grant user@company.com               # Quick grant for single user");
  console.log("    jc-admin reset user@company.com               # Reset with default password");
  console.log("");
  process.exit(0);
}

// ─── Main Router ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // No args or help flag at top level → show help
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    // If a subcommand is present before --help, let the subcommand handle it
    const firstArg = args[0];
    if (firstArg && firstArg !== "--help" && firstArg !== "-h" && !firstArg.startsWith("--")) {
      // Fall through to subcommand routing below
    } else {
      showTopLevelHelp();
    }
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  // Pass the sub-arguments via process.argv manipulation for compatibility
  // The command modules read from process.argv
  process.argv = [process.argv[0], process.argv[1], ...subArgs];

  switch (subcommand) {
    case "grant": {
      const grant = require("./commands/grant");
      await grant.run();
      break;
    }
    case "reset": {
      const reset = require("./commands/reset");
      await reset.run();
      break;
    }
    case "import": {
      const importCmd = require("./commands/import");
      await importCmd.run();
      break;
    }
    default: {
      console.log("");
      console.log(chalk.red(`  ❌ Unknown command: "${subcommand}"`));
      console.log(chalk.gray("     Run 'jc-admin --help' to see available commands."));
      console.log("");
      process.exit(1);
    }
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("");
  console.error(chalk.red(`  ❌ Unexpected error: ${err.message}`));
  console.error(chalk.gray(`     ${err.stack}`));
  console.error("");
  process.exit(1);
});
