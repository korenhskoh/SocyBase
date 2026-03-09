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

// ── Facebook HTML parsing ───────────────────────────────────────────

function extractUserIdFromHref(href) {
  if (!href) return "";
  // profile.php?id=NUM
  let m = href.match(/profile\.php\?id=(\d+)/);
  if (m) return m[1];
  // /NUM? (direct numeric ID)
  m = href.match(/^\/(\d+)/);
  if (m) return m[1];
  // /username?...
  m = href.match(/^\/([^/?]+)/);
  if (m) return m[1];
  return "";
}

function parseCommentsFromHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const comments = [];
  const seenIds = new Set();

  // Try multiple selectors (same as playwright_facebook.py)
  let commentDivs = doc.querySelectorAll('[id^="ufi"] > div > div');
  if (!commentDivs.length) commentDivs = doc.querySelectorAll('div[data-sigil="comment"]');
  if (!commentDivs.length) commentDivs = doc.querySelectorAll("div.dw > div");
  if (!commentDivs.length) commentDivs = doc.querySelectorAll("#root div > div > div");

  for (const div of commentDivs) {
    try {
      // Find profile link
      let profileLink = div.querySelector('a[href*="profile.php"], a[href*="fref="]');
      if (!profileLink) {
        for (const link of div.querySelectorAll("a")) {
          const href = link.getAttribute("href") || "";
          const text = link.textContent.trim();
          if (
            text &&
            text.length > 1 &&
            (href.includes("profile.php") ||
              (href.startsWith("/") && href.includes("?") && !href.startsWith("/story")))
          ) {
            profileLink = link;
            break;
          }
        }
      }
      if (!profileLink) continue;

      const name = profileLink.textContent.trim();
      const href = profileLink.getAttribute("href") || "";
      const userId = extractUserIdFromHref(href);

      if (!name || name.length < 2) continue;

      // Get comment text
      let message = div.textContent.trim();
      if (message.startsWith(name)) {
        message = message.slice(name.length).trim();
      }
      // Remove trailing metadata
      message = message.split(/\n\s*(?:Like|Reply|Comment|Suka|Balas|·)/)[0].trim();

      if (!message) continue;

      const commentId = `ext_${userId}_${(hashCode(message) & 0xffffff).toString(16).padStart(6, "0")}`;

      if (seenIds.has(commentId)) continue;
      seenIds.add(commentId);

      comments.push({
        from: { id: String(userId), name },
        id: commentId,
        message,
        created_time: "",
      });
    } catch {
      continue;
    }
  }

  return comments;
}

function parseFeedFromHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const posts = [];
  const seenIds = new Set();

  // Try multiple selectors (same as playwright_facebook.py)
  let postElements = doc.querySelectorAll("article");
  if (!postElements.length) postElements = doc.querySelectorAll("[data-ft]");
  if (!postElements.length) postElements = doc.querySelectorAll("div.story_body_container");
  if (!postElements.length) {
    postElements = doc.querySelectorAll(
      "#structured_composer_async_container ~ div > div > div"
    );
  }

  for (const el of postElements) {
    try {
      // Extract post ID from links
      let postId = "";
      let postUrl = "";
      for (const link of el.querySelectorAll("a")) {
        const href = link.getAttribute("href") || "";
        let m = href.match(/story_fbid=(\d+)/);
        if (m) {
          postId = m[1];
          postUrl = href.includes("?")
            ? `https://www.facebook.com/permalink.php?${href.split("?")[1]}`
            : "";
          break;
        }
        m = href.match(/\/posts\/(\w+)/);
        if (m) {
          postId = m[1];
          postUrl = `https://www.facebook.com${href}`;
          break;
        }
        m = href.match(/(pfbid\w+)/);
        if (m) {
          postId = m[1];
          postUrl = `https://www.facebook.com${href}`;
          break;
        }
      }

      if (!postId) {
        const text = el.textContent.trim();
        if (!text || text.length < 10) continue;
        postId = `ext_${(hashCode(text) >>> 0).toString(16).padStart(8, "0")}`;
      }

      if (seenIds.has(postId)) continue;
      seenIds.add(postId);

      // Extract author
      let fromName = "";
      let fromId = "";
      const headerLink = el.querySelector(
        "header a, h3 a, strong a, a[href*='profile.php'], a[href*='fref=']"
      );
      if (headerLink) {
        fromName = headerLink.textContent.trim();
        fromId = extractUserIdFromHref(headerLink.getAttribute("href") || "");
      }

      // Extract message
      let message = "";
      const pTags = el.querySelectorAll("p");
      if (pTags.length) {
        message = Array.from(pTags)
          .map((p) => p.textContent.trim())
          .filter(Boolean)
          .join("\n");
      } else {
        message = el.textContent.trim();
        if (fromName && message.startsWith(fromName)) {
          message = message.slice(fromName.length).trim();
        }
      }

      // Extract engagement from text
      let commentCount = 0;
      let reactionCount = 0;
      let shareCount = 0;
      const footer = el.querySelector("footer, abbr");
      const footerText = footer ? footer.textContent : el.textContent;
      let cm = footerText.match(/(\d+)\s*(?:comment|komen)/i);
      if (cm) commentCount = parseInt(cm[1]);
      let rm = footerText.match(/(\d+)\s*(?:reaction|like|suka)/i);
      if (rm) reactionCount = parseInt(rm[1]);
      let sm = footerText.match(/(\d+)\s*(?:share|kongsi)/i);
      if (sm) shareCount = parseInt(sm[1]);

      if (!message && !fromName) continue;

      posts.push({
        id: String(postId),
        message: message.slice(0, 2000),
        created_time: "",
        updated_time: "",
        from: { name: fromName, id: String(fromId) },
        comments: { summary: { total_count: commentCount } },
        reactions: { summary: { total_count: reactionCount } },
        shares: { count: shareCount },
        attachments: { data: [] },
        post_url: postUrl,
      });
    } catch {
      continue;
    }
  }

  return posts;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// ── Pagination helpers ──────────────────────────────────────────────

function findNextPageUrl(doc, taskType) {
  const keywords =
    taskType === "scrape_comments"
      ? ["more comment", "previous comment", "view more", "see more", "komen lagi", "lihat lagi"]
      : ["see more post", "show more", "more stories", "older post", "lagi cerita", "lihat lagi"];

  for (const link of doc.querySelectorAll("a")) {
    const text = link.textContent.trim().toLowerCase();
    if (keywords.some((kw) => text.includes(kw))) {
      const href = link.getAttribute("href");
      if (href) {
        if (href.startsWith("http")) return href;
        return `https://mbasic.facebook.com${href}`;
      }
    }
  }
  return null;
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

      // Parse based on task type
      if (task.task_type === "scrape_comments") {
        const comments = parseCommentsFromHTML(html);
        for (const c of comments) {
          if (!allItems.some((existing) => existing.id === c.id)) {
            allItems.push(c);
          }
        }
      } else {
        const posts = parseFeedFromHTML(html);
        for (const p of posts) {
          if (!allItems.some((existing) => existing.id === p.id)) {
            allItems.push(p);
          }
        }
      }

      pagesLoaded++;

      if (allItems.length >= limit) break;

      // Find next page link
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const nextUrl = findNextPageUrl(doc, task.task_type);
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
