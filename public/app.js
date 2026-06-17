// Frontend logic for the tenant web interface: theme switching, mode selection, calling the check API, and rendering the animated verdict readout.

const STORAGE_KEY = "tenant-theme";
const PLACEHOLDERS = { domain: "contoso.com", user: "user@contoso.com" };
const LABELS = { domain: "Domain to check", user: "Email to check" };
const NOTES = {
  domain: "Checks if a domain is registered with Microsoft 365.",
  user: "Checks login identity (UPN), not email aliases.",
};

let mode = "domain";

const root = document.documentElement;
const themeToggle = document.getElementById("theme-toggle");
const tabDomain = document.getElementById("tab-domain");
const tabUser = document.getElementById("tab-user");
const indicator = document.getElementById("tab-indicator");
const input = document.getElementById("target");
const checkButton = document.getElementById("check");
const note = document.getElementById("note");
const readout = document.getElementById("readout");

// Stores the chosen theme and applies it to the document root.
function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (e) {}
}

// Switches between light and dark themes.
function toggleTheme() {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
}

// Escapes a string so it can be safely inserted as HTML text.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Switches the active check mode and resets the input and readout for it.
function setMode(next) {
  mode = next;
  const isDomain = next === "domain";
  tabDomain.setAttribute("aria-selected", String(isDomain));
  tabUser.setAttribute("aria-selected", String(!isDomain));
  indicator.dataset.pos = next;
  input.value = "";
  input.placeholder = PLACEHOLDERS[next];
  input.setAttribute("aria-label", LABELS[next]);
  note.textContent = NOTES[next];
  renderEmpty(isDomain ? "Enter a domain above and run a check." : "Enter an email above and run a check.");
  input.focus();
}

// Builds the HTML for a list of label and value rows.
function buildRows(rows) {
  const items = rows
    .map(
      (r, i) =>
        `<div class="row" style="animation-delay:${0.05 * (i + 1)}s">` +
        `<span class="row__key">${escapeHtml(r.key)}</span>` +
        `<span class="row__val${r.cls ? " " + r.cls : ""}">${escapeHtml(r.val)}</span>` +
        `</div>`
    )
    .join("");
  return `<div class="rows">${items}</div>`;
}

// Renders the idle empty state with a hint message.
function renderEmpty(message) {
  readout.className = "readout readout--empty";
  readout.innerHTML = `<span class="field__caret" aria-hidden="true">&gt;</span><span>${escapeHtml(message)}</span>`;
}

// Renders the in-progress scanning state for the current target.
function renderBusy(target) {
  readout.className = "readout";
  readout.innerHTML =
    `<div class="card card--scan">` +
    `<div class="status">` +
    `<span class="status__dot status__dot--busy"></span>` +
    `<span class="status__verdict">checking<span class="dots"><span>.</span><span>.</span><span>.</span></span></span>` +
    `<span class="status__target">${escapeHtml(target)}</span>` +
    `</div></div>`;
}

// Renders an error readout with a clear, actionable message.
function renderError(message) {
  readout.className = "readout";
  readout.innerHTML =
    `<div class="card card--bad">` +
    `<div class="status">` +
    `<span class="status__dot status__dot--bad"></span>` +
    `<span class="status__verdict status__verdict--bad">error</span>` +
    `</div>` +
    `<div class="rows"><div class="row"><span class="row__val">${escapeHtml(message)}</span></div></div>` +
    `</div>`;
}

// Renders the verdict and details for a successful domain or user check.
function renderResult(data) {
  const ok = data.mode === "domain" ? data.exists : data.valid;
  const target = data.mode === "domain" ? data.domain : data.email;
  let verdict;
  let rows;
  let cardNote = "";

  if (data.mode === "domain") {
    verdict = ok ? "registered" : "not found";
    rows = [{ key: "domain", val: data.domain }];
    rows.push({
      key: "namespace",
      val: data.namespace_type || "Unknown",
      cls: ok ? "row__val--accent" : "",
    });
    if (ok && data.tenant_id) rows.push({ key: "tenant id", val: data.tenant_id });
    if (ok && data.federation_brand) rows.push({ key: "federation", val: data.federation_brand });
  } else {
    verdict = ok ? "exists" : "not found";
    rows = [{ key: "email", val: data.email }];
    rows.push({
      key: "desktop sso",
      val: data.desktop_sso ? "enabled" : "disabled",
      cls: data.desktop_sso ? "row__val--warn" : "",
    });
    rows.push({ key: "if-exists", val: String(data.if_exists_result) });
    cardNote = `<p class="card__note">Checks login identity (UPN), not email aliases.</p>`;
  }

  readout.className = "readout";
  readout.innerHTML =
    `<div class="card card--${ok ? "ok" : "bad"}">` +
    `<div class="status">` +
    `<span class="status__dot status__dot--${ok ? "ok" : "bad"}"></span>` +
    `<span class="status__verdict status__verdict--${ok ? "ok" : "bad"}">${verdict}</span>` +
    `<span class="status__target">${escapeHtml(target)}</span>` +
    `</div>` +
    buildRows(rows) +
    cardNote +
    `</div>`;
}

// Translates a raw error into a clear, user-facing message.
function friendlyError(message) {
  const text = String(message || "");
  if (text.includes("invalid domain")) return "That doesn't look like a valid domain. Try something like contoso.com.";
  if (text.includes("invalid email")) return "That doesn't look like a valid email. Try something like user@contoso.com.";
  if (text.includes("timed out")) return "The request to Microsoft timed out. Try again in a moment.";
  if (text.toLowerCase().includes("fetch")) return "Couldn't reach the server. Check your connection and try again.";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Validates the input, calls the check API, and renders the result.
async function runCheck() {
  const target = input.value.trim();
  if (!target) {
    renderError(mode === "domain" ? "Enter a domain to check." : "Enter an email to check.");
    return;
  }
  if (mode === "user" && !target.includes("@")) {
    renderError("That doesn't look like a valid email. Try something like user@contoso.com.");
    return;
  }

  checkButton.disabled = true;
  renderBusy(target);

  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, target }),
    });
    const data = await response.json();
    if (data.success) {
      renderResult(data);
    } else {
      renderError(friendlyError(data.error));
    }
  } catch (err) {
    renderError(friendlyError(err.message));
  } finally {
    checkButton.disabled = false;
  }
}

// Runs a check when the Enter key is pressed in the input.
function handleKeydown(event) {
  if (event.key === "Enter") runCheck();
}

// Wires up all event listeners once the page is ready.
function init() {
  themeToggle.addEventListener("click", toggleTheme);
  tabDomain.addEventListener("click", () => setMode("domain"));
  tabUser.addEventListener("click", () => setMode("user"));
  checkButton.addEventListener("click", runCheck);
  input.addEventListener("keydown", handleKeydown);
}

init();
