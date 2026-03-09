/**
 * SocyBase Content Script — injected on SocyBase pages.
 *
 * Relays auth credentials from the web app to the extension
 * and announces extension presence to the page.
 */

// Announce extension is installed
window.postMessage({ type: "SOCYBASE_EXTENSION_INSTALLED", version: "1.0.0" }, "*");

// Listen for connect requests from the SocyBase web app
window.addEventListener("message", (event) => {
  if (event.source !== window) return;

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
});
