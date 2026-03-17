/**
 * SocyBase Browser Operator — Service Worker
 *
 * Polls the SocyBase API for pending scrape tasks, fetches Facebook pages
 * using the user's own browser session (cookies + IP), parses the HTML,
 * and submits results back to the API.
 */

const POLL_INTERVAL_MS = 5000;
const TASK_TIMEOUT_MS = 110 * 1000; // 110s task timeout (backend waits 2min = 120s)

let pollTimer = null;
let processingTask = false; // Guard against overlapping task processing

// ── Side Panel setup ────────────────────────────────────────────────
// Allow user to open side panel by clicking the extension icon
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Broadcast activity to side panel
function broadcastActivity(icon, message) {
  chrome.runtime.sendMessage({ type: "SOCYBASE_TASK_ACTIVITY", icon, message }).catch(() => {});
}

// Increment task stats in storage
async function incrementStat(key) {
  const data = await chrome.storage.local.get([key]);
  await chrome.storage.local.set({ [key]: (data[key] || 0) + 1 });
}

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

// Retry wrapper for result submission — retries up to 3 times with backoff
async function apiPostWithRetry(path, body, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await apiPost(path, body);
    } catch (e) {
      console.warn(`[SocyBase] API POST attempt ${attempt + 1}/${maxRetries} failed:`, e.message);
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}

// Safe tab cleanup — logs errors instead of swallowing them
async function safeCloseTab(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {
    if (!e.message?.includes("not attached")) {
      console.warn(`[SocyBase] Debugger detach warning for tab ${tabId}:`, e.message);
    }
  }
  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {
    if (!e.message?.includes("No tab")) {
      console.warn(`[SocyBase] Tab close warning for tab ${tabId}:`, e.message);
    }
  }
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

  console.log(`[SocyBase] Fetching with ${cookies.length} cookies`);

  const response = await fetch(url, {
    credentials: "omit",
    headers: {
      Cookie: cookieString,
    },
  });

  if (!response.ok) {
    throw new Error(`Facebook returned ${response.status}`);
  }

  const html = await response.text();
  const isDesktop =
    html.includes('class="_9dls') || (html.includes('id="facebook"') && !html.includes('id="root"'));
  console.log(`[SocyBase] Fetched ${html.length} chars, desktop=${isDesktop}`);

  // Only check login for mbasic HTML — desktop HTML may contain login fragments even when logged in
  if (
    !isDesktop &&
    (html.includes('<form id="login_form"') || html.includes('action="/login/')) &&
    !html.includes('id="root"')
  ) {
    throw new Error("Facebook session expired — redirected to login page");
  }

  return { html, isDesktop };
}

// ── Tab-based scraping with chrome.debugger CDP ─────────────────────
// Uses Chrome DevTools Protocol for real mouse wheel scrolling and
// incremental comment extraction — like a real user browsing.

// CDP helper: send a command via chrome.debugger
function cdp(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

// CDP helper: evaluate JS in the page and return result
async function cdpEval(tabId, expression) {
  const res = await cdp(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || "JS eval error");
  return res.result?.value;
}

// CDP helper: dispatch mouse wheel scroll at given coordinates
async function cdpScroll(tabId, x, y, deltaY = 600) {
  await cdp(tabId, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX: 0,
    deltaY,
  });
}

async function fetchAndParseViaTab(url, taskType) {
  console.log(`[SocyBase] Tab fallback: opening ${url}`);

  const tab = await chrome.tabs.create({ url, active: true });

  try {
    // Wait for page to finish loading
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Tab load timeout after 30s"));
      }, 30000);
      function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Wait for modal to appear
    await new Promise((r) => setTimeout(r, 2000));

    if (taskType === "scrape_comments") {
      return await scrapeCommentsWithCDP(tab.id);
    }

    // Non-comment tasks: just extract via scripting
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDataFromRenderedPage,
      args: [taskType],
    });
    const result = results?.[0]?.result || { items: [], nextUrl: null };
    console.log(`[SocyBase] Tab extraction: ${result.items.length} items, nextUrl=${result.nextUrl}`);
    return result;
  } finally {
    await safeCloseTab(tab.id);
  }
}

// ── Main CDP-based comment scraper ──────────────────────────────────
// Flow:
// 1. Attach debugger → get viewport size
// 2. Scroll down in modal to find "All comments" filter → click it
// 3. Scroll + extract incrementally until no new comments appear
async function scrapeCommentsWithCDP(tabId) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Attach debugger
  await new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
  console.log("[SocyBase CDP] Debugger attached");

  // Get viewport size so we know where to scroll
  const layoutMetrics = await cdp(tabId, "Page.getLayoutMetrics");
  const vw = layoutMetrics.cssVisualViewport?.clientWidth || 800;
  const vh = layoutMetrics.cssVisualViewport?.clientHeight || 600;
  // Scroll at center of viewport — will hit the modal content
  const scrollX = Math.round(vw / 2);
  const scrollY = Math.round(vh / 2);
  console.log(`[SocyBase CDP] Viewport: ${vw}x${vh}, scroll target: (${scrollX}, ${scrollY})`);

  // ── Step 1: Scroll down to find & click "All comments" filter ──
  const filterFound = await cdpEval(tabId, `
    (function() {
      const keywords = ["most relevant", "newest first", "all comment", "paling relevan", "terbaru"];
      for (const el of document.querySelectorAll('div[role="button"], span[role="button"]')) {
        const text = el.textContent.trim().toLowerCase();
        if (text.length < 50 && keywords.some(kw => text.includes(kw))) {
          el.scrollIntoView({ behavior: "instant", block: "center" });
          return true;
        }
      }
      return false;
    })()
  `);

  if (!filterFound) {
    // Scroll down step by step to find it
    for (let i = 0; i < 20; i++) {
      await cdpScroll(tabId, scrollX, scrollY, 500);
      await wait(800);
      const found = await cdpEval(tabId, `
        (function() {
          const keywords = ["most relevant", "newest first", "all comment", "paling relevan", "terbaru"];
          for (const el of document.querySelectorAll('div[role="button"], span[role="button"]')) {
            const text = el.textContent.trim().toLowerCase();
            if (text.length < 50 && keywords.some(kw => text.includes(kw))) {
              el.scrollIntoView({ behavior: "instant", block: "center" });
              return true;
            }
          }
          return false;
        })()
      `);
      if (found) break;
    }
  }

  // Click the filter button
  await wait(500);
  const clickedFilter = await cdpEval(tabId, `
    (function() {
      const keywords = ["most relevant", "newest first", "all comment", "paling relevan", "terbaru"];
      for (const el of document.querySelectorAll('div[role="button"], span[role="button"]')) {
        const text = el.textContent.trim().toLowerCase();
        if (text.length < 50 && keywords.some(kw => text.includes(kw))) {
          el.click();
          return text;
        }
      }
      return null;
    })()
  `);
  if (clickedFilter) {
    console.log(`[SocyBase CDP] Clicked filter: "${clickedFilter}"`);

    // Wait for dropdown menu to render, retry a few times
    let selected = null;
    for (let attempt = 0; attempt < 5 && !selected; attempt++) {
      await wait(1000);
      selected = await cdpEval(tabId, `
        (function() {
          for (const opt of document.querySelectorAll('div[role="menuitem"], div[role="option"]')) {
            const t = opt.textContent.trim().toLowerCase();
            if (t.includes("all comment") || t.includes("semua komentar")) {
              opt.click();
              return t;
            }
          }
          return null;
        })()
      `);
    }
    if (selected) {
      console.log(`[SocyBase CDP] Selected: "${selected}"`);
      await wait(3000);
    } else {
      console.log("[SocyBase CDP] Could not find 'All comments' option in dropdown");
    }
  } else {
    console.log("[SocyBase CDP] Filter button not found, using default sort");
  }

  // ── Step 2: Scroll + extract incrementally ──
  // The extraction JS that runs in page context each round
  const extractJS = `
    (function() {
      function extractUserId(href) {
        if (!href) return "";
        let m = href.match(/profile\\.php\\?id=(\\d+)/);
        if (m) return m[1];
        m = href.match(/facebook\\.com\\/(\\d+)/);
        if (m) return m[1];
        m = href.match(/^\\/([\\d]+)/);
        if (m) return m[1];
        m = href.match(/facebook\\.com\\/([^/?#]+)/);
        if (m && !["pages","groups","photo","story","watch","reel","share","sharer","login","help"].includes(m[1])) return m[1];
        m = href.match(/^\\/([^/?#]+)/);
        if (m && !["story.php","photo.php","permalink.php","groups","pages"].includes(m[1])) return m[1];
        return "";
      }
      function hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
        return hash;
      }

      const allArticles = Array.from(document.querySelectorAll('div[role="article"]'));
      const commentArts = allArticles.length > 1 ? allArticles.slice(1) : [];
      const items = [];

      for (const div of commentArts) {
        try {
          let name = "", href = "";

          for (const link of div.querySelectorAll('a[role="link"]')) {
            if (link.getAttribute("aria-hidden") === "true") continue;
            if (link.getAttribute("tabindex") === "-1") continue;
            const h = link.getAttribute("href") || "";
            const t = link.textContent.trim();
            if (t && t.length > 1 && t.length < 80 &&
                (h.includes("profile.php") || h.includes("facebook.com/")) &&
                !h.includes("/photo") && !h.includes("/story")) {
              name = t; href = h; break;
            }
          }
          if (!name) {
            const label = div.getAttribute("aria-label") || "";
            const m = label.match(/^Comment by (.+?)\\s+\\d+\\s*(h|m|d|w|s|hour|min|day|week|month|year)/i);
            if (m) {
              name = m[1].trim();
              for (const link of div.querySelectorAll('a[role="link"]')) {
                const h = link.getAttribute("href") || "";
                if ((h.includes("profile.php") || h.includes("facebook.com/")) && !h.includes("/photo")) { href = h; break; }
              }
            }
          }
          if (!name || name.length < 2) continue;

          const userId = extractUserId(href);
          if (!userId) continue;

          let message = "";
          const textEl = div.querySelector('div[dir="auto"][style*="text-align:start"]');
          if (textEl) message = textEl.textContent.trim();
          if (!message) {
            const nameLow = name.toLowerCase();
            for (const el of div.querySelectorAll('div[dir="auto"], span[dir="auto"]')) {
              const t = el.textContent.trim();
              if (!t || t.toLowerCase() === nameLow) continue;
              if (/^(Like|Reply|Haha|Love|Wow|Sad|Angry|Share|Hide|Report|\\d+\\s*(h|m|d|w|hr|min|s)|Most relevant|Newest|All comments)/i.test(t)) continue;
              if (t.length >= 1) { message = t; break; }
            }
          }
          if (!message) continue;

          const cid = "ext_" + userId + "_" + ((hashCode(message) & 0xffffff) >>> 0).toString(16).padStart(6, "0");
          items.push({ from: { id: String(userId), name }, id: cid, message: message.slice(0, 1000), created_time: "" });
        } catch { continue; }
      }
      return { count: allArticles.length, items: items };
    })()
  `;

  const allItems = new Map(); // cid → item, deduplicates across rounds
  let staleRounds = 0;
  let lastArticleCount = 0;

  for (let round = 0; round < 500; round++) {
    // Scroll down using real mouse wheel event at center of viewport
    await cdpScroll(tabId, scrollX, scrollY, 1000);
    await wait(800);

    // Quick article count check (fast — no extraction)
    const articleCount = await cdpEval(tabId, `document.querySelectorAll('div[role="article"]').length`);

    if (articleCount === lastArticleCount) {
      staleRounds++;
    } else {
      staleRounds = 0;
      lastArticleCount = articleCount;
    }

    // Extract every 5 rounds OR when stale (about to finish)
    if (round % 5 === 0 || staleRounds >= 3) {
      const result = await cdpEval(tabId, extractJS);
      if (result && result.items) {
        for (const item of result.items) allItems.set(item.id, item);
      }

      // Also click "view more" buttons during extraction rounds
      await cdpEval(tabId, `
        (function() {
          for (const el of document.querySelectorAll('div[role="button"], span[role="button"]')) {
            const t = el.textContent.trim().toLowerCase();
            if (t.length > 80) continue;
            if (t.includes("view more") || t.includes("view previous") || t.includes("more replies") || t.includes("lihat komentar")) {
              el.click();
            }
          }
        })()
      `);

      if (round < 5 || round % 10 === 0) {
        console.log(`[SocyBase CDP] Round ${round}: ${articleCount} articles, ${allItems.size} comments collected`);
      }
    }

    // Stop after 5 stale rounds (5s of no new content)
    if (staleRounds >= 5) {
      // Final extraction to catch anything left
      const result = await cdpEval(tabId, extractJS);
      if (result && result.items) {
        for (const item of result.items) allItems.set(item.id, item);
      }
      console.log(`[SocyBase CDP] Done: ${allItems.size} comments after ${round} rounds`);
      break;
    }
  }

  const items = Array.from(allItems.values());
  console.log(`[SocyBase CDP] Final: ${items.length} comments extracted`);
  return { items, nextUrl: null };
}

// This function is INJECTED into the Facebook tab — must be fully self-contained.
// It accesses the live, JS-rendered DOM.
function extractDataFromRenderedPage(taskType) {
  function extractUserIdFromHref(href) {
    if (!href) return "";
    let m = href.match(/profile\.php\?id=(\d+)/);
    if (m) return m[1];
    m = href.match(/facebook\.com\/(\d+)/);
    if (m) return m[1];
    m = href.match(/^\/(\d+)/);
    if (m) return m[1];
    m = href.match(/facebook\.com\/([^/?#]+)/);
    if (m && !["pages", "groups", "photo", "story", "watch", "reel", "share", "sharer", "login", "help"].includes(m[1]))
      return m[1];
    m = href.match(/^\/([^/?#]+)/);
    if (m && !["story.php", "photo.php", "permalink.php", "groups", "pages"].includes(m[1])) return m[1];
    return "";
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
    }
    return hash;
  }

  const items = [];
  const seenIds = new Set();
  const isMbasic = !!document.querySelector("#root") && !document.querySelector('[class*="_9dls"]');

  console.log(`[SocyBase Tab] Page type: ${isMbasic ? "mbasic" : "desktop"}, URL: ${location.href}`);

  if (taskType === "scrape_comments") {
    let commentDivs = [];

    if (isMbasic) {
      // mbasic selectors
      commentDivs = document.querySelectorAll('[id^="ufi"] > div > div');
      if (!commentDivs.length) commentDivs = document.querySelectorAll('div[data-sigil="comment"]');
      if (!commentDivs.length) commentDivs = document.querySelectorAll("div[id^='comment_']");
      if (!commentDivs.length) commentDivs = document.querySelectorAll("div.ec > div");
      if (!commentDivs.length) commentDivs = document.querySelectorAll("div.dw > div");
      if (!commentDivs.length) commentDivs = document.querySelectorAll("#root div > div > div");
    } else {
      // Desktop Facebook — comments are in role="article" elements.
      // IMPORTANT: articles can be nested (replies inside parent comments),
      // so we only take top-level comment articles (skip the post article and nested ones).
      const allArticles = Array.from(document.querySelectorAll('div[role="article"]'));
      console.log(`[SocyBase Tab] Found ${allArticles.length} article elements`);

      // The first article is the main post; the rest are comments (including nested replies).
      // Filter out nested articles — only keep those whose parent article is the post (first one).
      if (allArticles.length > 1) {
        for (let i = 1; i < allArticles.length; i++) {
          const art = allArticles[i];
          // Check if this article is nested inside another comment article
          const parentArticle = art.parentElement?.closest('div[role="article"]');
          if (!parentArticle || parentArticle === allArticles[0]) {
            // Top-level comment (parent is the post or no parent article)
            commentDivs.push(art);
          }
          // else: it's a nested reply — still include it for commenter extraction
          commentDivs.push(art);
        }
        // Deduplicate (since we push top-level and all)
        commentDivs = [...new Set(commentDivs)];
      }
    }

    console.log(`[SocyBase Tab] Processing ${commentDivs.length} comment candidates`);

    let dbgNoLink = 0, dbgNoName = 0, dbgNoMsg = 0, dbgDupe = 0;

    for (const div of commentDivs) {
      try {
        let name = "";
        let href = "";
        let userId = "";

        if (isMbasic) {
          // mbasic: find the first link with profile-like href
          for (const link of div.querySelectorAll("a")) {
            const h = link.getAttribute("href") || "";
            const t = link.textContent.trim();
            if (
              t && t.length > 1 && t.length < 60 &&
              (h.includes("profile.php") || h.includes("facebook.com/") ||
                (h.startsWith("/") && !h.startsWith("/story") && !h.startsWith("/photo")))
            ) {
              name = t;
              href = h;
              break;
            }
          }
        } else {
          // Desktop Facebook: name link has aria-hidden="false" and role="link"
          // Avatar link has aria-hidden="true" — skip that one.
          // Both links contain comment_id in their href, so we CANNOT filter on that.
          for (const link of div.querySelectorAll('a[role="link"]')) {
            if (link.getAttribute("aria-hidden") === "true") continue; // skip avatar
            if (link.getAttribute("tabindex") === "-1") continue; // skip avatar (alt check)
            const h = link.getAttribute("href") || "";
            const t = link.textContent.trim();
            if (
              t && t.length > 1 && t.length < 80 &&
              (h.includes("profile.php") || h.includes("facebook.com/")) &&
              !h.includes("/photo") && !h.includes("/story")
            ) {
              name = t;
              href = h;
              break;
            }
          }

          // Fallback: parse name from article's aria-label "Comment by {name} {time} ago"
          if (!name) {
            const ariaLabel = div.getAttribute("aria-label") || "";
            const m = ariaLabel.match(/^Comment by (.+?)\s+\d+\s*(h|m|d|w|hr|min|s|hour|minute|day|week|month|year)/i);
            if (m) name = m[1].trim();
            // Still need the href — grab the first non-avatar profile link
            if (name) {
              for (const link of div.querySelectorAll('a[role="link"]')) {
                const h = link.getAttribute("href") || "";
                if ((h.includes("profile.php") || h.includes("facebook.com/")) &&
                    !h.includes("/photo") && !h.includes("/story")) {
                  href = h;
                  break;
                }
              }
            }
          }
        }

        if (!name || name.length < 2) { dbgNoName++; continue; }

        userId = extractUserIdFromHref(href);
        if (!userId) { dbgNoLink++; continue; }

        // Extract comment text
        let message = "";
        if (isMbasic) {
          message = div.textContent.trim();
          if (message.startsWith(name)) message = message.slice(name.length).trim();
          message = message.split(/\n\s*(?:Like|Reply|Comment|Suka|Balas|·)/)[0].trim();
        } else {
          // Desktop: comment text is in div[dir="auto"][style*="text-align:start"]
          const textEl = div.querySelector('div[dir="auto"][style*="text-align:start"]');
          if (textEl) {
            message = textEl.textContent.trim();
          }
          // Fallback: any div[dir="auto"] that isn't the name
          if (!message) {
            const textEls = div.querySelectorAll('div[dir="auto"], span[dir="auto"]');
            const nameLower = name.toLowerCase();
            for (const el of textEls) {
              const t = el.textContent.trim();
              if (!t || t.toLowerCase() === nameLower) continue;
              if (/^(Like|Reply|Haha|Love|Wow|Sad|Angry|Share|Hide|Report|\d+\s*(h|m|d|w|hr|min|s)|Most relevant|Newest|All comments)/i.test(t)) continue;
              if (t.length >= 1) { message = t; break; }
            }
          }
          // Last fallback: strip full text
          if (!message) {
            message = div.textContent.trim();
            if (message.startsWith(name)) message = message.slice(name.length).trim();
            message = message.split(/\n\s*(?:Like|Reply|Haha|Love|Wow|Sad|Angry|·|\d+\s*[hmdw])/i)[0].trim();
          }
        }

        if (!message || message.length < 1) { dbgNoMsg++; continue; }
        message = message.slice(0, 1000);

        const commentId = `ext_${userId}_${(hashCode(message) & 0xffffff).toString(16).padStart(6, "0")}`;
        if (seenIds.has(commentId)) { dbgDupe++; continue; }
        seenIds.add(commentId);

        items.push({
          from: { id: String(userId), name },
          id: commentId,
          message,
          created_time: "",
        });
      } catch {
        continue;
      }
    }
    console.log(`[SocyBase Tab] Extraction stats: ${items.length} extracted, ${dbgNoLink} no-link, ${dbgNoName} no-name, ${dbgNoMsg} no-msg, ${dbgDupe} dupes (from ${commentDivs.length} candidates)`);
  } else {
    // Feed parsing
    let postElements = document.querySelectorAll("article");
    if (!postElements.length) postElements = document.querySelectorAll("[data-ft]");
    if (!postElements.length) postElements = document.querySelectorAll("div.story_body_container");

    for (const el of postElements) {
      try {
        let postId = "";
        let postUrl = "";
        for (const link of el.querySelectorAll("a")) {
          const href = link.getAttribute("href") || "";
          let m = href.match(/story_fbid=(\d+)/);
          if (m) {
            postId = m[1];
            postUrl = href.includes("?") ? `https://www.facebook.com/permalink.php?${href.split("?")[1]}` : "";
            break;
          }
          m = href.match(/\/posts\/(\w+)/);
          if (m) { postId = m[1]; postUrl = `https://www.facebook.com${href}`; break; }
          m = href.match(/(pfbid\w+)/);
          if (m) { postId = m[1]; postUrl = `https://www.facebook.com${href}`; break; }
        }

        if (!postId) {
          const text = el.textContent.trim();
          if (!text || text.length < 10) continue;
          postId = `ext_${(hashCode(text) >>> 0).toString(16).padStart(8, "0")}`;
        }

        if (seenIds.has(postId)) continue;
        seenIds.add(postId);

        let fromName = "";
        let fromId = "";
        const headerLink = el.querySelector("header a, h3 a, strong a, a[href*='profile.php'], a[href*='fref=']");
        if (headerLink) {
          fromName = headerLink.textContent.trim();
          fromId = extractUserIdFromHref(headerLink.getAttribute("href") || "");
        }

        let message = "";
        const pTags = el.querySelectorAll("p");
        if (pTags.length) {
          message = Array.from(pTags).map((p) => p.textContent.trim()).filter(Boolean).join("\n");
        } else {
          message = el.textContent.trim();
          if (fromName && message.startsWith(fromName)) message = message.slice(fromName.length).trim();
        }

        if (!message && !fromName) continue;

        let commentCount = 0, reactionCount = 0, shareCount = 0;
        const footerText = el.textContent;
        let cm = footerText.match(/(\d+)\s*(?:comment|komen)/i);
        if (cm) commentCount = parseInt(cm[1]);
        let rm = footerText.match(/(\d+)\s*(?:reaction|like|suka)/i);
        if (rm) reactionCount = parseInt(rm[1]);
        let sm = footerText.match(/(\d+)\s*(?:share|kongsi)/i);
        if (sm) shareCount = parseInt(sm[1]);

        items.push({
          id: String(postId),
          message: message.slice(0, 2000),
          created_time: "", updated_time: "",
          from: { name: fromName, id: String(fromId) },
          comments: { summary: { total_count: commentCount } },
          reactions: { summary: { total_count: reactionCount } },
          shares: { count: shareCount },
          attachments: { data: [] },
          post_url: postUrl,
        });
      } catch { continue; }
    }
  }

  // Find next page URL (pagination)
  let nextUrl = null;
  const paginationKeywords =
    taskType === "scrape_comments"
      ? ["more comment", "previous comment", "view more", "see more", "komen lagi", "lihat lagi"]
      : ["see more post", "show more", "more stories", "older post", "lagi cerita", "lihat lagi"];

  for (const link of document.querySelectorAll("a")) {
    const text = link.textContent.trim().toLowerCase();
    if (paginationKeywords.some((kw) => text.includes(kw))) {
      const href = link.getAttribute("href");
      if (href) {
        nextUrl = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
        break;
      }
    }
  }

  return { items, nextUrl };
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

  // Wrap the entire task in a timeout
  const taskPromise = (async () => {
    let currentUrl = task.target_url;
    let allItems = [];
    let pagesLoaded = 0;
    const maxPages = task.task_type === "scrape_comments" ? 10 : 4;
    const limit = task.limit || (task.task_type === "scrape_comments" ? 5000 : 10);

    while (pagesLoaded < maxPages && allItems.length < limit) {
      console.log(`[SocyBase] Page ${pagesLoaded + 1}: ${currentUrl}`);

      const { items, nextUrl } = await fetchAndParseViaTab(currentUrl, task.task_type);

      for (const item of items) {
        if (!allItems.some((existing) => existing.id === item.id)) {
          allItems.push(item);
        }
      }

      pagesLoaded++;

      if (allItems.length >= limit) break;
      if (!nextUrl) break;

      currentUrl = nextUrl;

      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
    }

    return allItems.slice(0, limit);
  })();

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Task timed out after 2 minutes")), TASK_TIMEOUT_MS)
  );

  try {
    const allItems = await Promise.race([taskPromise, timeoutPromise]);
    console.log(`[SocyBase] Task ${task.id}: extracted ${allItems.length} items`);

    // Submit results with retry
    await apiPostWithRetry(`/extension/tasks/${task.id}/result`, {
      success: true,
      data: { data: allItems, paging: {} },
    });

    await incrementStat("tasksDone");
    await incrementStat("tasksSuccess");
    broadcastActivity("\u2705", `${task.task_type}: ${allItems.length} items scraped`);
  } catch (e) {
    console.error(`[SocyBase] Task ${task.id} failed:`, e.message);
    // Submit failure with retry — don't lose the error report
    try {
      await apiPostWithRetry(`/extension/tasks/${task.id}/result`, {
        success: false,
        error: e.message,
      });
    } catch (submitErr) {
      console.error(`[SocyBase] Failed to submit error result for task ${task.id}:`, submitErr.message);
    }

    await incrementStat("tasksDone");
    await incrementStat("tasksErrors");
    broadcastActivity("\u274C", `${task.task_type} failed: ${e.message.slice(0, 60)}`);
  }
}

// ── Polling loop ────────────────────────────────────────────────────

async function pollForTasks() {
  if (!(await isConfigured())) return;
  if (processingTask) return; // Skip if already processing

  try {
    const data = await apiGet("/extension/tasks");
    if (data.tasks && data.tasks.length > 0) {
      console.log(`[SocyBase] Found ${data.tasks.length} pending task(s)`);
      processingTask = true;
      try {
        await processTask(data.tasks[0]);
      } finally {
        processingTask = false;
      }
    }
  } catch (e) {
    console.warn("[SocyBase] Poll error:", e.message);
  }
}

function startPolling() {
  if (pollTimer) return; // Already polling — don't restart
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

// ── TOTP (RFC 6238) — pure JS, no dependencies ─────────────────────

function base32Decode(encoded) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  encoded = encoded.replace(/[\s=-]+/g, "").toUpperCase();
  let bits = "";
  for (const ch of encoded) {
    const val = alphabet.indexOf(ch);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

async function generateTOTP(secret, period = 30, digits = 6) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / period);
  // Convert counter to 8-byte big-endian
  const counterBytes = new Uint8Array(8);
  let tmp = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = tmp & 0xff;
    tmp = Math.floor(tmp / 256);
  }
  // HMAC-SHA1
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, counterBytes);
  const hmac = new Uint8Array(sig);
  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % Math.pow(10, digits)).padStart(digits, "0");
}

// ── Login Batch Processor ───────────────────────────────────────────

let loginBatchState = null; // { batchId, accounts, current, total, success, failed, cancelled }

function broadcastLoginProgress() {
  if (!loginBatchState) return;
  const progress = {
    batchId: loginBatchState.batchId,
    current: loginBatchState.current,
    total: loginBatchState.total,
    success: loginBatchState.success,
    failed: loginBatchState.failed,
    status: loginBatchState.cancelled ? "cancelled" :
            loginBatchState.current >= loginBatchState.total ? "completed" : "running",
  };
  // Broadcast to all extension pages (popup, content scripts)
  chrome.runtime.sendMessage({ type: "SOCYBASE_LOGIN_PROGRESS", progress }).catch(() => {});
  // Also broadcast to all tabs with content script
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "SOCYBASE_LOGIN_PROGRESS", progress }).catch(() => {});
    }
  });
}

async function clearFacebookCookies() {
  const domains = [".facebook.com", "facebook.com", "www.facebook.com"];
  for (const domain of domains) {
    const cookies = await chrome.cookies.getAll({ domain });
    for (const cookie of cookies) {
      const protocol = cookie.secure ? "https" : "http";
      await chrome.cookies.remove({
        url: `${protocol}://${domain.replace(/^\./, "")}${cookie.path}`,
        name: cookie.name,
      });
    }
  }
}

async function extractFacebookCookies() {
  const cookies = await chrome.cookies.getAll({ domain: ".facebook.com" });
  const parts = [];
  let fbUserId = null;
  let hasXs = false;
  for (const c of cookies) {
    parts.push(`${c.name}=${c.value}`);
    if (c.name === "c_user") fbUserId = c.value;
    if (c.name === "xs") hasXs = true;
  }
  // Both c_user and xs are required for a valid session
  return { cookieString: parts.join("; "), fbUserId: (fbUserId && hasXs) ? fbUserId : null, hasXs };
}

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeoutMs);
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function waitForNavigation(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      // Resolve anyway — check URL after timeout
      chrome.tabs.get(tabId, (tab) => resolve(tab?.url || ""));
    }, timeoutMs);
    let loadingStarted = false;
    function listener(id, changeInfo) {
      if (id !== tabId) return;
      if (changeInfo.status === "loading") loadingStarted = true;
      if (loadingStarted && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        chrome.tabs.get(tabId, (tab) => resolve(tab?.url || ""));
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function isHomeUrl(url) {
  const stripped = url.replace(/\/+$/, "");
  return (
    stripped === "https://www.facebook.com" ||
    stripped === "https://facebook.com" ||
    stripped === "https://m.facebook.com" ||
    stripped === "https://mbasic.facebook.com" ||
    stripped.endsWith("facebook.com/home.php") ||
    url.includes("facebook.com/?sk=")
  );
}

async function handleFollowUpScreens(tabId) {
  // Click through trust/save/review screens until we get cookies or give up
  for (let i = 0; i < 5; i++) {
    const tabInfo = await chrome.tabs.get(tabId);
    const currentUrl = tabInfo?.url || "";
    console.log(`[SocyBase Login] Follow-up screen ${i + 1}: ${currentUrl}`);

    // Check cookies first
    const cookies = await extractFacebookCookies();
    if (cookies.fbUserId) return { success: true, cookieString: cookies.cookieString, fbUserId: cookies.fbUserId };

    if (isHomeUrl(currentUrl)) {
      // On home but no c_user cookie yet — unlikely but wait a beat
      await new Promise(r => setTimeout(r, 1000));
      const retry = await extractFacebookCookies();
      if (retry.fbUserId) return { success: true, cookieString: retry.cookieString, fbUserId: retry.fbUserId };
      break;
    }

    if (!currentUrl.includes("/checkpoint") && !currentUrl.includes("/two_step") && !currentUrl.includes("/two_factor") && !currentUrl.includes("/auth")) break;

    // Click follow-up button — prefer "always confirm" over "trust this device"
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const buttons = document.querySelectorAll('div[role="button"], button[type="submit"], button, input[type="submit"], a[role="button"]');
        // Pass 1: prefer "always confirm" / "always trust"
        for (const el of buttons) {
          const text = el.textContent?.trim().toLowerCase() || "";
          if (text.includes("always confirm") || text.includes("always trust")) {
            console.log(`[SocyBase Login] Clicking preferred button: "${text}"`);
            el.click(); return;
          }
        }
        // Pass 2: fallback to other action buttons
        const fallback = ["trust", "confirm", "continue", "this was me", "save", "ok", "skip", "not now", "lanjutkan", "next"];
        for (const el of buttons) {
          const text = el.textContent?.trim().toLowerCase() || "";
          if (fallback.some(kw => text.includes(kw)) || el.type === "submit") {
            console.log(`[SocyBase Login] Clicking follow-up button: "${text}"`);
            el.click(); return;
          }
        }
      },
    });
    await waitForNavigation(tabId, 15000);
  }

  // Final cookie check
  const { fbUserId, cookieString } = await extractFacebookCookies();
  if (fbUserId) return { success: true, cookieString, fbUserId };

  const finalTab = await chrome.tabs.get(tabId);
  return { success: false, error: `Follow-up screens not resolved (url=${finalTab?.url || "unknown"})` };
}

async function loginSingleAccount(email, password, totpSecret, tabId, twoFaWaitSeconds = 60) {
  // Fill credentials by typing character-by-character
  const fillResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (em, pw) => {
      const emailField = document.querySelector('input[name="email"]');
      const passField = document.querySelector('input[name="pass"]');
      if (!emailField || !passField) return { error: "Login form not found" };

      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;

      // Type into a field character-by-character with random delays
      async function typeInField(field, value) {
        field.focus();
        setter.call(field, "");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        for (let i = 0; i < value.length; i++) {
          const char = value[i];
          setter.call(field, field.value + char);
          field.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
          await new Promise(r => setTimeout(r, 30 + Math.random() * 50));
        }
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }

      await typeInField(emailField, em);
      await typeInField(passField, pw);

      return { ok: true, emailVal: emailField.value, passLen: passField.value.length };
    },
    args: [email, password],
  });

  const fillRes = fillResult?.[0]?.result;
  if (fillRes?.error) return { success: false, error: fillRes.error };
  console.log(`[SocyBase Login] Form filled: email=${fillRes?.emailVal}, passLen=${fillRes?.passLen}`);

  // Small delay to let React process the state updates
  await new Promise(r => setTimeout(r, 300));

  // Click login button in a separate script execution
  const clickResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // Try specific Facebook login button selectors first
      const specificBtn = document.querySelector(
        'button[data-testid="royal_login_button"], button[name="login"], button#loginbutton'
      );
      if (specificBtn) { specificBtn.click(); return { ok: true, method: "specific" }; }

      // Try role="button" with login text
      for (const el of document.querySelectorAll('div[role="button"], button[type="submit"], input[type="submit"], button')) {
        const text = el.textContent?.trim().toLowerCase() || "";
        if (text === "log in" || text === "log into facebook" || text === "masuk") {
          el.click();
          return { ok: true, method: "text-match", text };
        }
      }

      // Fallback: submit the login form directly
      const form = document.querySelector("#login_form, form[data-testid='royal_login_form']");
      if (form) { form.submit(); return { ok: true, method: "form-submit" }; }

      // Last resort: find any submit button
      const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) { submitBtn.click(); return { ok: true, method: "submit-btn" }; }

      return { error: "Login button not found" };
    },
  });

  const clickRes = clickResult?.[0]?.result;
  if (clickRes?.error) return { success: false, error: clickRes.error };
  console.log(`[SocyBase Login] Button clicked via: ${clickRes?.method}`);

  // Wait for navigation after login
  const resultUrl = await waitForNavigation(tabId, 30000);
  console.log(`[SocyBase Login] Post-login URL: ${resultUrl}`);

  // Check success
  if (isHomeUrl(resultUrl)) {
    const { cookieString, fbUserId } = await extractFacebookCookies();
    if (fbUserId) return { success: true, cookieString, fbUserId };
    return { success: false, error: "Home page reached but no c_user cookie" };
  }

  // Check cookies directly
  const { cookieString, fbUserId } = await extractFacebookCookies();
  if (fbUserId) return { success: true, cookieString, fbUserId };

  // Handle checkpoint pages (trust browser, 2FA, security checks, etc.)
  if (resultUrl.includes("/checkpoint") || resultUrl.includes("/two_step_verification")) {
    // Detect page type
    const trustResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const body = document.body?.innerText?.toLowerCase() || "";
        const is2FA = body.includes("enter the code") || body.includes("authentication code") ||
                      body.includes("approvals_code") || body.includes("two-factor") ||
                      body.includes("verify your identity") || body.includes("masukkan kode");
        const isTrust = body.includes("trust") || body.includes("save browser") ||
                        body.includes("remember browser") || body.includes("this was me") ||
                        body.includes("recognize");
        // For initial detection, include footer text too — the heading may not have loaded yet
        // (the stillChecking loop uses only heading text since footer persists after transition)
        const isSecurityCheck = body.includes("running security checks") ||
                                body.includes("please wait while we verify") ||
                                body.includes("automatically redirected") ||
                                body.includes("combat harmful conduct") ||
                                body.includes("arkose") || body.includes("matchkey");
        // Also check if 2FA input is already visible on the page
        const twoFaSelectors = ['input[name="approvals_code"]', 'input[name="code"]', 'input[type="tel"]',
          'input[autocomplete="one-time-code"]', 'input[inputmode="numeric"]'];
        const has2FAInput = twoFaSelectors.some(sel => document.querySelector(sel));
        return { is2FA: is2FA || has2FAInput, isTrust, isSecurityCheck: isSecurityCheck && !has2FAInput, bodySnippet: body.slice(0, 300) };
      },
    });
    const trustRes = trustResult?.[0]?.result;
    console.log(`[SocyBase Login] Checkpoint: is2FA=${trustRes?.is2FA}, isTrust=${trustRes?.isTrust}, isSecurityCheck=${trustRes?.isSecurityCheck}, body=${trustRes?.bodySnippet?.slice(0, 100)}`);

    // Security check → 2FA pipeline (single unified loop)
    // Footer text detected → keep scanning for 2FA input until timeout
    // Only check login redirect when BOTH heading AND footer are gone (fully left security check page)
    if (trustRes?.isSecurityCheck) {
      const startTime = Date.now();
      const timeoutMs = twoFaWaitSeconds * 1000;
      const elapsed = () => Date.now() - startTime;

      console.log(`[SocyBase Login] Security check detected (footer text). Waiting up to ${twoFaWaitSeconds}s for 2FA input...`);

      while (elapsed() < timeoutMs) {
        await new Promise(r => setTimeout(r, 3000));

        // Check 1: cookies appeared → success
        const cookies = await extractFacebookCookies();
        if (cookies.fbUserId) {
          console.log(`[SocyBase Login] Got cookies during security check wait`);
          return { success: true, cookieString: cookies.cookieString, fbUserId: cookies.fbUserId };
        }

        // Check 2: page state — heading, footer, 2FA input, trust
        const stateResult = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const body = document.body?.innerText?.toLowerCase() || "";
            const hasHeading = body.includes("running security checks") || body.includes("please wait while we verify");
            const hasFooter = body.includes("combat harmful conduct") || body.includes("arkose") || body.includes("matchkey");
            const twoFaSelectors = ['input[name="approvals_code"]', 'input[name="code"]', 'input[type="tel"]',
              'input[autocomplete="one-time-code"]', 'input[inputmode="numeric"]'];
            const has2FAInput = twoFaSelectors.some(sel => document.querySelector(sel));
            const has2FAText = body.includes("enter the code") || body.includes("authentication code") ||
                               body.includes("two-factor") || body.includes("verify your identity") || body.includes("masukkan kode");
            const isTrust = body.includes("trust") || body.includes("save browser") ||
                            body.includes("remember browser") || body.includes("this was me");
            return { hasHeading, hasFooter, has2FAInput, has2FAText, isTrust, bodySnippet: body.slice(0, 200) };
          },
        });
        const st = stateResult?.[0]?.result;
        const secs = Math.round(elapsed() / 1000);
        console.log(`[SocyBase Login] Scan (${secs}s): heading=${st?.hasHeading}, footer=${st?.hasFooter}, 2faInput=${st?.has2FAInput}, 2faText=${st?.has2FAText}`);

        // Check 3: 2FA input found → generate TOTP & fill
        if (st?.has2FAInput || st?.has2FAText) {
          console.log(`[SocyBase Login] 2FA input found at ${secs}s — proceeding to TOTP`);
          if (!totpSecret) return { success: false, error: "2FA required but no TOTP secret provided" };
          return await handle2FA(tabId, totpSecret, twoFaWaitSeconds);
        }

        // Check 4: trust page
        if (st?.isTrust) {
          return await handleFollowUpScreens(tabId);
        }

        // Check 5: still on security check page (heading OR footer present) → keep waiting
        if (st?.hasHeading || st?.hasFooter) {
          continue; // Don't check URL — security check still in progress
        }

        // Check 6: heading AND footer both gone → page has left security check
        // Now check URL to see where we ended up
        const tab = await chrome.tabs.get(tabId);
        const url = tab?.url || "";

        if (isHomeUrl(url)) {
          const c = await extractFacebookCookies();
          if (c.fbUserId) return { success: true, cookieString: c.cookieString, fbUserId: c.fbUserId };
          return { success: false, error: "Home page reached after security check but no c_user cookie" };
        }

        if (url.includes("/login") && !url.includes("/two_step") && !url.includes("/checkpoint")) {
          // Security check failed → redirected back to login page
          // Re-fill credentials on the SAME tab and login again (Facebook often goes straight to 2FA after this)
          console.log(`[SocyBase Login] Security check redirected to login at ${secs}s — re-filling credentials on same tab...`);

          await new Promise(r => setTimeout(r, 1500)); // Wait for login page to render

          // Check if login form exists
          const reLoginResult = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (em, pw) => {
              const emailField = document.querySelector('input[name="email"]');
              const passField = document.querySelector('input[name="pass"]');
              if (!emailField || !passField) return { error: "Login form not found on re-login" };

              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, "value"
              ).set;

              async function typeInField(field, value) {
                field.focus();
                setter.call(field, "");
                field.dispatchEvent(new Event("input", { bubbles: true }));
                for (let i = 0; i < value.length; i++) {
                  const char = value[i];
                  setter.call(field, field.value + char);
                  field.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
                  field.dispatchEvent(new Event("input", { bubbles: true }));
                  field.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
                  await new Promise(r => setTimeout(r, 30 + Math.random() * 50));
                }
                field.dispatchEvent(new Event("change", { bubbles: true }));
              }

              await typeInField(emailField, em);
              await typeInField(passField, pw);
              return { ok: true };
            },
            args: [email, password],
          });

          if (reLoginResult?.[0]?.result?.error) {
            return { success: false, error: reLoginResult[0].result.error };
          }

          // Click login button
          await new Promise(r => setTimeout(r, 300));
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const specificBtn = document.querySelector(
                'button[data-testid="royal_login_button"], button[name="login"], button#loginbutton'
              );
              if (specificBtn) { specificBtn.click(); return; }
              for (const el of document.querySelectorAll('div[role="button"], button[type="submit"], input[type="submit"], button')) {
                const text = el.textContent?.trim().toLowerCase() || "";
                if (text === "log in" || text === "log into facebook" || text === "masuk") {
                  el.click(); return;
                }
              }
              const form = document.querySelector("#login_form, form[data-testid='royal_login_form']");
              if (form) form.submit();
            },
          });

          console.log(`[SocyBase Login] Re-login submitted — waiting for navigation...`);
          const reLoginUrl = await waitForNavigation(tabId, 30000);
          console.log(`[SocyBase Login] Re-login post-nav URL: ${reLoginUrl}`);

          // After re-login, continue the scan loop — should land on 2FA next
          continue;
        }

        // Still on checkpoint/two_step URL but no indicators yet — keep scanning
        console.log(`[SocyBase Login] No indicators at ${secs}s, URL=${url?.slice(0, 80)} — continuing scan...`);
      }

      return { success: false, error: `2FA input not found after security check (waited ${twoFaWaitSeconds}s)` };
    }

    if (trustRes?.isTrust && !trustRes?.is2FA) {
      return await handleFollowUpScreens(tabId);
    }

    // It's a 2FA page
    if (!totpSecret) return { success: false, error: "2FA required but no TOTP secret provided" };
    return await handle2FA(tabId, totpSecret, twoFaWaitSeconds);
  }

  // Check for checkpoint indicators in page content (non-checkpoint URLs)
  const checkpointResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const body = document.body?.textContent?.toLowerCase() || "";
      const trustIndicators = ["always trust", "trust this browser", "save browser", "this was me", "remember browser"];
      const twoFaIndicators = ["approvals_code", "two-factor", "enter the code",
                          "security code", "authentication code", "verify your identity"];
      return { isTrust: trustIndicators.some(ind => body.includes(ind)),
               is2FA: twoFaIndicators.some(ind => body.includes(ind)) };
    },
  });
  const cpRes = checkpointResult?.[0]?.result;
  if (cpRes?.isTrust && !cpRes?.is2FA) {
    return await handleFollowUpScreens(tabId);
  }
  if (cpRes?.is2FA) {
    if (!totpSecret) return { success: false, error: "2FA required but no TOTP secret provided" };
    return await handle2FA(tabId, totpSecret, twoFaWaitSeconds);
  }

  // Still on login page = invalid credentials
  if (resultUrl.includes("/login")) {
    const errorResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        for (const sel of ["#login_error", '[data-testid="login_error"]', ".login_error_box", "._9ay7"]) {
          const el = document.querySelector(sel);
          if (el) return el.textContent.trim().slice(0, 120);
        }
        return "";
      },
    });
    const errorText = errorResult?.[0]?.result || "";
    return { success: false, error: `Invalid credentials${errorText ? ` (${errorText})` : ""}` };
  }

  return { success: false, error: `Unexpected state: url=${resultUrl}` };
}

async function handle2FA(tabId, totpSecret, twoFaWaitSeconds = 60) {
  try {
    console.log(`[SocyBase Login] Entering 2FA flow (wait=${twoFaWaitSeconds}s)`);

    // Wait for initial 2FA page render
    await new Promise(r => setTimeout(r, 2000));

    // Step 0: Quick check — security check handling is done by the caller,
    // but if handle2FA is called directly (non-security-check path), do a quick wait
    const secCheckResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const body = document.body?.innerText?.toLowerCase() || "";
        const hasHeading = body.includes("running security checks") || body.includes("please wait while we verify");
        const twoFaSelectors = ['input[name="approvals_code"]', 'input[name="code"]', 'input[type="tel"]',
          'input[autocomplete="one-time-code"]', 'input[inputmode="numeric"]'];
        const has2FAInput = twoFaSelectors.some(sel => document.querySelector(sel));
        return { hasHeading, has2FAInput };
      },
    });
    const secRes = secCheckResult?.[0]?.result;
    if (secRes?.has2FAInput) {
      console.log(`[SocyBase Login] 2FA input already visible — skipping to code entry`);
    } else if (secRes?.hasHeading) {
      // Rare: handle2FA called while security check heading is still present — wait briefly
      console.log(`[SocyBase Login] Security check heading still present in handle2FA — waiting for it to clear...`);
      for (let wait = 0; wait < 20; wait++) {
        await new Promise(r => setTimeout(r, 3000));
        const cr = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const body = document.body?.innerText?.toLowerCase() || "";
            return { hasHeading: body.includes("running security checks") || body.includes("please wait while we verify") };
          },
        });
        if (!cr?.[0]?.result?.hasHeading) {
          console.log(`[SocyBase Login] Security check heading cleared in handle2FA`);
          await new Promise(r => setTimeout(r, 2000));
          break;
        }
      }
    }

    // Step 1: Handle "Choose a way to confirm" dialog.
    // Facebook shows a selection screen first (Authentication app / Text message).
    // We need to: select "Authentication app" → click "Continue" → wait for code input page.
    for (let navAttempt = 0; navAttempt < 3; navAttempt++) {
      const dialogResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Check if this is the method selection page (has radio buttons or method options)
          const bodyText = document.body?.innerText || "";
          const isSelectionPage = bodyText.includes("Choose a way") || bodyText.includes("confirmation method") ||
                                  bodyText.includes("Pilih cara");

          if (!isSelectionPage) return { isSelectionPage: false };

          // Click "Authentication app" option (it's usually a radio/div)
          let clickedOption = false;
          for (const el of document.querySelectorAll('div[role="radio"], input[type="radio"], div[role="listitem"], div[role="option"], label, div')) {
            const text = el.textContent?.trim().toLowerCase() || "";
            if (text.includes("authentication app") || text.includes("authenticator") ||
                text.includes("aplikasi autentikasi") || text.includes("code generator")) {
              el.click();
              clickedOption = true;
              break;
            }
          }

          // Click "Continue" button
          let clickedContinue = false;
          for (const el of document.querySelectorAll('div[role="button"], button, input[type="submit"]')) {
            const text = el.textContent?.trim().toLowerCase() || "";
            if (text === "continue" || text === "lanjutkan" || text === "next") {
              el.click();
              clickedContinue = true;
              break;
            }
          }

          return { isSelectionPage: true, clickedOption, clickedContinue };
        },
      });

      const dialogRes = dialogResult?.[0]?.result;
      if (dialogRes?.isSelectionPage) {
        console.log(`[SocyBase Login] Selection page detected: clickedOption=${dialogRes.clickedOption}, clickedContinue=${dialogRes.clickedContinue}`);
        // Wait for navigation to code entry page
        await waitForNavigation(tabId, 15000);
        await new Promise(r => setTimeout(r, 2000)); // Extra wait for React
      } else {
        console.log(`[SocyBase Login] Not a selection page, proceeding to code entry`);
        break;
      }
    }

    // Step 2: Now we should be on the code entry page.
    // Generate TOTP code FRESH right before filling — so it won't be stale.
    // Retry based on twoFaWaitSeconds (3s per attempt).
    const maxAttempts = Math.max(5, Math.ceil(twoFaWaitSeconds / 3));
    let fillRes = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        console.log(`[SocyBase Login] 2FA code input scan ${attempt + 1}/${maxAttempts} — waiting 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      }

      // Early exit: check if redirected to login page (credentials rejected)
      const tabInfo = await chrome.tabs.get(tabId);
      const tabUrl = tabInfo?.url || "";
      if (tabUrl.includes("/login") && !tabUrl.includes("/two_step") && !tabUrl.includes("/checkpoint")) {
        const loginBody = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.body?.innerText?.slice(0, 150) || "",
        });
        return { success: false, error: `Login rejected (${loginBody?.[0]?.result?.slice(0, 80) || "redirected to login"})` };
      }

      // Early exit: check if cookies appeared (got logged in)
      const earlyCookies = await extractFacebookCookies();
      if (earlyCookies.fbUserId) {
        return { success: true, cookieString: earlyCookies.cookieString, fbUserId: earlyCookies.fbUserId };
      }

      // Check if there's a code input on the page
      const scanResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const selectors = [
            'input[name="approvals_code"]',
            'input[name="code"]',
            'input[type="tel"]',
            'input[type="number"]',
            'input[autocomplete="one-time-code"]',
            'input[inputmode="numeric"]',
            'input[type="text"][id*="code"]',
            'input[type="text"][name*="code"]',
            'input[type="text"][aria-label*="code" i]',
            'input[type="text"][placeholder*="code" i]',
            'input[type="text"][placeholder*="kode" i]',
          ];

          for (const sel of selectors) {
            if (document.querySelector(sel)) return { found: true, selector: sel };
          }

          // Fallback: any visible text/tel/number input not email/password
          for (const el of document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])')) {
            if (el.offsetParent !== null && !el.name.includes("email") && !el.name.includes("pass")) {
              return { found: true, selector: `fallback: ${el.tagName}[name="${el.name}"][type="${el.type}"][id="${el.id}"]` };
            }
          }

          // Dump DOM for debugging
          const allInputs = Array.from(document.querySelectorAll("input")).map(i =>
            `<input type="${i.type}" name="${i.name}" id="${i.id}" visible=${i.offsetParent !== null}>`
          );
          const allButtons = Array.from(document.querySelectorAll('div[role="button"], button, a[role="button"]')).map(el =>
            `<${el.tagName}>${el.textContent?.trim().slice(0, 40)}</${el.tagName}>`
          );
          const bodyText = document.body?.innerText?.slice(0, 400) || "";
          return { found: false, inputs: allInputs.join(" | "), buttons: allButtons.join(" | "), bodySnippet: bodyText };
        },
      });

      const scanRes = scanResult?.[0]?.result;
      if (scanRes?.found) {
        // Input found! Generate TOTP code from the base32 secret
        const code = await generateTOTP(totpSecret);
        console.log(`[SocyBase Login] Generated TOTP code: ${code} (attempt ${attempt + 1})`);

        const fillResult = await chrome.scripting.executeScript({
          target: { tabId },
          func: async (code) => {
            const selectors = [
              'input[name="approvals_code"]', 'input[name="code"]',
              'input[type="tel"]', 'input[type="number"]',
              'input[autocomplete="one-time-code"]', 'input[inputmode="numeric"]',
              'input[type="text"][id*="code"]', 'input[type="text"][name*="code"]',
              'input[type="text"][aria-label*="code" i]', 'input[type="text"][placeholder*="code" i]',
              'input[type="text"][placeholder*="kode" i]',
            ];

            let input = null;
            let matchedSelector = "";
            for (const sel of selectors) {
              input = document.querySelector(sel);
              if (input) { matchedSelector = sel; break; }
            }
            if (!input) {
              for (const el of document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])')) {
                if (el.offsetParent !== null && !el.name.includes("email") && !el.name.includes("pass")) {
                  input = el; matchedSelector = "fallback"; break;
                }
              }
            }
            if (!input) return { error: "Input disappeared" };

            // Type code character-by-character
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, "value"
            ).set;
            input.focus();
            setter.call(input, "");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            for (let i = 0; i < code.length; i++) {
              const ch = code[i];
              setter.call(input, input.value + ch);
              input.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
              await new Promise(r => setTimeout(r, 30 + Math.random() * 50));
            }
            input.dispatchEvent(new Event("change", { bubbles: true }));

            return { ok: true, selector: matchedSelector, value: input.value };
          },
          args: [code],
        });

        fillRes = fillResult?.[0]?.result;
        if (fillRes?.ok) {
          console.log(`[SocyBase Login] 2FA code filled via: ${fillRes.selector}, value=${fillRes.value}`);
          break;
        }
      } else {
        console.log(`[SocyBase Login] 2FA scan #${attempt + 1}: no input found`);
        console.log(`[SocyBase Login]   Inputs: ${scanRes?.inputs || "(none)"}`);
        console.log(`[SocyBase Login]   Buttons: ${scanRes?.buttons || "(none)"}`);
        console.log(`[SocyBase Login]   Body: ${scanRes?.bodySnippet?.slice(0, 200)}`);

        // Maybe there's still a "Continue" or "Authentication app" button to click
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            // Try clicking authentication app option + continue
            for (const el of document.querySelectorAll('div[role="radio"], div[role="listitem"], label, div')) {
              const text = el.textContent?.trim().toLowerCase() || "";
              if (text.includes("authentication app") || text.includes("authenticator")) {
                el.click(); break;
              }
            }
            // Then click continue
            for (const el of document.querySelectorAll('div[role="button"], button')) {
              const text = el.textContent?.trim().toLowerCase() || "";
              if (text === "continue" || text === "lanjutkan") {
                el.click(); break;
              }
            }
          },
        });
      }
    }

    // If we never found an input
    if (!fillRes?.ok) {
      const errMsg = `2FA input not found after ${maxAttempts} attempts (${twoFaWaitSeconds}s)`;
      console.error(`[SocyBase Login] ${errMsg}`);
      return { success: false, error: errMsg };
    }

    // Step 3: Click submit button
    await new Promise(r => setTimeout(r, 500));

    const clickResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const keywords = ["continue", "submit", "verify", "confirm", "lanjutkan", "kirim", "send", "next"];
        for (const el of document.querySelectorAll('div[role="button"], button[type="submit"], button, input[type="submit"]')) {
          const text = el.textContent?.trim().toLowerCase() || "";
          if (keywords.some(kw => text.includes(kw)) || el.type === "submit") {
            el.click();
            return { ok: true, text };
          }
        }
        const form = document.querySelector("form");
        if (form) { form.submit(); return { ok: true, text: "form-submit" }; }
        return { error: "No submit button found" };
      },
    });

    const clickRes = clickResult?.[0]?.result;
    console.log(`[SocyBase Login] 2FA submit: ${JSON.stringify(clickRes)}`);

    // Step 4: Wait for navigation after 2FA submit
    const url = await waitForNavigation(tabId, 30000);
    console.log(`[SocyBase Login] Post-2FA URL: ${url}`);

    // Check cookies immediately
    const { fbUserId, cookieString } = await extractFacebookCookies();
    if (fbUserId) return { success: true, cookieString, fbUserId };

    // Handle follow-up screens (trust browser, save browser, review login, etc.)
    return await handleFollowUpScreens(tabId);
  } catch (e) {
    return { success: false, error: `2FA error: ${e.message}` };
  }
}

const DESKTOP_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

// ── Proxy helpers ───────────────────────────────────────────────────

function selectProxy(account, proxyPool, index) {
  // Priority 1: Per-row proxy from CSV
  const host = account.proxy_host || "";
  if (host) {
    return {
      host,
      port: account.proxy_port || "",
      username: account.proxy_username || "",
      password: account.proxy_password || "",
    };
  }
  // Priority 2: Round-robin from shared pool
  if (proxyPool && proxyPool.length > 0) {
    return proxyPool[index % proxyPool.length];
  }
  // Priority 3: No proxy
  return null;
}

async function applyProxy(proxy) {
  if (!proxy || !proxy.host) {
    await clearProxy();
    return;
  }
  const scheme = proxy.host.startsWith("socks") ? "socks5" : "http";
  const port = proxy.port || (scheme === "socks5" ? "1080" : "8080");
  const proxyUrl = `${scheme}://${proxy.host}:${port}`;

  console.log(`[SocyBase Login] Setting proxy: ${proxy.host}:${port} (user=${proxy.username || "none"})`);

  await chrome.proxy.settings.set({
    value: {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme,
          host: proxy.host,
          port: parseInt(port, 10),
        },
        bypassList: ["localhost", "127.0.0.1"],
      },
    },
    scope: "regular",
  });

  // Handle proxy auth if credentials are provided
  if (proxy.username) {
    // Remove any previous listener
    if (applyProxy._authListener) {
      chrome.webRequest.onAuthRequired.removeListener(applyProxy._authListener);
    }
    applyProxy._authListener = (details) => {
      if (details.isProxy) {
        return {
          authCredentials: {
            username: proxy.username,
            password: proxy.password || "",
          },
        };
      }
      return {};
    };
    chrome.webRequest.onAuthRequired.addListener(
      applyProxy._authListener,
      { urls: ["<all_urls>"] },
      ["blocking"]
    );
  }
}

async function clearProxy() {
  await chrome.proxy.settings.clear({ scope: "regular" });
  if (applyProxy._authListener) {
    chrome.webRequest.onAuthRequired.removeListener(applyProxy._authListener);
    applyProxy._authListener = null;
  }
  console.log("[SocyBase Login] Proxy cleared");
}

async function processLoginBatch(batchId, twoFaWaitSeconds = 60) {
  console.log(`[SocyBase Login] Starting batch: ${batchId}`);

  // 1. Fetch batch data
  const { apiUrl, authToken } = await getConfig();
  console.log(`[SocyBase Login] Config: apiUrl=${apiUrl ? apiUrl : "(empty)"}, token=${authToken ? "set" : "(empty)"}`);

  let data;
  try {
    data = await apiGet(`/fb-action/login-batch/${batchId}/worker-data`);
  } catch (e) {
    console.error("[SocyBase Login] Failed to fetch batch:", e.message);
    console.error("[SocyBase Login] Full URL would be:", `${apiUrl}/api/v1/fb-action/login-batch/${batchId}/worker-data`);
    return;
  }

  const accounts = data.accounts;
  const proxyPool = data.proxy_pool || [];
  const delaySeconds = data.delay_seconds || 10;
  console.log(`[SocyBase Login] ${accounts.length} accounts, ${proxyPool.length} proxies in pool, delay=${delaySeconds}s`);

  loginBatchState = {
    batchId,
    accounts,
    current: 0,
    total: accounts.length,
    success: 0,
    failed: 0,
    cancelled: false,
  };
  broadcastLoginProgress();

  // 2. Mark batch as running
  try {
    await apiPost(`/fb-action/login-batch/${batchId}/worker-start`, {});
  } catch (e) {
    console.error("[SocyBase Login] Failed to start batch:", e.message);
    loginBatchState = null;
    return;
  }

  // 3. Process each account sequentially
  const ua = DESKTOP_USER_AGENTS[Math.floor(Math.random() * DESKTOP_USER_AGENTS.length)];

  for (let i = 0; i < accounts.length; i++) {
    if (loginBatchState.cancelled) break;

    const account = accounts[i];
    const email = account.email || "";
    const password = account.password || "";
    const totpSecret = account["2fa_secret"] || "";

    // Select proxy for this account
    const proxy = selectProxy(account, proxyPool, i);
    const proxyLabel = proxy ? `${proxy.host}:${proxy.port}` : "direct";
    console.log(`[SocyBase Login] [${i + 1}/${accounts.length}] ${email} (proxy=${proxyLabel})`);

    // Apply proxy before clearing cookies & opening tab
    await applyProxy(proxy);

    // Retry loop — retry login up to 3 times when Arkose/security check causes rejection
    const MAX_LOGIN_ATTEMPTS = 3;
    let result = null;
    let tabUA = ua;
    let tab = null;

    for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
      if (loginBatchState.cancelled) break;

      // Clear cookies before each attempt
      await clearFacebookCookies();

      try {
        tab = await chrome.tabs.create({ url: "https://www.facebook.com/login/", active: false });
        await waitForTabLoad(tab.id);
        await new Promise(r => setTimeout(r, 1500)); // Wait for React to render

        // Click cookie consent if present
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const selectors = '[data-cookiebanner="accept_button"], button[title="Allow all cookies"], button[title="Accept All"]';
            const btn = document.querySelector(selectors);
            if (btn) btn.click();
          },
        });
        await new Promise(r => setTimeout(r, 500));

        // Login
        result = await loginSingleAccount(email, password, totpSecret || null, tab.id, twoFaWaitSeconds);

        // Grab actual user agent from the tab
        try {
          const uaResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => navigator.userAgent,
          });
          if (uaResult?.[0]?.result) tabUA = uaResult[0].result;
        } catch {}

        if (result.success) {
          // Success — no retry needed
          break;
        }

        // Check if this is a retryable error (login page rejection after security check)
        const err = (result.error || "").toLowerCase();
        const isRetryable = err.includes("rejected") || err.includes("security check") ||
                            err.includes("redirected to login") || err.includes("incorrect");
        // Don't retry errors that won't be fixed by retrying (2FA missing, form not found, etc.)
        const isNonRetryable = err.includes("2fa required") || err.includes("totp") ||
                               err.includes("form not found") || err.includes("button not found");

        if (isNonRetryable || !isRetryable || attempt >= MAX_LOGIN_ATTEMPTS) {
          // Final attempt or non-retryable — stop
          console.log(`[SocyBase Login] [${i + 1}/${accounts.length}] Attempt ${attempt}/${MAX_LOGIN_ATTEMPTS} FAILED (no retry): ${email} — ${result.error}`);
          break;
        }

        // Retryable failure — close tab, wait, and try again
        console.log(`[SocyBase Login] [${i + 1}/${accounts.length}] Attempt ${attempt}/${MAX_LOGIN_ATTEMPTS} failed: ${result.error} — retrying in 5s...`);
        try { await chrome.tabs.remove(tab.id); } catch {}
        tab = null;
        await new Promise(r => setTimeout(r, 5000));

      } catch (e) {
        // Exception during this attempt
        console.error(`[SocyBase Login] [${i + 1}/${accounts.length}] Attempt ${attempt}/${MAX_LOGIN_ATTEMPTS} error: ${e.message}`);
        try { if (tab?.id) await chrome.tabs.remove(tab.id); } catch {}
        tab = null;

        if (attempt >= MAX_LOGIN_ATTEMPTS) {
          // Out of retries — report as failed
          result = { success: false, error: e.message };
          break;
        }
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    // Process final result
    if (result?.success) {
      // Wait 15s for Facebook to finish setting all cookies (xs, fr, datr, etc.)
      console.log(`[SocyBase Login] Login successful — waiting 15s for cookies to settle...`);
      await new Promise(r => setTimeout(r, 15000));

      // Re-extract the full cookie jar
      const settled = await extractFacebookCookies();
      if (settled.fbUserId) {
        result.cookieString = settled.cookieString;
        result.fbUserId = settled.fbUserId;
      }

      loginBatchState.success++;
      console.log(`[SocyBase Login] [${i + 1}/${accounts.length}] SUCCESS: ${email} (uid=${result.fbUserId}, cookies=${result.cookieString?.length || 0} chars, proxy=${proxyLabel})`);
    } else {
      loginBatchState.failed++;
      console.log(`[SocyBase Login] [${i + 1}/${accounts.length}] FAILED: ${email} — ${result?.error || "unknown"} (proxy=${proxyLabel})`);
    }

    // Report to server
    try {
      await apiPostWithRetry(`/fb-action/login-batch/${batchId}/worker-result`, {
        email,
        success: result?.success || false,
        cookie_string: result?.cookieString || null,
        fb_user_id: result?.fbUserId || null,
        user_agent: tabUA,
        error: result?.error || null,
        proxy_used: proxy || null,
      });
    } catch (e) {
      console.error(`[SocyBase Login] Failed to report result for ${email}:`, e.message);
    }

    // Cleanup — clear cookies immediately so next account starts clean
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
    await clearFacebookCookies();
    await clearProxy();

    loginBatchState.current = i + 1;
    broadcastLoginProgress();

    // Delay between logins (skip after last)
    if (i < accounts.length - 1 && !loginBatchState.cancelled) {
      await new Promise(r => setTimeout(r, delaySeconds * 1000));
    }
  }

  // 4. Ensure proxy is cleared
  await clearProxy();

  // 5. Mark batch complete
  try {
    await apiPost(`/fb-action/login-batch/${batchId}/worker-complete`, {});
  } catch (e) {
    console.error("[SocyBase Login] Failed to complete batch:", e.message);
  }

  console.log(`[SocyBase Login] Batch done: ${loginBatchState.success} ok, ${loginBatchState.failed} fail`);
  broadcastLoginProgress();
  loginBatchState = null;
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
      sendResponse({
        configured,
        polling: !!pollTimer,
        loginBatch: loginBatchState ? {
          batchId: loginBatchState.batchId,
          current: loginBatchState.current,
          total: loginBatchState.total,
          success: loginBatchState.success,
          failed: loginBatchState.failed,
          status: loginBatchState.cancelled ? "cancelled" :
                  loginBatchState.current >= loginBatchState.total ? "completed" : "running",
        } : null,
      });
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

  if (msg.type === "SOCYBASE_START_LOGIN_BATCH") {
    if (loginBatchState) {
      sendResponse({ success: false, error: "A login batch is already running" });
      return true;
    }
    const { batchId, apiUrl, authToken, twoFaWaitSeconds } = msg;
    const waitSecs = twoFaWaitSeconds || 60;
    // Save credentials if provided (from web app), then start batch
    if (apiUrl && authToken) {
      chrome.storage.local.set({ apiUrl, authToken }, () => {
        console.log("[SocyBase Login] Credentials saved, starting batch");
        sendResponse({ success: true });
        processLoginBatch(batchId, waitSecs);
      });
    } else {
      sendResponse({ success: true });
      processLoginBatch(batchId, waitSecs);
    }
    return true;
  }

  if (msg.type === "SOCYBASE_LOGIN_BATCH_STATUS") {
    sendResponse({
      active: !!loginBatchState,
      progress: loginBatchState ? {
        batchId: loginBatchState.batchId,
        current: loginBatchState.current,
        total: loginBatchState.total,
        success: loginBatchState.success,
        failed: loginBatchState.failed,
      } : null,
    });
    return true;
  }

  if (msg.type === "SOCYBASE_CANCEL_LOGIN_BATCH") {
    if (loginBatchState) {
      loginBatchState.cancelled = true;
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "No active login batch" });
    }
    return true;
  }

  if (msg.type === "SOCYBASE_RESET_LOGIN_BATCH") {
    if (loginBatchState) {
      loginBatchState.cancelled = true;
    }
    loginBatchState = null;
    console.log("[SocyBase Login] Login batch state reset");
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === "SOCYBASE_GET_FB_COOKIES") {
    (async () => {
      try {
        const cookies = await chrome.cookies.getAll({ domain: ".facebook.com" });
        let cUser = null;
        let xs = null;
        for (const c of cookies) {
          if (c.name === "c_user") cUser = c.value;
          if (c.name === "xs") xs = c.value;
        }
        if (cUser && xs) {
          sendResponse({ success: true, c_user: cUser, xs });
        } else {
          sendResponse({ success: false, error: "No active Facebook session found (missing c_user or xs)" });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});

// ── Startup ─────────────────────────────────────────────────────────

chrome.storage.local.get(["apiUrl", "authToken"], (data) => {
  if (data.apiUrl && data.authToken) {
    startPolling();
  }
});
