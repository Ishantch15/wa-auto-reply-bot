# WhatsApp Auto-Reply Bot 🤖

Auto-replies to every message with a custom text + 2 PDFs.  
Has a clean web dashboard to control everything.

---

## ✅ Requirements
- **Node.js** (v18 or higher) — download from https://nodejs.org  
- A computer that stays ON while the bot runs  
- WhatsApp on your phone (for QR scan)

---

## 🚀 Setup (One Time)

### Step 1 — Open terminal in this folder
- **Windows**: Right-click inside the `wa-bot` folder → "Open in Terminal" (or Powershell)
- **Mac/Linux**: Open Terminal, type `cd path/to/wa-bot`

### Step 2 — Install dependencies
```bash
npm install
```
This downloads all required packages. Takes 2–5 minutes (one time only).

### Step 3 — Start the bot
```bash
npm start
```

### Step 4 — Open Dashboard
Open your browser → http://localhost:3000

### Step 5 — Scan QR
- Open WhatsApp on your phone
- Tap ⋮ (3 dots) → Linked Devices → Link a Device
- Scan the QR code shown on the dashboard

✅ **Bot is now live!** Anyone who messages you will auto-receive your text + PDFs.

---

## 📋 Dashboard Features

| Feature | Description |
|---------|-------------|
| 🔴🟢 Status | Shows if bot is connected or not |
| ✏️ Reply Text | Edit the auto-reply message |
| 📎 PDFs | Upload/remove your 2 PDF files |
| 📊 Stats | Messages received / replied / failed |
| 📋 Message Log | See who messaged + reply status |
| 🔌 Logout | Safely disconnect (scan QR again to reconnect) |

---

## 📁 Folder Structure
```
wa-bot/
  index.js          ← Bot server (don't edit unless you know JS)
  package.json      ← Project config
  public/
    index.html      ← Dashboard UI
  uploads/          ← Your PDFs go here (auto-created)
    pdf1.pdf        ← Saved after you upload from dashboard
    pdf2.pdf
  .wwebjs_auth/     ← WhatsApp session (auto-created, don't delete)
```

---

## ❓ FAQ

**Q: Is this an official WhatsApp integration?**  
A: No. This project automates WhatsApp Web through a third-party library, so WhatsApp Web changes can affect it and its use may not comply with WhatsApp's terms. For a business-critical workflow, use Meta's official WhatsApp Business Platform instead.

**Q: Phone needs to stay connected?**  
A: WhatsApp linked devices can work while the phone is temporarily offline, but WhatsApp can require the primary phone to reconnect periodically. Do not rely on it remaining linked indefinitely with the phone switched off.

**Q: How to stop the bot?**  
A: Press `Ctrl + C` in the terminal.

**Q: How to run it automatically on PC startup?**  
A: Use PM2: `npm install -g pm2` → `pm2 start index.js` → `pm2 startup`

**Q: Session stays saved after restart?**  
A: Yes! The `.wwebjs_auth` folder saves your session. No re-scan needed unless you logout.

---

## 🔧 Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm: command not found` | Install Node.js from nodejs.org |
| QR keeps reappearing | Keep phone connected to internet |
| PDF not sending | Restart the bot after updating, then test from a separate account. The bot replies through the original conversation to support newer `@lid` WhatsApp identities. |
| Port 3000 in use | Edit `PORT` in index.js to 3001 |
| Bot stops after closing terminal | Use PM2 or keep terminal open |

### Media-send compatibility patch

The project applies a small compatibility patch automatically after `npm install`.
It addresses a known `whatsapp-web.js`/WhatsApp Web regression where text sends
but PDFs and other media fail with `Data passed to getter must include an id property`.
Run `npm run patch:whatsapp` if you reinstall dependencies and still see that error.

---

## ☁️ Deploy free on Oracle Cloud Always Free

This project includes a Docker deployment designed for an Oracle Always Free Ubuntu VM. It preserves the WhatsApp login and PDFs in `data/`, restarts after a VM reboot, and keeps the dashboard private behind an SSH tunnel.

> **Important:** This is an unofficial WhatsApp Web automation. WhatsApp may log out or restrict the account at any time. Do not use it for spam or unsolicited messages.

### 1. Create the VM in Oracle Cloud

1. In the Oracle Cloud Console, create an **Always Free** `VM.Standard.A1.Flex` instance in your home region with **Ubuntu 24.04**. The free allocation is up to **2 OCPUs and 12 GB RAM** in total; this bot only needs a small fraction.
2. Create or upload an SSH key. Keep the private key safe.
3. Add an Oracle Network Security Group rule allowing **TCP 22** only from your current public IP address. Do **not** open port 3000; the dashboard will use an SSH tunnel.

Oracle documents the Always Free allowance and notes that capacity can be temporarily unavailable in some regions: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

### 2. Install Docker on the VM

Replace `PUBLIC_IP` with the VM public IP address. From your computer:

```bash
ssh -i ~/.ssh/oracle.key ubuntu@PUBLIC_IP
```

On the VM, run:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

Connect again after this command so the Docker group takes effect.

### 3. Upload and start the bot

Upload this `wa-bot` folder to `~/wa-bot` on the VM (a private GitHub repository or `scp -r` both work). On the VM:

```bash
cd ~/wa-bot
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs -f
```

Set a private username and a long, unique password in `.env`. Do not commit that file. The first log output will say the bot is waiting for a QR scan.

### 4. Open the private dashboard and scan the QR

On your own computer, create a tunnel and leave that terminal open:

```bash
ssh -i ~/.ssh/oracle.key -L 3000:localhost:3000 ubuntu@PUBLIC_IP
```

Then open `http://localhost:3000`, enter the dashboard credentials from `.env`, and scan the QR using WhatsApp's **Linked devices** screen. Once the dashboard says connected, you can close the tunnel and turn off your computer—the VM continues running.

### Useful server commands

```bash
cd ~/wa-bot
docker compose logs -f       # live logs
docker compose restart       # restart safely
docker compose ps            # confirm it is running
docker compose down          # stop it; the data/ folder stays intact
```

Never delete `data/.wwebjs_auth` unless you want to log the cloud bot out and scan a new QR code.

### Render free-tier note

The public `GET /health` endpoint returns only `{ "ok": true }` and can be used by an external uptime monitor. It does not reveal bot data. On Render's free tier, a monitor request every five minutes may prevent idle spin-down.

Render Free has no persistent disk. To restore the WhatsApp session after a restart, add a `MONGODB_URI` service variable pointing to your MongoDB database. The bot then uses `RemoteAuth` to back up the session every five minutes and reload it automatically after a restart. After scanning the first QR code, keep the service running until the log prints `Remote WhatsApp session backup saved.` before testing a restart. WhatsApp can still invalidate linked devices, so no host can guarantee a login forever.
