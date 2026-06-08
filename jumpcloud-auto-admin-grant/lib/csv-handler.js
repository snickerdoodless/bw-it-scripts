/**
 * CSV Handler Module
 * Parses CSV files to extract email addresses.
 */

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

/**
 * Parse a CSV file and extract email addresses.
 * Expects a CSV with a header row containing an "email" column.
 * Also supports single-column CSV without headers (auto-detects).
 *
 * @param {string} filePath - Path to the CSV file
 * @returns {string[]} - Array of email addresses
 */
function parseCSV(filePath) {
  // Resolve the path
  const resolvedPath = path.resolve(filePath);

  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`CSV file not found: ${resolvedPath}`);
  }

  // Read the file
  const content = fs.readFileSync(resolvedPath, "utf-8").trim();

  if (!content) {
    throw new Error("CSV file is empty");
  }

  // Check if the first line looks like a header with "email"
  const firstLine = content.split("\n")[0].trim().toLowerCase();
  const hasHeader = firstLine.includes("email");

  let emails = [];

  if (hasHeader) {
    // Parse as CSV with headers
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Find the email column (case-insensitive)
    for (const record of records) {
      const emailKey = Object.keys(record).find(
        (k) => k.toLowerCase() === "email"
      );
      if (emailKey && record[emailKey]) {
        emails.push(record[emailKey].trim().toLowerCase());
      }
    }
  } else {
    // Treat each line as an email address
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed && isValidEmail(trimmed)) {
        emails.push(trimmed);
      }
    }
  }

  // Remove duplicates
  emails = [...new Set(emails)];

  // Validate emails
  const invalidEmails = emails.filter((e) => !isValidEmail(e));
  if (invalidEmails.length > 0) {
    throw new Error(
      `Invalid email addresses found: ${invalidEmails.join(", ")}`
    );
  }

  if (emails.length === 0) {
    throw new Error(
      "No valid email addresses found in the CSV file. Make sure the file has an 'email' column header or one email per line."
    );
  }

  return emails;
}

/**
 * Basic email validation.
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = {
  parseCSV,
  isValidEmail,
};
