/**
 * SocyBase Offscreen Document — HTML parsing with DOMParser.
 * Service workers can't use DOMParser, so we do it here.
 */

function extractUserIdFromHref(href) {
  if (!href) return "";
  let m = href.match(/profile\.php\?id=(\d+)/);
  if (m) return m[1];
  m = href.match(/^\/(\d+)/);
  if (m) return m[1];
  m = href.match(/^\/([^/?]+)/);
  if (m) return m[1];
  return "";
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

function parseCommentsFromHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const comments = [];
  const seenIds = new Set();

  let commentDivs = doc.querySelectorAll('[id^="ufi"] > div > div');
  if (!commentDivs.length) commentDivs = doc.querySelectorAll('div[data-sigil="comment"]');
  if (!commentDivs.length) commentDivs = doc.querySelectorAll("div.dw > div");
  if (!commentDivs.length) commentDivs = doc.querySelectorAll("#root div > div > div");

  for (const div of commentDivs) {
    try {
      let profileLink = div.querySelector('a[href*="profile.php"], a[href*="fref="]');
      if (!profileLink) {
        for (const link of div.querySelectorAll("a")) {
          const href = link.getAttribute("href") || "";
          const text = link.textContent.trim();
          if (
            text && text.length > 1 &&
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

      let message = div.textContent.trim();
      if (message.startsWith(name)) {
        message = message.slice(name.length).trim();
      }
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
    } catch { continue; }
  }

  return comments;
}

function parseFeedFromHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const posts = [];
  const seenIds = new Set();

  let postElements = doc.querySelectorAll("article");
  if (!postElements.length) postElements = doc.querySelectorAll("[data-ft]");
  if (!postElements.length) postElements = doc.querySelectorAll("div.story_body_container");
  if (!postElements.length) {
    postElements = doc.querySelectorAll("#structured_composer_async_container ~ div > div > div");
  }

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

      let commentCount = 0, reactionCount = 0, shareCount = 0;
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

  return posts;
}

function findNextPageUrl(html, taskType) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const keywords = taskType === "scrape_comments"
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

// Listen for parse requests from service worker
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PARSE_HTML") {
    const { html, taskType } = msg;
    let items = [];
    if (taskType === "scrape_comments") {
      items = parseCommentsFromHTML(html);
    } else {
      items = parseFeedFromHTML(html);
    }
    const nextUrl = findNextPageUrl(html, taskType);
    sendResponse({ items, nextUrl });
    return true;
  }
});
