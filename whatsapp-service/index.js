const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const express = require("express");
const QRCode = require("qrcode");
const pino = require("pino");

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();
app.use(express.json());

const AUTH_DIR = process.env.AUTH_DIR || "./auth_state";
const PORT = process.env.PORT || 3001;

let sock = null;
let qrCode = null;
let connectionStatus = "disconnected";

async function startSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
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
      connectionStatus = "disconnected";
      qrCode = null;
      const statusCode =
        lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut;

      logger.warn({ statusCode, shouldReconnect }, "Connection closed");

      if (shouldReconnect) {
        logger.info("Reconnecting in 3 seconds...");
        setTimeout(startSocket, 3000);
      } else {
        logger.error("Logged out. Delete auth_state and re-scan QR.");
      }
    }

    if (connection === "open") {
      connectionStatus = "connected";
      qrCode = null;
      logger.info("WhatsApp connection established");
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

// ── GET /status ─────────────────────────────────────────────
app.get("/status", (req, res) => {
  res.json({ status: connectionStatus });
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`WhatsApp service listening on port ${PORT}`);
  startSocket();
});
