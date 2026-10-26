// WhatsApp Auto-Reply Bot. Uses the incoming message's own conversation ID:
// this avoids guessing IDs and supports WhatsApp's newer @lid identities.
'use strict';

const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const multer = require('multer');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { Client, LocalAuth, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');

const ROOT = __dirname;
// DATA_DIR is /data in Docker and this project folder when run locally.
// Keeping state outside the image prevents a redeploy from logging WhatsApp out.
const DATA_DIR = path.resolve(process.env.DATA_DIR || ROOT);
const PORT = Number(process.env.PORT || 3000);
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MAX_PDF_BYTES = 16 * 1024 * 1024;
const SEND_DELAY_MS = 1200;
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function dashboardAuth(req, res, next) {
  const username = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  // Authentication is opt-in for local development, but required by the
  // deployment guide before the dashboard is exposed to the internet.
  if (!username && !password) return next();
  const supplied = req.headers.authorization || '';
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  if (supplied === expected) return next();
  res.set('WWW-Authenticate', 'Basic realm="WhatsApp bot dashboard"');
  return res.status(401).send('Dashboard authentication required.');
}

const pdfPath = (slot) => path.join(UPLOADS_DIR, `pdf${slot}.pdf`);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const errorText = (error) => error instanceof Error ? error.message : String(error);

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') console.warn('[BOT] Settings could not be read:', errorText(error));
    return {};
  }
}
const saved = loadSettings();
const state = {
  status: 'starting', qrDataUrl: null,
  replyText: typeof saved.replyText === 'string' && saved.replyText.trim()
    ? saved.replyText.trim() : 'Hello! 👋 Thank you for reaching out. Please find the attached documents below.',
  pdf1Name: saved.pdf1Name || (fs.existsSync(pdfPath(1)) ? 'pdf1.pdf' : null),
  pdf2Name: saved.pdf2Name || (fs.existsSync(pdfPath(2)) ? 'pdf2.pdf' : null),
  logs: [], stats: { received: 0, replied: 0, failed: 0 }
};
function saveSettings() {
  const tempFile = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify({ replyText: state.replyText, pdf1Name: state.pdf1Name, pdf2Name: state.pdf2Name }, null, 2));
  fs.renameSync(tempFile, SETTINGS_FILE);
}

const app = express();
const server = http.createServer(app);
const io = socketio(server);
// Intentionally public: external uptime monitors can call this without gaining
// access to the dashboard, WhatsApp state, uploads, or management APIs.
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.use(dashboardAuth);
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(ROOT, 'public')));
const publicState = () => ({ ...state, logs: state.logs.slice(0, 100) });
const broadcast = () => io.emit('state', publicState());
function addLog(entry) { state.logs.unshift(entry); if (state.logs.length > 100) state.logs.pop(); }

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => done(null, UPLOADS_DIR),
    filename: (_req, file, done) => done(null, file.fieldname === 'pdf1' ? 'pdf1.pdf' : 'pdf2.pdf')
  }),
  limits: { fileSize: MAX_PDF_BYTES, files: 2 },
  fileFilter: (_req, file, done) => {
    if ((file.fieldname === 'pdf1' || file.fieldname === 'pdf2') && file.mimetype === 'application/pdf') return done(null, true);
    return done(new Error('Only PDF files can be uploaded.'));
  }
});

const hasRemoteSessionStore = Boolean(process.env.MONGODB_URI);
let mongoReady = Promise.resolve();
let authStrategy;
if (hasRemoteSessionStore) {
  // RemoteAuth allows stateless hosts (such as Render) to restore the linked
  // WhatsApp session from MongoDB after a restart.
  mongoReady = mongoose.connect(process.env.MONGODB_URI);
  authStrategy = new RemoteAuth({
    store: new MongoStore({ mongoose }),
    clientId: process.env.WWEBJS_CLIENT_ID || 'wa-auto-reply-bot',
    dataPath: path.join(DATA_DIR, '.wwebjs_remote'),
    backupSyncIntervalMs: 300000
  });
} else {
  authStrategy = new LocalAuth({ dataPath: path.join(DATA_DIR, '.wwebjs_auth') });
}

const client = new Client({
  authStrategy,
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    // We own SIGINT handling below. Prevent Puppeteer from racing it and
    // emitting misleading taskkill errors during a normal shutdown on Windows.
    handleSIGINT: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  }
});
let clientReady = false;
let stopping = false;
let queue = Promise.resolve();
const handled = new Map();
function enqueue(task) { queue = queue.then(task, task); return queue; }
function isDuplicate(id) {
  const now = Date.now();
  for (const [key, timestamp] of handled) if (now - timestamp > 3600000) handled.delete(key);
  if (handled.has(id)) return true;
  handled.set(id, now);
  return false;
}

client.on('qr', async (qr) => {
  state.status = 'qr'; state.qrDataUrl = await qrcode.toDataURL(qr);
  console.log(`[BOT] Scan the QR code at http://localhost:${PORT}`); broadcast();
});
client.on('authenticated', () => { state.status = 'authenticated'; console.log('[BOT] Authenticated'); broadcast(); });
client.on('ready', () => { clientReady = true; state.status = 'connected'; state.qrDataUrl = null; console.log('[BOT] WhatsApp ready; listening for direct messages.'); broadcast(); });
client.on('remote_session_saved', () => console.log('[BOT] Remote WhatsApp session backup saved.'));
client.on('auth_failure', (message) => { clientReady = false; state.status = 'error'; state.qrDataUrl = null; console.error('[BOT] Authentication failed:', message); broadcast(); });
client.on('disconnected', (reason) => { clientReady = false; state.status = 'disconnected'; state.qrDataUrl = null; console.warn('[BOT] Disconnected:', reason); broadcast(); });

async function sendReply(msg, logEntry) {
  const results = [];
  const send = async (content, label, options = {}) => {
    try {
      // Do not derive @c.us from @lid: Message#reply uses the exact source chat.
      await msg.reply(content, undefined, { ...options, waitUntilMsgSent: true });
      results.push({ label, ok: true }); console.log(`[BOT] ${label} sent`);
    } catch (error) {
      const detail = errorText(error); results.push({ label, ok: false, error: detail }); console.error(`[BOT] ${label} failed:`, detail);
    }
  };
  await send(state.replyText, 'Text');
  for (const slot of [1, 2]) {
    if (!fs.existsSync(pdfPath(slot))) continue;
    await sleep(SEND_DELAY_MS);
    const media = MessageMedia.fromFilePath(pdfPath(slot));
    media.filename = (slot === 1 ? state.pdf1Name : state.pdf2Name) || `document${slot}.pdf`;
    await send(media, `PDF ${slot}`, { sendMediaAsDocument: true });
  }
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    logEntry.error = failures.map((result) => `${result.label}: ${result.error}`).join(' | ').slice(0, 500);
    state.stats.failed++;
  } else { logEntry.replied = true; state.stats.replied++; }
}

client.on('message', (msg) => {
  if (stopping || !clientReady || !msg?.id?.id || msg.fromMe || msg.from === 'status@broadcast') return;
  if (msg.from.endsWith('@g.us') || msg.type === 'e2e_notification' || msg.type === 'notification_template') return;
  if (isDuplicate(msg.id._serialized || msg.id.id)) return;
  state.stats.received++;
  const logEntry = { id: msg.id.id, from: String(msg.from || '').replace(/@(c\.us|lid)$/, ''), body: msg.body ? msg.body.slice(0, 120) : '[media]', time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), replied: false, error: null };
  addLog(logEntry); broadcast();
  enqueue(async () => {
    try { await sendReply(msg, logEntry); }
    catch (error) { logEntry.error = errorText(error); state.stats.failed++; console.error('[BOT] Reply job failed:', logEntry.error); }
    finally { broadcast(); }
  });
});

app.get('/api/state', (_req, res) => res.json(publicState()));
app.post('/api/reply-text', (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'Text cannot be empty.' });
  if (text.length > 4096) return res.status(400).json({ error: 'Text must be 4,096 characters or fewer.' });
  state.replyText = text; saveSettings(); broadcast(); res.json({ ok: true });
});
app.post('/api/upload', upload.fields([{ name: 'pdf1', maxCount: 1 }, { name: 'pdf2', maxCount: 1 }]), (req, res) => {
  if (req.files?.pdf1) state.pdf1Name = path.basename(req.files.pdf1[0].originalname);
  if (req.files?.pdf2) state.pdf2Name = path.basename(req.files.pdf2[0].originalname);
  saveSettings(); broadcast(); res.json({ ok: true, pdf1: state.pdf1Name, pdf2: state.pdf2Name });
});
app.delete('/api/pdf/:slot', (req, res) => {
  const slot = Number(req.params.slot); if (![1, 2].includes(slot)) return res.status(404).json({ error: 'Unknown PDF slot.' });
  if (fs.existsSync(pdfPath(slot))) fs.unlinkSync(pdfPath(slot));
  if (slot === 1) state.pdf1Name = null; else state.pdf2Name = null;
  saveSettings(); broadcast(); res.json({ ok: true });
});
app.post('/api/clear-logs', (_req, res) => { state.logs = []; state.stats = { received: 0, replied: 0, failed: 0 }; broadcast(); res.json({ ok: true }); });
app.post('/api/logout', async (_req, res) => {
  try { await client.logout(); } catch (error) { console.warn('[BOT] Logout warning:', errorText(error)); }
  clientReady = false; state.status = 'disconnected'; state.qrDataUrl = null; broadcast(); res.json({ ok: true });
});
app.use((error, _req, res, _next) => { console.error('[API]', errorText(error)); res.status(400).json({ error: errorText(error) }); });
io.on('connection', (socket) => socket.emit('state', publicState()));

async function shutdown(signal) {
  if (stopping) return; stopping = true; console.log(`[BOT] ${signal} received; shutting down.`);
  try { await client.destroy(); } catch (error) { console.warn('[BOT] Shutdown warning:', errorText(error)); }
  server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT')); process.on('SIGTERM', () => shutdown('SIGTERM'));
server.listen(PORT, () => {
  console.log(`[BOT] Dashboard running at http://localhost:${PORT}`);
  mongoReady
    .then(() => {
      if (hasRemoteSessionStore) console.log('[BOT] Connected to the remote session store.');
      return client.initialize();
    })
    .catch((error) => { state.status = 'error'; console.error('[BOT] Could not initialize WhatsApp:', errorText(error)); broadcast(); });
});
