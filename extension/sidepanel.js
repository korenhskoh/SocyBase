const connectedView = document.getElementById("connected-view");
const disconnectedView = document.getElementById("disconnected-view");
const apiUrlInput = document.getElementById("api-url");
const authTokenInput = document.getElementById("auth-token");
const btnConnect = document.getElementById("btn-connect");
const btnDisconnect = document.getElementById("btn-disconnect");
const messageEl = document.getElementById("message");

// Stats elements
const statTasks = document.getElementById("stat-tasks");
const statSuccess = document.getElementById("stat-success");
const statErrors = document.getElementById("stat-errors");

// Activity log
const activityLog = document.getElementById("activity-log");
let logEntries = [];

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

function addLogEntry(icon, msg) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  logEntries.unshift({ time, icon, msg });
  if (logEntries.length > 50) logEntries = logEntries.slice(0, 50);
  renderLog();
}

function renderLog() {
  if (logEntries.length === 0) {
    activityLog.innerHTML = `<div class="log-entry" style="color:rgba(255,255,255,0.25);font-style:italic">No activity yet</div>`;
    return;
  }
  activityLog.innerHTML = logEntries
    .map(
      (e) => `<div class="log-entry">
      <span class="log-time">${e.time}</span>
      <span class="log-icon">${e.icon}</span>
      <span class="log-msg">${e.msg}</span>
    </div>`
    )
    .join("");
}

// Load stats from storage
function loadStats() {
  chrome.storage.local.get(["tasksDone", "tasksSuccess", "tasksErrors"], (data) => {
    statTasks.textContent = data.tasksDone || 0;
    statSuccess.textContent = data.tasksSuccess || 0;
    statErrors.textContent = data.tasksErrors || 0;
  });
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

loadStats();

// Connect
btnConnect.addEventListener("click", async () => {
  const apiUrl = apiUrlInput.value.trim().replace(/\/$/, "");
  const authToken = authTokenInput.value.trim();

  if (!apiUrl || !authToken) {
    showMessage("Both API URL and Auth Token are required", true);
    return;
  }

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
        addLogEntry("\u2705", "Connected to SocyBase");
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
      addLogEntry("\u274C", "Disconnected from SocyBase");
    }
  });
});

// Login batch progress
const loginSection = document.getElementById("login-batch-section");
const loginTitle = document.getElementById("login-batch-title");
const loginCounts = document.getElementById("login-batch-counts");
const loginBar = document.getElementById("login-batch-bar");

function updateLoginBatchUI(progress) {
  if (!progress) {
    loginSection.style.display = "none";
    return;
  }
  loginSection.style.display = "block";
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  loginTitle.textContent =
    progress.status === "completed"
      ? "Login Batch Done"
      : progress.status === "cancelled"
        ? "Login Batch Cancelled"
        : `Login Batch (${pct}%)`;
  loginCounts.textContent = `${progress.current}/${progress.total} \u2014 ${progress.success} ok, ${progress.failed} fail`;
  loginBar.style.width = `${pct}%`;
}

// Check on open
chrome.runtime.sendMessage({ type: "SOCYBASE_GET_STATUS" }, (response) => {
  if (response?.loginBatch) {
    updateLoginBatchUI(response.loginBatch);
  }
});

// Reset login batch
document.getElementById("btn-reset-login").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "SOCYBASE_RESET_LOGIN_BATCH" }, (response) => {
    if (response?.success) {
      updateLoginBatchUI(null);
      showMessage("Login batch reset");
      addLogEntry("\u{1F504}", "Login batch reset");
    }
  });
});

// Listen for progress & activity updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SOCYBASE_LOGIN_PROGRESS") {
    updateLoginBatchUI(msg.progress);
  }
  if (msg.type === "SOCYBASE_TASK_ACTIVITY") {
    addLogEntry(msg.icon || "\u2699\uFE0F", msg.message);
    loadStats();
  }
});

// Poll stats periodically while panel is open
setInterval(loadStats, 10000);
