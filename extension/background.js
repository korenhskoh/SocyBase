/**
 * SocyBase Browser Operator — Service Worker
 *
 * Polls the SocyBase API for pending scrape tasks, fetches Facebook pages
 * using the user's own browser session (cookies + IP), parses the HTML,
 * and submits results back to the API.
 */

const POLL_ALARM = "socybase-poll";
const POLL_INTERVAL_MINUTES = 5 / 60; // 5 seconds (chrome.alarms minimum is ~1 min in MV3, so we use setInterval fallback)
const POLL_INTERVAL_MS = 5000;

let pollTimer = null;

// ── Config helpers ──────────────────────────────────────────────────

async function getConfig() {
  const data = await chrome.storage.local.get(["apiUrl", "authToken"]);
  return { apiUrl: data.apiUrl || "", authToken: data.authToken || "" };
}

async function isConfigured() {
  const { apiUrl, authToken } = await getConfig();
  return !!(apiUrl && authToken);
}

// ── API helpers ─────────────────────────────────────────────────────

async function apiGet(path) {
  const { apiUrl, authToken } = await getConfig();
  const res = await fetch(`${apiUrl}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function apiPatch(path) {
  const { apiUrl, authToken } = await getConfig();
  const res = await fetch(`${apiUrl}/api/v1${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function apiPost(path, body) {
  const { apiUrl, authToken } = await getConfig();
  const res = await fetch(`${apiUrl}/api/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Facebook fetch with cookies ─────────────────────────────────────

async function fetchFacebookPage(url) {
  // Service worker fetch() doesn't send browser cookies automatically.
  // Read them via chrome.cookies API and attach manually.
  const cookies = await chrome.cookies.getAll({ domain: ".facebook.com" });
  const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  if (!cookieString || cookies.length < 3) {
    throw new Error("No Facebook cookies found — please log into Facebook in this browser");
  }

  const response = await fetch(url, {
    credentials: "omit",
    headers: {
      Cookie: cookieString,
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Facebook returned ${response.status}`);
  }

  const html = await response.text();

  // Check for login redirect — look for the actual login form, not just any /login link
  if (
    (html.includes('<form id="login_form"') || html.includes('action="/login/')) &&
    !html.includes('id="root"')
  ) {
    throw new Error("Facebook session expired — redirected to login page");
  }

  return html;
}

// ── Offscreen document for HTML parsing ─────────────────────────────
// Service workers can't use DOMParser, so we delegate to an offscreen document.

let offscreenReady = false;

async function ensureOffscreen() {
  if (offscreenReady) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "Parse Facebook HTML with DOMParser",
    });
  } catch (e) {
    // Already exists — that's fine
    if (!e.message.includes("already exists")) throw e;
  }
  offscreenReady = true;
}

async function parseHTML(html, taskType) {
  await ensureOffscreen();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "PARSE_HTML", html, taskType }, (response) => {
      resolve(response || { items: [], nextUrl: null });
    });
  });
}

// ── Main task processor ─────────────────────────────────────────────

async function processTask(task) {
  console.log(`[SocyBase] Processing task ${task.id}: ${task.task_type}`);

  // Claim the task
  try {
    await apiPatch(`/extension/tasks/${task.id}/claim`);
  } catch (e) {
    console.warn(`[SocyBase] Failed to claim task ${task.id}:`, e.message);
    return;
  }

  try {
    // Fetch the mbasic page using user's cookies
    let currentUrl = task.target_url;
    let allItems = [];
    let pagesLoaded = 0;
    const maxPages = task.task_type === "scrape_comments" ? 10 : 4;
    const limit = task.limit || (task.task_type === "scrape_comments" ? 100 : 10);

    while (pagesLoaded < maxPages && allItems.length < limit) {
      console.log(`[SocyBase] Fetching page ${pagesLoaded + 1}: ${currentUrl}`);
      const html = await fetchFacebookPage(currentUrl);

      // Parse via offscreen document (has DOMParser)
      const { items, nextUrl } = await parseHTML(html, task.task_type);
      for (const item of items) {
        if (!allItems.some((existing) => existing.id === item.id)) {
          allItems.push(item);
        }
      }

      pagesLoaded++;

      if (allItems.length >= limit) break;
      if (!nextUrl) break;

      currentUrl = nextUrl;

      // Rate limiting delay
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
    }

    allItems = allItems.slice(0, limit);
    console.log(`[SocyBase] Task ${task.id}: extracted ${allItems.length} items from ${pagesLoaded} pages`);

    // Submit results
    await apiPost(`/extension/tasks/${task.id}/result`, {
      success: true,
      data: { data: allItems, paging: {} },
    });
  } catch (e) {
    console.error(`[SocyBase] Task ${task.id} failed:`, e.message);
    await apiPost(`/extension/tasks/${task.id}/result`, {
      success: false,
      error: e.message,
    });
  }
}

// ── Polling loop ────────────────────────────────────────────────────

async function pollForTasks() {
  if (!(await isConfigured())) return;

  try {
    const data = await apiGet("/extension/tasks");
    if (data.tasks && data.tasks.length > 0) {
      console.log(`[SocyBase] Found ${data.tasks.length} pending task(s)`);
      // Process one task at a time
      await processTask(data.tasks[0]);
    }
  } catch (e) {
    console.warn("[SocyBase] Poll error:", e.message);
  }
}

function startPolling() {
  stopPolling();
  pollForTasks(); // Immediate first poll
  pollTimer = setInterval(pollForTasks, POLL_INTERVAL_MS);
  console.log("[SocyBase] Polling started");
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── Message handling ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SOCYBASE_SET_CONFIG") {
    chrome.storage.local.set(
      { apiUrl: msg.apiUrl, authToken: msg.authToken },
      () => {
        startPolling();
        sendResponse({ success: true });
      }
    );
    return true; // async response
  }

  if (msg.type === "SOCYBASE_GET_STATUS") {
    (async () => {
      const configured = await isConfigured();
      sendResponse({ configured, polling: !!pollTimer });
    })();
    return true;
  }

  if (msg.type === "SOCYBASE_DISCONNECT") {
    stopPolling();
    chrome.storage.local.remove(["apiUrl", "authToken"], () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// ── Startup ─────────────────────────────────────────────────────────

chrome.storage.local.get(["apiUrl", "authToken"], (data) => {
  if (data.apiUrl && data.authToken) {
    startPolling();
  }
});
