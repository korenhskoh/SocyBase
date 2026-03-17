/**
 * SocyBase Content Script — injected on SocyBase pages.
 *
 * Relays auth credentials from the web app to the extension
 * and announces extension presence to the page.
 */

// Announce extension is installed — repeat to handle React hydration race
function announce() {
  window.postMessage({ type: "SOCYBASE_EXTENSION_INSTALLED", version: "1.0.0" }, "*");
}
announce();
setTimeout(announce, 500);
setTimeout(announce, 1500);

// Listen for messages from the SocyBase web app
window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  // Respond to pings (page can ask "are you there?" at any time)
  if (event.data?.type === "SOCYBASE_EXTENSION_PING") {
    announce();
    return;
  }

  if (event.data?.type === "SOCYBASE_EXTENSION_CONNECT") {
    const { apiUrl, authToken } = event.data;
    if (!apiUrl || !authToken) return;

    chrome.runtime.sendMessage(
      { type: "SOCYBASE_SET_CONFIG", apiUrl, authToken },
      (response) => {
        window.postMessage(
          {
            type: "SOCYBASE_EXTENSION_CONNECTED",
            success: response?.success || false,
          },
          "*"
        );
      }
    );
  }

  if (event.data?.type === "SOCYBASE_EXTENSION_DISCONNECT") {
    chrome.runtime.sendMessage({ type: "SOCYBASE_DISCONNECT" }, (response) => {
      window.postMessage(
        {
          type: "SOCYBASE_EXTENSION_DISCONNECTED",
          success: response?.success || false,
        },
        "*"
      );
    });
  }

  if (event.data?.type === "SOCYBASE_EXTENSION_STATUS") {
    chrome.runtime.sendMessage({ type: "SOCYBASE_GET_STATUS" }, (response) => {
      window.postMessage(
        {
          type: "SOCYBASE_EXTENSION_STATUS_RESPONSE",
          configured: response?.configured || false,
          polling: response?.polling || false,
        },
        "*"
      );
    });
  }

  // Login batch: start via extension
  if (event.data?.type === "SOCYBASE_EXTENSION_START_LOGIN") {
    const { batchId, apiUrl, authToken, twoFaWaitSeconds } = event.data;
    if (!batchId) return;
    chrome.runtime.sendMessage({ type: "SOCYBASE_START_LOGIN_BATCH", batchId, apiUrl, authToken, twoFaWaitSeconds }, (response) => {
      window.postMessage({
        type: "SOCYBASE_EXTENSION_LOGIN_STARTED",
        success: response?.success || false,
        error: response?.error || null,
      }, "*");
    });
  }

  // Get current Facebook cookies from browser
  if (event.data?.type === "SOCYBASE_EXTENSION_GET_COOKIES") {
    chrome.runtime.sendMessage({ type: "SOCYBASE_GET_FB_COOKIES" }, (response) => {
      window.postMessage({
        type: "SOCYBASE_EXTENSION_COOKIES_RESPONSE",
        success: response?.success || false,
        c_user: response?.c_user || null,
        xs: response?.xs || null,
        error: response?.error || null,
      }, "*");
    });
  }

  // Login batch: cancel
  if (event.data?.type === "SOCYBASE_EXTENSION_CANCEL_LOGIN") {
    chrome.runtime.sendMessage({ type: "SOCYBASE_CANCEL_LOGIN_BATCH" }, (response) => {
      window.postMessage({
        type: "SOCYBASE_EXTENSION_LOGIN_CANCELLED",
        success: response?.success || false,
      }, "*");
    });
  }
});

// Listen for login progress from background → forward to page
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SOCYBASE_LOGIN_PROGRESS") {
    window.postMessage({
      type: "SOCYBASE_LOGIN_PROGRESS",
      progress: msg.progress,
    }, "*");
  }
});
