/**
 * JumpCloud API Wrapper
 * Handles all API calls to JumpCloud for user lookup, device discovery, and admin granting.
 */

const https = require("https");

// JumpCloud Access Requests operation ID (static, from JumpCloud docs)
const OPERATION_ID = "ff487bda-e18f-42ed-9d6c-5c7cafd6adf9";

/**
 * Make an HTTP request to JumpCloud API.
 * Returns parsed JSON response.
 */
function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const apiUrl = process.env.JC_API_URL || "https://console.jumpcloud.com";
    const url = new URL(path, apiUrl);

    const options = {
      method: method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        "x-api-key": process.env.JC_API_KEY,
        "x-org-id": process.env.JC_ORG_ID,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        // Handle non-JSON responses (e.g. 204 No Content)
        if (!data || data.trim() === "") {
          return resolve({ statusCode: res.statusCode, body: null });
        }
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });

    req.on("error", (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Validate the API key by making a simple request.
 * Returns: { valid: boolean, message: string }
 */
async function validateApiKey() {
  try {
    const res = await apiRequest("GET", "/api/systemusers?limit=1");

    if (res.statusCode === 401) {
      return {
        valid: false,
        message:
          "API key is expired or invalid. Please generate a new key in JumpCloud Admin Console.",
      };
    }

    if (res.statusCode === 403) {
      return {
        valid: false,
        message:
          "API key does not have the required permissions. Check your JumpCloud API key scope.",
      };
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return {
        valid: true,
        message: "API key is valid.",
      };
    }

    return {
      valid: false,
      message: `Unexpected response from JumpCloud API: HTTP ${res.statusCode}`,
    };
  } catch (err) {
    return {
      valid: false,
      message: `Cannot connect to JumpCloud API: ${err.message}`,
    };
  }
}

/**
 * Find a JumpCloud user by email address.
 * Returns: { id, username, email, displayName } or null if not found.
 */
async function findUserByEmail(email) {
  const encodedEmail = encodeURIComponent(email.trim().toLowerCase());
  const res = await apiRequest(
    "GET",
    `/api/systemusers?filter=email:$eq:${encodedEmail}&limit=1`
  );

  if (res.statusCode !== 200) {
    throw new Error(
      `Failed to search for user ${email}: HTTP ${res.statusCode}`
    );
  }

  const users = res.body.results || [];
  if (users.length === 0) {
    return null;
  }

  const user = users[0];
  return {
    id: user._id,
    username: user.username,
    email: user.email,
    displayName: `${user.firstname || ""} ${user.lastname || ""}`.trim() || user.username,
  };
}

/**
 * Get all devices (systems) bound to a user.
 * Returns an array of system IDs.
 */
async function getUserDevices(userId) {
  const devices = [];
  let skip = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const res = await apiRequest(
      "GET",
      `/api/v2/users/${userId}/systems?limit=${limit}&skip=${skip}`
    );

    if (res.statusCode !== 200) {
      throw new Error(
        `Failed to get devices for user ${userId}: HTTP ${res.statusCode}`
      );
    }

    const results = res.body || [];
    for (const item of results) {
      devices.push(item.id);
    }

    hasMore = results.length === limit;
    skip += limit;
  }

  return devices;
}

/**
 * Get device details (hostname, OS, online status).
 * Returns: { id, hostname, displayName, os, active }
 */
async function getDeviceDetails(systemId) {
  const res = await apiRequest("GET", `/api/systems/${systemId}`);

  if (res.statusCode !== 200) {
    throw new Error(
      `Failed to get device details for ${systemId}: HTTP ${res.statusCode}`
    );
  }

  const sys = res.body;
  return {
    id: sys._id,
    hostname: sys.hostname || "Unknown",
    displayName: sys.displayName || sys.hostname || "Unknown",
    os: sys.os || "Unknown",
    active: sys.active === true,
    lastContact: sys.lastContact || null,
  };
}

/**
 * Grant temporary admin/sudo access on a device for a user.
 * Uses the JumpCloud Access Requests API.
 *
 * @param {string} userId - JumpCloud User ID
 * @param {string} systemId - JumpCloud System/Device ID
 * @param {string} expiryISO - ISO 8601 expiry timestamp
 * @returns {{ accessId: string }} - The access request ID (for rollback)
 */
async function grantAdminAccess(userId, systemId, expiryISO) {
  const payload = {
    requestorId: userId,
    resourceId: systemId,
    resourceType: "device",
    remarks: `Temporary admin access granted via auto-grant script. Expires: ${expiryISO}`,
    expiry: expiryISO,
    operationId: OPERATION_ID,
    additionalAttributes: {
      sudo: {
        enabled: true,
        withoutPassword: false
      },
    },
  };

  const res = await apiRequest("POST", "/api/v2/accessrequests", payload);

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const errorMsg =
      res.body && res.body.message
        ? res.body.message
        : JSON.stringify(res.body);
        
    // Don't throw an error if already granted
    if (res.statusCode === 400 && String(errorMsg).includes("Sudo")) {
       return { accessId: null, alreadyGranted: true };
    }

    throw new Error(
      `Failed to grant admin for user ${userId} on device ${systemId}: HTTP ${res.statusCode} - ${errorMsg}`
    );
  }

  return {
    accessId: res.body.id || res.body._id,
    alreadyGranted: false
  };
}

/**
 * Revoke an admin access grant (for rollback on error).
 *
 * @param {string} accessId - The access request ID to revoke
 */
async function revokeAdminAccess(accessId) {
  const res = await apiRequest(
    "DELETE",
    `/api/v2/accessrequests/${accessId}`
  );

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(
      `Failed to revoke access request ${accessId}: HTTP ${res.statusCode}`
    );
  }

  return true;
}

module.exports = {
  validateApiKey,
  findUserByEmail,
  getUserDevices,
  getDeviceDetails,
  grantAdminAccess,
  revokeAdminAccess,
};
