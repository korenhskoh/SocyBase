const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const express = require("express");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();
app.use(express.json());

const AUTH_DIR = process.env.AUTH_DIR || "./auth_state";
const PORT = process.env.PORT || 3001;

let sock = null;
let qrCode = null;
let connectionStatus = "disconnected";
let reconnectAttempts = 0;
let keepAliveInterval = null;
let intentionalDisconnect = false;

const MAX_RECONNECT_ATTEMPTS = 15;
const BASE_RECONNECT_DELAY = 2000; // 2s
const MAX_RECONNECT_DELAY = 60000; // 60s

function getReconnectDelay() {
  // Exponential backoff: 2s, 4s, 8s, 16s, 32s, 60s, 60s...
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY
  );
  return delay;
}

function startKeepAlive() {
  stopKeepAlive();
  // Send a presence update every 25 seconds to keep the connection alive
  keepAliveInterval = setInterval(async () => {
    if (sock && connectionStatus === "connected") {
      try {
        await sock.sendPresenceUpdate("available");
      } catch (err) {
        logger.warn("Keep-alive ping failed, connection may be stale");
      }
    }
  }, 25000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

async function startSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    keepAliveIntervalMs: 30000, // Baileys built-in keep-alive every 30s
    connectTimeoutMs: 60000,    // 60s connection timeout
    retryRequestDelayMs: 2000,  // Retry failed requests after 2s
    markOnlineOnConnect: false,  // Don't auto-mark online (reduces disconnections)
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = qr;
      connectionStatus = "connecting";
      logger.info("New QR code generated - scan to pair");
    }

    if (connection === "close") {
      stopKeepAlive();
      connectionStatus = "disconnected";
      qrCode = null;

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      logger.warn({ statusCode, isLoggedOut, reconnectAttempts }, "Connection closed");

      if (intentionalDisconnect) {
        intentionalDisconnect = false;
        logger.info("Intentional disconnect, not reconnecting");
        return;
      }

      if (isLoggedOut) {
        logger.error("Logged out by WhatsApp. Need to re-scan QR.");
        reconnectAttempts = 0;
        // Clear stale auth and restart to show QR
        try {
          fs.rmSync(path.resolve(AUTH_DIR), { recursive: true, force: true });
          fs.mkdirSync(path.resolve(AUTH_DIR), { recursive: true });
        } catch {}
        setTimeout(startSocket, 3000);
        return;
      }

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = getReconnectDelay();
        reconnectAttempts++;
        logger.info(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        setTimeout(startSocket, delay);
      } else {
        logger.error(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Waiting 5 min before trying again.`);
        reconnectAttempts = 0;
        setTimeout(startSocket, 300000); // Try again after 5 min
      }
    }

    if (connection === "open") {
      connectionStatus = "connected";
      qrCode = null;
      reconnectAttempts = 0; // Reset on successful connection
      logger.info("WhatsApp connection established");
      startKeepAlive();
    }
  });

  // Handle unexpected errors gracefully
  sock.ev.on("CB:call", () => {
    // Ignore incoming calls to prevent disconnection
  });

  process.removeAllListeners("uncaughtException");
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception - attempting recovery");
    if (connectionStatus === "connected") {
      // Don't crash, let the reconnect logic handle it
    }
  });
}

// ── POST /send ──────────────────────────────────────────────
app.post("/send", async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: "Missing 'to' or 'message' field" });
  }

  if (connectionStatus !== "connected" || !sock) {
    return res
      .status(503)
      .json({ error: "WhatsApp not connected", status: connectionStatus });
  }

  const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;

  try {
    await sock.sendMessage(jid, { text: message });
    res.json({ success: true, jid });
  } catch (err) {
    logger.error({ err, jid }, "Failed to send message");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /qr ─────────────────────────────────────────────────
app.get("/qr", async (req, res) => {
  if (connectionStatus === "connected") {
    return res.json({ status: "connected", message: "Already paired" });
  }
  if (!qrCode) {
    return res.json({
      status: connectionStatus,
      message: "No QR code available yet. Wait a moment.",
    });
  }
  try {
    const dataUrl = await QRCode.toDataURL(qrCode);
    res.json({ status: "waiting_for_scan", qr: dataUrl });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate QR image" });
  }
});

// ── POST /disconnect ────────────────────────────────────────
app.post("/disconnect", async (req, res) => {
  intentionalDisconnect = true;
  stopKeepAlive();

  if (!sock) {
    return res.json({ success: true, message: "Already disconnected" });
  }
  try {
    await sock.logout();
  } catch (err) {
    logger.warn({ err }, "Logout call failed, cleaning up anyway");
  }
  // Clear auth state so a fresh QR is generated
  try {
    fs.rmSync(path.resolve(AUTH_DIR), { recursive: true, force: true });
    fs.mkdirSync(path.resolve(AUTH_DIR), { recursive: true });
  } catch (err) {
    logger.warn({ err }, "Failed to clear auth state directory");
  }
  sock = null;
  qrCode = null;
  connectionStatus = "disconnected";
  reconnectAttempts = 0;
  // Restart socket to generate a new QR
  setTimeout(() => {
    intentionalDisconnect = false;
    startSocket();
  }, 1500);
  res.json({ success: true, message: "Disconnected. Scan a new QR to pair." });
});

// ── GET /status ─────────────────────────────────────────────
app.get("/status", (req, res) => {
  res.json({ status: connectionStatus });
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`WhatsApp service listening on port ${PORT}`);
  startSocket();
});
