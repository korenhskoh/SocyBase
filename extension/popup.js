const connectedView = document.getElementById("connected-view");
const disconnectedView = document.getElementById("disconnected-view");
const apiUrlInput = document.getElementById("api-url");
const authTokenInput = document.getElementById("auth-token");
const btnConnect = document.getElementById("btn-connect");
const btnDisconnect = document.getElementById("btn-disconnect");
const messageEl = document.getElementById("message");

function showMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.className = `msg ${isError ? "msg-error" : "msg-success"}`;
  messageEl.style.display = "block";
  setTimeout(() => (messageEl.style.display = "none"), 4000);
}

function showConnected() {
  connectedView.style.display = "block";
  disconnectedView.style.display = "none";
}

function showDisconnected() {
  connectedView.style.display = "none";
  disconnectedView.style.display = "block";
}

// Load current state
chrome.storage.local.get(["apiUrl", "authToken"], (data) => {
  if (data.apiUrl && data.authToken) {
    showConnected();
  } else {
    showDisconnected();
  }
  if (data.apiUrl) apiUrlInput.value = data.apiUrl;
});

// Connect
btnConnect.addEventListener("click", async () => {
  const apiUrl = apiUrlInput.value.trim().replace(/\/$/, "");
  const authToken = authTokenInput.value.trim();

  if (!apiUrl || !authToken) {
    showMessage("Both API URL and Auth Token are required", true);
    return;
  }

  // Validate by calling the API
  try {
    const res = await fetch(`${apiUrl}/api/v1/extension/status`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    showMessage(`Connection failed: ${e.message}`, true);
    return;
  }

  chrome.runtime.sendMessage(
    { type: "SOCYBASE_SET_CONFIG", apiUrl, authToken },
    (response) => {
      if (response?.success) {
        showConnected();
        showMessage("Connected successfully!");
      } else {
        showMessage("Failed to save config", true);
      }
    }
  );
});

// Disconnect
btnDisconnect.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "SOCYBASE_DISCONNECT" }, (response) => {
    if (response?.success) {
      showDisconnected();
      authTokenInput.value = "";
      showMessage("Disconnected");
    }
  });
});
