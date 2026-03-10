/**
 * SocyBase Browser Operator — Service Worker
 *
 * Polls the SocyBase API for pending scrape tasks, fetches Facebook pages
 * using the user's own browser session (cookies + IP), parses the HTML,
 * and submits results back to the API.
 */

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

// ── Tab-based fallback ──────────────────────────────────────────────
// If fetch() gets desktop HTML (JS-rendered), open the page in a real
// browser tab so JavaScript executes and we can extract the rendered DOM.

async function fetchAndParseViaTab(url, taskType) {
  console.log(`[SocyBase] Tab fallback: opening ${url}`);

  const tab = await chrome.tabs.create({ url, active: false });

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

    // Wait for dynamic content to render
    await new Promise((r) => setTimeout(r, 4000));

    // For comment scraping: switch to "All comments", scroll to load all, click "View more"
    if (taskType === "scrape_comments") {
      const expandResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: expandAllComments,
      });
      const r = expandResults?.[0]?.result || {};
      console.log(`[SocyBase] Expanded comments: ${r.articles || 0} articles, ${r.clicks || 0} clicks`);
    }

    // Execute extraction in the tab's DOM context
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDataFromRenderedPage,
      args: [taskType],
    });

    const result = results?.[0]?.result || { items: [], nextUrl: null };
    console.log(`[SocyBase] Tab extraction: ${result.items.length} items, nextUrl=${result.nextUrl}`);
    return result;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// INJECTED into tab — expands all comments by switching to "All comments",
// then scrolling + clicking "View more" until all comments are loaded.
// Must be fully self-contained. Returns { articles, clicks, rounds }.
async function expandAllComments() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. Find the scrollable container — posts open in a modal dialog on desktop FB
  const modal = document.querySelector('div[role="dialog"]');
  const scrollTarget = modal || document.scrollingElement || document.documentElement;
  console.log(`[SocyBase Tab] Scroll target: ${modal ? "modal dialog" : "page body"}`);

  // 2. Scroll down to find the comment filter button, then switch to "All comments"
  //    The filter button is below the post content/video, need to scroll to it first
  const filterKeywords = ["most relevant", "newest first", "all comment", "paling relevan", "terbaru"];
  let filterFound = false;

  for (let scroll = 0; scroll < 15 && !filterFound; scroll++) {
    for (const el of document.querySelectorAll('div[role="button"], span[role="button"]')) {
      const text = el.textContent.trim().toLowerCase();
      if (text.length < 50 && filterKeywords.some((kw) => text.includes(kw))) {
        // Scroll it into view first
        el.scrollIntoView({ behavior: "instant", block: "center" });
        await wait(500);

        console.log(`[SocyBase Tab] Clicking comment filter: "${el.textContent.trim()}"`);
        el.click();
        await wait(1500);

        // Look for "All comments" option in the dropdown menu
        for (const opt of document.querySelectorAll('div[role="menuitem"], div[role="option"], div[role="radio"]')) {
          const optText = opt.textContent.trim().toLowerCase();
          if (optText.includes("all comment") || optText.includes("semua komentar")) {
            console.log(`[SocyBase Tab] Selecting: "${opt.textContent.trim()}"`);
            opt.click();
            await wait(3000); // Wait for comments to reload
            break;
          }
        }
        filterFound = true;
        break;
      }
    }

    if (!filterFound) {
      // Scroll down to find the filter button (it's below the post content)
      scrollTarget.scrollTop += 600;
      await wait(800);
    }
  }

  if (!filterFound) {
    console.log("[SocyBase Tab] Comment filter button not found, proceeding with default");
  }

  // 3. Scroll down + click "View more comments" buttons in a loop
  const moreKeywords = [
    "view more comment", "view previous comment", "view all",
    "see more comment", "see previous comment",
    "lihat komentar lagi", "lihat komentar sebelumnya", "lihat semua",
    "more comments", "previous comments",
    "write a comment", // stop marker — we've reached the end
  ];

  let totalClicks = 0;
  let staleRounds = 0;
  let lastArticleCount = 0;
  const maxRounds = 100; // Up to ~200s for very large threads

  for (let round = 0; round < maxRounds; round++) {
    // Click any "view more comments" / "view previous" buttons
    for (const el of document.querySelectorAll('div[role="button"], span[role="button"]')) {
      const text = el.textContent.trim().toLowerCase();
      if (text.length > 80) continue;
      if (moreKeywords.some((kw) => text.includes(kw)) && !text.includes("write")) {
        el.click();
        totalClicks++;
      }
    }

    // Scroll down within the container
    scrollTarget.scrollTop = scrollTarget.scrollHeight;
    await wait(2000);

    // Check how many comment articles we have now
    const articleCount = document.querySelectorAll('div[role="article"]').length;
    if (articleCount === lastArticleCount) {
      staleRounds++;
      if (staleRounds >= 5) {
        console.log(`[SocyBase Tab] No new comments for 5 rounds, stopping`);
        break;
      }
    } else {
      staleRounds = 0;
    }
    lastArticleCount = articleCount;

    if (round % 10 === 0) {
      console.log(`[SocyBase Tab] Round ${round}: ${articleCount} articles, ${totalClicks} clicks`);
    }
  }

  const finalCount = document.querySelectorAll('div[role="article"]').length;
  console.log(`[SocyBase Tab] Done: ${finalCount} articles, ${totalClicks} clicks, ${staleRounds >= 5 ? "stale-stop" : "max-rounds"}`);
  return { articles: finalCount, clicks: totalClicks };
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

  try {
    let currentUrl = task.target_url;
    let allItems = [];
    let pagesLoaded = 0;
    const maxPages = task.task_type === "scrape_comments" ? 10 : 4;
    const limit = task.limit || (task.task_type === "scrape_comments" ? 100 : 10);

    while (pagesLoaded < maxPages && allItems.length < limit) {
      console.log(`[SocyBase] Page ${pagesLoaded + 1}: ${currentUrl}`);

      // Open the page in a real browser tab — Facebook always serves JS-rendered
      // content to fetch(), so we need the browser to render the page first.
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
