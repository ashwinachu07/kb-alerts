# 🚌 KSRTC Bus Seat Alert

Get Telegram alerts when seats become available on KSRTC Swift buses.
**Runs free on GitHub Actions** — no local machine needed.

## Setup (5 minutes)

### 1. Create a Telegram Bot
1. Open Telegram → search `@BotFather` → send `/newbot`
2. Follow the steps → copy your **bot token**
3. Search `@userinfobot` → it replies with your **chat ID**

### 2. Push this repo to GitHub
```bash
git init
git add .
git commit -m "ksrtc alert"
git remote add origin https://github.com/YOUR_USERNAME/ksrtc-bus-alerts.git
git push -u origin main
```

### 3. Add secrets & variables in GitHub
Go to your repo → **Settings** → **Secrets and variables** → **Actions**

**Secrets** (click "New repository secret"):
| Name | Value |
|------|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Your chat ID from userinfobot |

**Variables** (click "Variables" tab → "New repository variable"):
| Name | Value | Example |
|------|-------|---------|
| `KSRTC_URL` | Your KSRTC search URL | `https://onlineksrtcswift.com/search?fromCity=2485%7CSultan+Bathery+...` |
| `TIME_FROM` | *(optional)* Start of time window | `08:00` |
| `TIME_TO` | *(optional)* End of time window | `14:00` |

### 4. Done!
It checks every 5 minutes automatically. Change the route anytime by updating the `KSRTC_URL` variable.

To change the check frequency, edit `.github/workflows/monitor.yml` and change the cron schedule.

### Manual trigger
You can also trigger a check manually: go to **Actions** tab → **KSRTC Seat Monitor** → **Run workflow**.
