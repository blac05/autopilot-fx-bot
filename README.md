# ⚡ AutoPilot FX — Telegram Signal Bot

An AI-powered Telegram bot that monitors 12 major forex pairs in real time, runs multi-indicator technical analysis, sends BUY/SELL alerts straight to your phone, and includes a full paper trading system.

---

## Features

- **12 Major Pairs** — EURUSD, USDCHF, GBPUSD, USDJPY, AUDUSD, USDCAD, NZDUSD, EURJPY, GBPJPY, EURGBP, EURAUD, CHFJPY
- **6 Indicators per pair** — RSI-14, Stochastic RSI, MACD 12/26/9, Bollinger Bands, EMA Cross (20/50), ATR-14
- **AI Deep Analysis** — Claude AI analyzes your indicators and returns a structured signal with reasoning
- **4 Alert Modes** — Real-time change detection (2 min), Quick scan (15 min), Hourly top signal + AI, 4-hour market report
- **Paper Trading** — Full virtual trading with open/close, live P&L, win rate, trade history
- **Session Tracker** — Sydney, Tokyo, London, New York session detection with overlap alerts
- **Real exchange rates** — Frankfurter API (European Central Bank data)

---

## Setup (5 minutes)

### 1. Create your Telegram bot

1. Open Telegram and message `@BotFather`
2. Send `/newbot` and follow the prompts
3. Copy the **bot token** you receive

### 2. Clone and install

```bash
git clone <your-repo>
cd autopilot-fx-bot
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=your_token_from_botfather
ANTHROPIC_API_KEY=your_key_from_console.anthropic.com
PAPER_BALANCE=10000
```

`ANTHROPIC_API_KEY` is optional — the bot works without it, but `/ai` commands and hourly AI alerts won't fire.

### 4. Run

```bash
# Production
npm start

# Development (auto-restart)
npm run dev
```

---

## Commands

| Command | Description |
|---|---|
| `/start` | Start the bot + subscribe to auto-alerts |
| `/scan` | Full scan of all 12 pairs right now |
| `/signal EURUSD` | Detailed signal for one pair |
| `/ai EURUSD` | Full AI deep analysis (requires API key) |
| `/best` | Top 3 highest-confidence setups |
| `/pairs` | All pairs with live price + signal |
| `/sessions` | Active forex sessions + overlap |
| `/report` | 4-hour market overview |
| `/status` | Bot health, uptime, subscribers |
| `/auto` | Toggle auto-alerts on/off |
| `/trade` | Paper trading menu (inline buttons) |
| `/positions` | Open trades + live P&L |
| `/close 123` | Close a trade by ID |
| `/balance` | Portfolio summary |
| `/history` | Last 10 closed trades |

---

## Alert Schedule

| Interval | What happens |
|---|---|
| Every 2 min | Signal change detection — instant alert if direction flips |
| Every 15 min | Fresh data fetch + broadcast if signals changed |
| Every 1 hour | Full scan + AI analysis on strongest signal |
| Every 4 hours | Full market report with top opportunities |

---

## Deployment (keep it running 24/7)

### Option A — PM2 (recommended for a VPS)

```bash
npm install -g pm2
pm2 start bot.js --name autopilot-fx
pm2 save
pm2 startup
```

### Option B — Railway / Render (free tier)

1. Push to a GitHub repo
2. Connect to Railway or Render
3. Set environment variables in the dashboard
4. Deploy — it runs automatically

---

## Data Sources

- **Historical & live rates** — [api.frankfurter.app](https://api.frankfurter.app) (ECB reference rates, free, no key needed)
- **AI analysis** — Anthropic Claude (claude-sonnet-4-6)
- All indicators are computed from scratch in `src/indicators.js`

---

## Disclaimer

This bot is for **educational and paper trading purposes only**. It is not financial advice. Forex trading carries significant risk. Past signals do not guarantee future results.
