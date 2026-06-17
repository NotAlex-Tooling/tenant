// Express server that serves the tenant web interface and proxies the Microsoft 365 pre-auth endpoints used for passive domain and user reconnaissance.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const GETUSERREALM_URL = "https://login.microsoftonline.com/getuserrealm.srf";
const CREDENTIALTYPE_URL = "https://login.microsoftonline.com/common/GetCredentialType";
const DOMAIN_PATTERN = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

// Pauses execution for the given number of milliseconds.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Performs an HTTP request with a timeout and retries on transient network and server errors.
async function fetchWithRetry(url, options, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (RETRY_STATUSES.has(response.status) && attempt < attempts - 1) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        throw new Error(`microsoft endpoint returned status ${response.status}`);
      }
      return response;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err.name === "AbortError" ? new Error("request to microsoft timed out") : err;
      if (attempt < attempts - 1) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError;
}

// Queries the getuserrealm endpoint to determine whether a domain is registered with Microsoft 365.
async function checkDomain(rawDomain) {
  const domain = rawDomain.trim().toLowerCase();
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new Error("invalid domain format");
  }

  const url = `${GETUSERREALM_URL}?login=${encodeURIComponent(`user@${domain}`)}&json=1`;
  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT },
  });
  const data = await response.json();

  const namespaceType = (data.NameSpaceType || "").trim();
  const result = { mode: "domain", domain, exists: false, namespace_type: namespaceType };

  if (namespaceType === "Managed" || namespaceType === "Federated") {
    result.exists = true;
    result.tenant_id = data.TenantId || null;
    if (namespaceType === "Federated") {
      result.federation_brand = data.FederationBrandName || null;
    }
  }

  return result;
}

// Queries the GetCredentialType endpoint to determine whether a user account exists in Microsoft 365.
async function checkUser(rawEmail) {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("invalid email format");
  }

  const response = await fetchWithRetry(CREDENTIALTYPE_URL, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json" },
    body: JSON.stringify({ Username: email }),
  });
  const data = await response.json();

  const ifExists = data.IfExistsResult;
  return {
    mode: "user",
    email,
    valid: ifExists === 0 || ifExists === 5 || ifExists === 6,
    if_exists_result: ifExists,
    desktop_sso: Boolean(data.DesktopSsoEnabled),
  };
}

// Validates the request body and routes it to the correct reconnaissance check.
async function handleCheck(req, res) {
  const { mode, target } = req.body || {};
  if (mode !== "domain" && mode !== "user") {
    return res.status(400).json({ success: false, error: "mode must be 'domain' or 'user'" });
  }
  if (!target || typeof target !== "string") {
    return res.status(400).json({ success: false, error: "a target is required" });
  }

  try {
    const result = mode === "domain" ? await checkDomain(target) : await checkUser(target);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.post("/api/check", handleCheck);
app.listen(PORT, () => console.log(`tenant listening on http://localhost:${PORT}`));
