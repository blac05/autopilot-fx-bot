'use strict';

require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const cron                 = require('node-cron');

const { PAIRS, fetchAllPairsData, fetchLatestPrice } = require('./src/market');
const { computeSignal }                               = require('./src/signals');
const { getActiveSessions, getMarketOverlap }         = require('./src/sessions');
const { runDeepAnalysis, formatAIAnalysis }            = require('./src/ai');
const {
  formatSignalAlert,
  formatScanReport,
  formatMarketReport,
  formatBalance,
  fp,
} = require('./src/formatter');

// ─────────────────────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  marketData:   {},          // symbol -> { closes, latest, pip, decimals, ... }
  lastSignals:  {},          // symbol -> 'BUY' | 'SELL' | 'WAIT'
  lastFetch:    null,
  autoMode:     true,
  subscribers:  new Set(),   // chatIds receiving auto-alerts
  scanning:     false,

  // Paper trading
  balance:      parseFloat(process.env.PAPER_BALANCE ?? 10000),
  openTrades:   [],
  closedTrades: [],
};

// ─────────────────────────────────────────────────────────────────────────────
//  BOT INIT
// ─────────────────────────────────────────────────────────────────────────────

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌  TELEGRAM_BOT_TOKEN is not set in .env');
  process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const utcHour = () => new Date().getUTCHours();

/** Fetch all pairs and store in state */
async function refreshData() {
  console.log('[data] Refreshing market data…');
  const data = await fetchAllPairsData(65);
  for (const [sym, d] of Object.entries(data)) state.marketData[sym] = d;
  state.lastFetch = new Date();
  console.log(`[data] Done — ${Object.keys(state.marketData).length} pairs loaded`);
  return Object.keys(state.marketData).length;
}

/** Run computeSignal on a stored pair */
function signalFor(symbol) {
  const d = state.marketData[symbol];
  if (!d?.closes?.length) return null;
  return computeSignal(d.closes, d.latest);
}

/** Compute signals for every loaded pair */
function allSignals() {
  const out = {};
  for (const [sym, d] of Object.entries(state.marketData)) {
    const sig = computeSignal(d.closes, d.latest);
    if (sig) out[sym] = { ...d, signal: sig };
  }
  return out;
}

/** Send message to every subscriber, prune blocked chats */
async function broadcast(text) {
  for (const chatId of state.subscribers) {
    try {
      await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (e) {
      if (e.code === 403) {
        console.log(`[broadcast] Removed blocked chat ${chatId}`);
        state.subscribers.delete(chatId);
      }
    }
  }
}

/** Deliver a full signal + optionally AI to a specific context */
async function sendSignalToCtx(ctx, symbol, withAI = false) {
  const d = state.marketData[symbol];
  if (!d) return ctx.reply(`❌ No data for <code>${symbol}</code>. Run /scan first.`, { parse_mode: 'HTML' });

  const sig      = computeSignal(d.closes, d.latest);
  const sessions = getActiveSessions(utcHour());
  await ctx.reply(formatSignalAlert(d, sig, sessions), { parse_mode: 'HTML' });

  if (withAI && sig.signal !== 'WAIT' && sig.confidence >= 60) {
    try {
      const thinking = await ctx.reply('🤖 Running AI deep analysis…', { parse_mode: 'HTML' });
      const ai       = await runDeepAnalysis(d, sig, sessions);
      await ctx.reply(formatAIAnalysis(ai, symbol), { parse_mode: 'HTML' });
      await bot.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});
    } catch (e) {
      console.error('[ai]', e.message);
      await ctx.reply('⚠️ AI analysis unavailable right now.', { parse_mode: 'HTML' });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PAPER TRADING
// ─────────────────────────────────────────────────────────────────────────────

function openTrade(symbol, dir, size = 1000) {
  const d = state.marketData[symbol];
  if (!d?.latest) return null;
  const spread = (d.pip ?? 0.0001) * 1.2;
  const entry  = dir === 'BUY' ? d.latest + spread : d.latest - spread;
  const trade  = { id: Date.now(), symbol, dir, entry, cp: entry, size, pnl: 0, openTime: new Date().toISOString() };
  state.openTrades.push(trade);
  return trade;
}

function updateOpenPnL() {
  for (const t of state.openTrades) {
    const d = state.marketData[t.symbol];
    if (!d?.latest) continue;
    const pips = t.dir === 'BUY' ? d.latest - t.entry : t.entry - d.latest;
    t.pnl = Math.round(pips * t.size * 10000 * 100) / 100;
    t.cp  = d.latest;
  }
}

function closeTrade(id) {
  const idx = state.openTrades.findIndex(t => t.id === id);
  if (idx === -1) return null;
  updateOpenPnL();
  const [trade]     = state.openTrades.splice(idx, 1);
  trade.exitPrice   = trade.cp;
  trade.closeTime   = new Date().toISOString();
  state.balance    += trade.pnl;
  state.closedTrades.unshift(trade);
  if (state.closedTrades.length > 100) state.closedTrades.pop();
  return trade;
}

// ─────────────────────────────────────────────────────────────────────────────
//  AUTO SCAN (called by cron + /scan)
// ─────────────────────────────────────────────────────────────────────────────

async function runAutoScan(broadcast_changes = false) {
  if (state.scanning) return;
  state.scanning = true;
  try {
    await refreshData();
    const sigs    = allSignals();
    const changed = [];

    for (const [sym, d] of Object.entries(sigs)) {
      const newSig = d.signal.signal;
      const oldSig = state.lastSignals[sym];
      state.lastSignals[sym] = newSig;
      if (newSig !== 'WAIT' && newSig !== oldSig) {
        changed.push({ symbol: sym, data: d, sig: d.signal });
      }
    }

    if (broadcast_changes && state.subscribers.size > 0 && changed.length > 0) {
      for (const { symbol, data, sig } of changed) {
        const sessions = getActiveSessions(utcHour());
        const msg      = formatSignalAlert(data, sig, sessions, '🚨 <b>SIGNAL CHANGE</b>\n\n');
        await broadcast(msg);

        // Auto AI on high-confidence signal changes
        if (sig.confidence >= 70 && process.env.ANTHROPIC_API_KEY) {
          try {
            const ai = await runDeepAnalysis(data, sig, sessions);
            await broadcast(formatAIAnalysis(ai, symbol));
          } catch (_) {}
        }

        await new Promise(r => setTimeout(r, 600)); // avoid Telegram rate limits
      }
    }

    return { sigs, changed };
  } finally {
    state.scanning = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMMANDS
// ─────────────────────────────────────────────────────────────────────────────

// /start ─────────────────────────────────────────────────────────────────────
bot.start(async ctx => {
  state.subscribers.add(ctx.chat.id);

  await ctx.reply(
    `<b>⚡ AutoPilot FX Bot is Online</b>

Your AI-powered Telegram forex signal bot.
Covering <b>${PAIRS.length} major pairs</b> with real technical analysis + Claude AI.

<b>🚀 Quick Start</b>
/scan — Full market scan right now
/best — Top 3 highest-confidence setups
/pairs — All pairs + live prices
/auto — Toggle auto-alerts (currently ON)
/help — Full command list

Auto-alerts are <b>ON</b> — you'll get notified every time a signal changes.`,
    { parse_mode: 'HTML' }
  );

  if (Object.keys(state.marketData).length === 0) {
    const loading = await ctx.reply('📡 Loading market data for the first time…');
    await refreshData();
    await bot.telegram.deleteMessage(ctx.chat.id, loading.message_id).catch(() => {});
    await ctx.reply('✅ Ready. All pairs loaded.', { parse_mode: 'HTML' });
  }
});

// /help ───────────────────────────────────────────────────────────────────────
bot.help(ctx => ctx.reply(
  `<b>📋 AutoPilot FX — Command Reference</b>

<b>📊 Signals</b>
/scan — Full scan of all 12 pairs
/signal EURUSD — Signal for one pair
/ai EURUSD — Full AI deep analysis
/best — Top 3 opportunities

<b>📈 Market Info</b>
/pairs — All pairs + live prices + signal
/sessions — Active market sessions
/report — 4-hour market overview
/status — Bot health + uptime

<b>💼 Paper Trading</b>
/trade — Open trade menu (inline buttons)
/positions — View open trades + live P&L
/close 123 — Close trade by ID
/history — Last 10 closed trades
/balance — Portfolio summary

<b>⚙️ Alerts & Settings</b>
/auto — Toggle auto-alerts on/off
/help — This message

<b>Tracked Pairs:</b>
EURUSD · USDCHF · GBPUSD · USDJPY
AUDUSD · USDCAD · NZDUSD · EURJPY
GBPJPY · EURGBP · EURAUD · CHFJPY`,
  { parse_mode: 'HTML' }
));

// /scan ───────────────────────────────────────────────────────────────────────
bot.command('scan', async ctx => {
  const loading = await ctx.reply('🔍 Scanning all 12 pairs…');
  try {
    const { sigs } = await runAutoScan(false);
    const sessions = getActiveSessions(utcHour());
    await bot.telegram.editMessageText(
      ctx.chat.id, loading.message_id, null,
      formatScanReport(sigs, sessions),
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    console.error('[scan]', e.message);
    await ctx.reply('❌ Scan failed — check logs.', { parse_mode: 'HTML' });
  }
});

// /signal ─────────────────────────────────────────────────────────────────────
bot.command('signal', async ctx => {
  const arg    = ctx.message.text.split(' ')[1];
  const symbol = arg?.toUpperCase().replace('/', '');

  if (!symbol) {
    const sigs     = allSignals();
    const sessions = getActiveSessions(utcHour());
    return ctx.reply(formatScanReport(sigs, sessions), { parse_mode: 'HTML' });
  }

  const pair = PAIRS.find(p => p.symbol === symbol);
  if (!pair) {
    return ctx.reply(`❌ Unknown pair <code>${symbol}</code>.\nUse /pairs to see available pairs.`, { parse_mode: 'HTML' });
  }

  if (!state.marketData[symbol]) await refreshData();
  await sendSignalToCtx(ctx, symbol, false);
});

// /ai ─────────────────────────────────────────────────────────────────────────
bot.command('ai', async ctx => {
  const arg    = ctx.message.text.split(' ')[1];
  const symbol = arg?.toUpperCase().replace('/', '') || 'EURUSD';
  if (!state.marketData[symbol]) await refreshData();
  await sendSignalToCtx(ctx, symbol, true);
});

// /best ───────────────────────────────────────────────────────────────────────
bot.command('best', async ctx => {
  if (!Object.keys(state.marketData).length) await refreshData();
  const sigs     = allSignals();
  const sessions = getActiveSessions(utcHour());
  const top = Object.entries(sigs)
    .filter(([, d]) => d.signal.signal !== 'WAIT')
    .sort((a, b) => b[1].signal.confidence - a[1].signal.confidence)
    .slice(0, 3);

  if (!top.length) {
    return ctx.reply('🟡 No strong signals at this time — market may be consolidating.', { parse_mode: 'HTML' });
  }

  await ctx.reply(`<b>🏆 Top ${top.length} Setups Right Now</b>`, { parse_mode: 'HTML' });
  for (const [sym, d] of top) {
    await ctx.reply(formatSignalAlert(d, d.signal, sessions), { parse_mode: 'HTML' });
    await new Promise(r => setTimeout(r, 300));
  }
});

// /pairs ──────────────────────────────────────────────────────────────────────
bot.command('pairs', async ctx => {
  if (!Object.keys(state.marketData).length) await refreshData();
  let msg = '<b>📋 All Tracked Pairs</b>\n\n';
  for (const pair of PAIRS) {
    const d   = state.marketData[pair.symbol];
    const sig = d ? computeSignal(d.closes, d.latest) : null;
    const e   = sig?.signal === 'BUY' ? '🟢' : sig?.signal === 'SELL' ? '🔴' : '🟡';
    msg += `${e} <code>${pair.symbol.padEnd(7)}</code>  ${fp(d?.latest, pair.decimals).padStart(9)}  ${sig?.signal ?? 'WAIT'}  (${sig?.confidence ?? '—'}%)\n`;
  }
  msg += '\n<i>/signal [PAIR] for full breakdown</i>';
  await ctx.reply(msg, { parse_mode: 'HTML' });
});

// /sessions ───────────────────────────────────────────────────────────────────
bot.command('sessions', async ctx => {
  const h       = utcHour();
  const active  = getActiveSessions(h);
  const overlap = getMarketOverlap(h);

  const SESSION_DEFS = [
    { name: 'Sydney',   emoji: '🦘', open: 22, close:  7 },
    { name: 'Tokyo',    emoji: '🗾', open:  0, close:  9 },
    { name: 'London',   emoji: '🇬🇧', open:  8, close: 17 },
    { name: 'New York', emoji: '🗽', open: 13, close: 22 },
  ];

  let msg = `<b>🌍 Market Sessions</b>
<code>${new Date().toUTCString()}</code>

`;
  for (const s of SESSION_DEFS) {
    const live = active.find(a => a.name === s.name);
    msg += `${live ? '🟢' : '⚫'} <b>${s.emoji} ${s.name}</b>  ${String(s.open).padStart(2,'0')}:00 – ${String(s.close).padStart(2,'0')}:00 UTC${live ? '  <b>● LIVE</b>' : ''}\n`;
  }

  if (overlap) msg += `\n🔥 <b>${overlap}</b>`;
  msg += `\n\n<i>Current UTC: ${String(h).padStart(2,'0')}:00</i>`;
  await ctx.reply(msg, { parse_mode: 'HTML' });
});

// /report ─────────────────────────────────────────────────────────────────────
bot.command('report', async ctx => {
  if (!Object.keys(state.marketData).length) await refreshData();
  const sigs     = allSignals();
  const sessions = getActiveSessions(utcHour());
  await ctx.reply(formatMarketReport(sigs, sessions), { parse_mode: 'HTML' });
});

// /status ─────────────────────────────────────────────────────────────────────
bot.command('status', async ctx => {
  const up  = process.uptime();
  const hrs = Math.floor(up / 3600);
  const min = Math.floor((up % 3600) / 60);
  const loaded  = Object.keys(state.marketData).length;
  const last    = state.lastFetch ? state.lastFetch.toUTCString() : 'Never';
  const sessions = getActiveSessions(utcHour());
  const sessionLine = sessions.length ? sessions.map(s => `${s.emoji} ${s.name}`).join(', ') : 'None active';

  await ctx.reply(
    `<b>⚡ AutoPilot FX — Bot Status</b>

🟢 <b>Online</b>  |  Uptime: ${hrs}h ${min}m
📡 Pairs loaded:  <code>${loaded} / ${PAIRS.length}</code>
🕐 Last fetch:    <code>${last}</code>
🤖 Auto-alerts:   <code>${state.autoMode ? 'ON' : 'OFF'}</code>
👥 Subscribers:   <code>${state.subscribers.size}</code>
🌍 Sessions:      ${sessionLine}
💼 Open trades:   <code>${state.openTrades.length}</code>
📊 Closed trades: <code>${state.closedTrades.length}</code>

<b>⏰ Scheduled Jobs</b>
┣ Signal change check:  every 2 min
┣ Quick scan + alerts:  every 15 min
┣ Full scan + AI alert: every 1 hour
┗ Market report:        every 4 hours`,
    { parse_mode: 'HTML' }
  );
});

// /auto ───────────────────────────────────────────────────────────────────────
bot.command('auto', async ctx => {
  state.autoMode = !state.autoMode;
  if (state.autoMode) {
    state.subscribers.add(ctx.chat.id);
    await ctx.reply('🟢 <b>Auto-alerts ENABLED</b>\nYou will be notified on every signal change.', { parse_mode: 'HTML' });
  } else {
    state.subscribers.delete(ctx.chat.id);
    await ctx.reply('🔴 <b>Auto-alerts DISABLED</b>\nUse /auto again to re-enable.', { parse_mode: 'HTML' });
  }
});

// /trade ──────────────────────────────────────────────────────────────────────
bot.command('trade', async ctx => {
  const keyboard = Markup.inlineKeyboard([
    [ Markup.button.callback('🟢 BUY EURUSD',  'buy_EURUSD'),  Markup.button.callback('🔴 SELL EURUSD',  'sell_EURUSD')  ],
    [ Markup.button.callback('🟢 BUY GBPUSD',  'buy_GBPUSD'),  Markup.button.callback('🔴 SELL GBPUSD',  'sell_GBPUSD')  ],
    [ Markup.button.callback('🟢 BUY USDJPY',  'buy_USDJPY'),  Markup.button.callback('🔴 SELL USDJPY',  'sell_USDJPY')  ],
    [ Markup.button.callback('🟢 BUY USDCHF',  'buy_USDCHF'),  Markup.button.callback('🔴 SELL USDCHF',  'sell_USDCHF')  ],
    [ Markup.button.callback('🟢 BUY AUDUSD',  'buy_AUDUSD'),  Markup.button.callback('🔴 SELL AUDUSD',  'sell_AUDUSD')  ],
    [ Markup.button.callback('🟢 BUY EURAUD',  'buy_EURAUD'),  Markup.button.callback('🔴 SELL EURAUD',  'sell_EURAUD')  ],
    [ Markup.button.callback('📋 Positions', 'show_positions'), Markup.button.callback('💰 Balance', 'show_balance')  ],
  ]);
  await ctx.reply('<b>💼 Paper Trading</b>\nChoose a pair and direction:', { parse_mode: 'HTML', ...keyboard });
});

// Trade button callbacks
bot.action(/^(buy|sell)_(\w+)$/, async ctx => {
  const dir    = ctx.match[1].toUpperCase();
  const symbol = ctx.match[2];

  if (!state.marketData[symbol]) {
    return ctx.answerCbQuery('❌ No data for this pair — run /scan first');
  }

  const trade = openTrade(symbol, dir, 1000);
  if (!trade) return ctx.answerCbQuery('❌ Trade open failed');

  await ctx.answerCbQuery(`✅ ${dir} ${symbol} opened`);
  const d = state.marketData[symbol];
  await ctx.reply(
    `<b>✅ Paper Trade Opened</b>

${dir === 'BUY' ? '🟢 BUY' : '🔴 SELL'} <code>${symbol}</code>
Entry:    <code>${fp(trade.entry, d.decimals)}</code>
Size:     1,000 units
Trade ID: <code>${trade.id}</code>

Use /positions to monitor  |  /close ${trade.id} to exit`,
    { parse_mode: 'HTML' }
  );
});

bot.action('show_positions', async ctx => { await ctx.answerCbQuery(); await showPositions(ctx); });
bot.action('show_balance',   async ctx => { await ctx.answerCbQuery(); await showBalance(ctx); });

// /positions ──────────────────────────────────────────────────────────────────
bot.command('positions', async ctx => showPositions(ctx));

async function showPositions(ctx) {
  updateOpenPnL();
  if (!state.openTrades.length) {
    return ctx.reply('📭 No open positions. Use /trade to open one.', { parse_mode: 'HTML' });
  }
  let msg = `<b>💼 Open Positions (${state.openTrades.length})</b>\n\n`;
  for (const t of state.openTrades) {
    const d    = state.marketData[t.symbol];
    const sign = t.pnl >= 0 ? '+' : '';
    msg += `${t.dir === 'BUY' ? '🟢' : '🔴'} <b>${t.dir} ${t.symbol}</b>  ID: <code>${t.id}</code>
Entry → Now: <code>${fp(t.entry, d?.decimals)} → ${fp(t.cp, d?.decimals)}</code>
P&L: <code>${sign}$${t.pnl.toFixed(2)}</code>  |  /close ${t.id}\n\n`;
  }
  await ctx.reply(msg, { parse_mode: 'HTML' });
}

// /close ──────────────────────────────────────────────────────────────────────
bot.command('close', async ctx => {
  const id    = parseInt(ctx.message.text.split(' ')[1]);
  if (!id) return ctx.reply('Usage: /close [trade_id]', { parse_mode: 'HTML' });
  const trade = closeTrade(id);
  if (!trade) return ctx.reply('❌ Trade not found or already closed.', { parse_mode: 'HTML' });
  const d    = state.marketData[trade.symbol];
  const sign = trade.pnl >= 0 ? '+' : '';
  await ctx.reply(
    `<b>${trade.pnl >= 0 ? '✅' : '❌'} Trade Closed</b>

${trade.dir === 'BUY' ? '🟢' : '🔴'} ${trade.dir} <code>${trade.symbol}</code>
Entry:  <code>${fp(trade.entry, d?.decimals)}</code>
Exit:   <code>${fp(trade.exitPrice, d?.decimals)}</code>
<b>P&L:   <code>${sign}$${trade.pnl.toFixed(2)}</code></b>
Balance: <code>$${state.balance.toFixed(2)}</code>`,
    { parse_mode: 'HTML' }
  );
});

// /balance ────────────────────────────────────────────────────────────────────
bot.command('balance', async ctx => showBalance(ctx));

async function showBalance(ctx) {
  updateOpenPnL();
  await ctx.reply(formatBalance(state.balance, state.openTrades, state.closedTrades), { parse_mode: 'HTML' });
}

// /history ────────────────────────────────────────────────────────────────────
bot.command('history', async ctx => {
  if (!state.closedTrades.length) {
    return ctx.reply('📭 No closed trades yet. Use /trade to get started.', { parse_mode: 'HTML' });
  }
  let msg = `<b>📋 Trade History (last ${Math.min(state.closedTrades.length, 10)})</b>\n\n`;
  for (const t of state.closedTrades.slice(0, 10)) {
    const d    = state.marketData[t.symbol];
    const sign = t.pnl >= 0 ? '+' : '';
    msg += `${t.pnl >= 0 ? '✅' : '❌'} ${t.dir} <code>${t.symbol}</code>  →  <code>${sign}$${t.pnl.toFixed(2)}</code>
   <code>${fp(t.entry, d?.decimals)} → ${fp(t.exitPrice, d?.decimals)}</code>\n\n`;
  }
  await ctx.reply(msg, { parse_mode: 'HTML' });
});

// ─────────────────────────────────────────────────────────────────────────────
//  CRON JOBS
// ─────────────────────────────────────────────────────────────────────────────

// Every 2 min — signal change detection (no re-fetch, uses cached data)
cron.schedule('*/2 * * * *', async () => {
  if (!state.autoMode || !state.subscribers.size) return;
  if (!Object.keys(state.marketData).length) return;

  const sessions = getActiveSessions(utcHour());
  for (const [sym, d] of Object.entries(state.marketData)) {
    const sig    = computeSignal(d.closes, d.latest);
    const newSig = sig?.signal;
    const oldSig = state.lastSignals[sym];
    if (!newSig) continue;

    if (newSig !== 'WAIT' && newSig !== oldSig && sig.confidence >= 60) {
      console.log(`[realtime] Signal change: ${sym} ${oldSig} → ${newSig} (${sig.confidence}%)`);
      state.lastSignals[sym] = newSig;
      const msg = formatSignalAlert(d, sig, sessions, '🚨 <b>SIGNAL CHANGE ALERT</b>\n\n');
      await broadcast(msg);
    } else if (newSig) {
      state.lastSignals[sym] = newSig;
    }
  }
});

// Every 15 min — fresh data + alert on changes
cron.schedule('*/15 * * * *', async () => {
  console.log('[cron] 15-min scan…');
  await runAutoScan(state.autoMode);
  console.log('[cron] 15-min scan done');
});

// Every 1 hour — full scan + AI on strongest signal
cron.schedule('0 * * * *', async () => {
  console.log('[cron] Hourly scan…');
  if (!state.autoMode || !state.subscribers.size) return;
  await refreshData();

  const sigs     = allSignals();
  const sessions = getActiveSessions(utcHour());
  const top      = Object.entries(sigs)
    .filter(([, d]) => d.signal.signal !== 'WAIT')
    .sort((a, b) => b[1].signal.confidence - a[1].signal.confidence)[0];

  if (top && top[1].signal.confidence >= 65) {
    const [sym, d] = top;
    await broadcast(formatSignalAlert(d, d.signal, sessions, '⏰ <b>HOURLY TOP SIGNAL</b>\n\n'));

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const ai = await runDeepAnalysis(d, d.signal, sessions);
        await broadcast(formatAIAnalysis(ai, sym));
      } catch (e) {
        console.error('[cron/ai]', e.message);
      }
    }
  }
  console.log('[cron] Hourly done');
});

// Every 4 hours — market report
cron.schedule('0 */4 * * *', async () => {
  console.log('[cron] 4-hour report…');
  if (!state.autoMode || !state.subscribers.size) return;
  const sigs     = allSignals();
  const sessions = getActiveSessions(utcHour());
  await broadcast(formatMarketReport(sigs, sessions));
  console.log('[cron] 4-hour report sent');
});

// ─────────────────────────────────────────────────────────────────────────────
//  ERROR HANDLING
// ─────────────────────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[bot] Error on ${ctx?.updateType}:`, err.message);
});

// ─────────────────────────────────────────────────────────────────────────────
//  LAUNCH
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('⚡ AutoPilot FX Bot starting…');
  await refreshData();
  await bot.launch();
  console.log('✅ Bot is live. Listening for commands.');

  process.once('SIGINT',  () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(err => {
  console.error('💥 Fatal startup error:', err.message);
  process.exit(1);
});
