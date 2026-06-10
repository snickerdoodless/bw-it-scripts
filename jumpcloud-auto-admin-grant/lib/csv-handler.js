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

/**
 * Derived user details from an email address (first.last@domain).
 * Sets lastname to "-" if no dot in the prefix.
 */
function deriveUserDetailsFromEmail(email) {
  const prefix = email.split("@")[0] || "";
  const parts = prefix.split(".");
  const firstname = parts[0]
    ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
    : "";
  let lastname = "-";
  if (parts.length > 1) {
    lastname = parts.slice(1).join(" ");
    lastname = lastname.charAt(0).toUpperCase() + lastname.slice(1);
  }
  return {
    username: prefix,
    firstname,
    lastname,
  };
}

/**
 * Parse a CSV file for importing users.
 * Expects a CSV with headers: email, alternateEmail, jobTitle, department
 *
 * @param {string} filePath - Path to the CSV file
 * @returns {Object[]} - Array of user objects
 */
function parseImportCSV(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`CSV file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8").trim();
  if (!content) {
    throw new Error("CSV file is empty");
  }

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const users = [];

  for (const record of records) {
    const emailKey = Object.keys(record).find((k) => k.toLowerCase() === "email");
    if (!emailKey || !record[emailKey]) continue;

    const email = record[emailKey].trim().toLowerCase();
    if (!isValidEmail(email)) {
      console.warn(`WARNING: Skipping invalid email: ${email}`);
      continue;
    }

    const altEmailKey = Object.keys(record).find((k) => k.toLowerCase().replace(/[^a-z]/g, "") === "alternateemail");
    const jobTitleKey = Object.keys(record).find((k) => k.toLowerCase().replace(/[^a-z]/g, "") === "jobtitle");
    const departmentKey = Object.keys(record).find((k) => k.toLowerCase() === "department");

    const derived = deriveUserDetailsFromEmail(email);

    users.push({
      email,
      alternateEmail: altEmailKey && record[altEmailKey] ? record[altEmailKey].trim() : "",
      jobTitle: jobTitleKey && record[jobTitleKey] ? record[jobTitleKey].trim() : "",
      department: departmentKey && record[departmentKey] ? record[departmentKey].trim() : "",
      username: derived.username,
      firstname: derived.firstname,
      lastname: derived.lastname,
    });
  }

  if (users.length === 0) {
    throw new Error("No valid user records found in the CSV. Ensure there is an 'email' column.");
  }

  return users;
}

module.exports = {
  parseCSV,
  parseImportCSV,
  isValidEmail,
  deriveUserDetailsFromEmail,
};
