'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fp(price, decimals) {
  if (price == null) return '—';
  return price.toFixed(decimals ?? 5);
}

function pips(diff, pip) {
  if (diff == null || pip == null) return '—';
  return Math.abs(Math.round(diff / pip));
}

function confBar(conf) {
  const filled = Math.round((conf / 100) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function sigEmoji(signal) {
  return signal === 'BUY' ? '🟢' : signal === 'SELL' ? '🔴' : '🟡';
}

function rsiLabel(r) {
  if (r == null) return '—';
  if (r < 25)  return `${r.toFixed(1)} ⚡ OVERSOLD`;
  if (r < 35)  return `${r.toFixed(1)} 🟢 Oversold`;
  if (r > 75)  return `${r.toFixed(1)} ⚡ OVERBOUGHT`;
  if (r > 65)  return `${r.toFixed(1)} 🔴 Overbought`;
  return `${r.toFixed(1)} ⚪ Neutral`;
}

function srLabel(sr) {
  if (sr == null) return '—';
  if (sr < 20)  return `${sr.toFixed(1)} ⚡ Oversold`;
  if (sr > 80)  return `${sr.toFixed(1)} ⚡ Overbought`;
  return `${sr.toFixed(1)} ⚪`;
}

function bbLabel(bb, live) {
  if (!bb || live == null) return '—';
  if (live < bb.lower)  return '⬇️ Below Lower Band';
  if (live > bb.upper)  return '⬆️ Above Upper Band';
  if (live < bb.middle) return '↙️ Lower Half';
  return '↗️ Upper Half';
}

function trendLabel(trend) {
  if (trend === 'UPTREND')   return '📈 Uptrend';
  if (trend === 'DOWNTREND') return '📉 Downtrend';
  return '↔️ Ranging';
}

function liqLabel(sessions) {
  if (sessions.length >= 2) return 'HIGH 🔥';
  if (sessions.length === 1) return 'ACTIVE ✅';
  return 'LOW ⚠️';
}

// ─── Signal Alert ─────────────────────────────────────────────────────────────

function formatSignalAlert(pairData, sig, sessions, prefix = '') {
  const { symbol, name, pip, decimals } = pairData;
  const {
    signal, confidence,
    rsi: r, macd: m, bb, ema20, ema50,
    stochRsi: sr, trend, atr: at, snr,
    tp, sl, rr, live, bull, bear,
  } = sig;

  const utcTime     = new Date().toUTCString().split(' ')[4];
  const sessionLine = sessions.length
    ? sessions.map(s => `${s.emoji} ${s.name}`).join(' · ')
    : '😴 All sessions closed';

  const tpPips = tp && live ? pips(Math.abs(tp - live), pip) : '—';
  const slPips = sl && live ? pips(Math.abs(sl - live), pip) : '—';

  const emaCross = ema20 != null && ema50 != null
    ? (ema20 > ema50 ? '✨ Golden Cross' : '💀 Death Cross')
    : '—';

  const macdLine = m?.histogram != null
    ? `${m.histogram > 0 ? '▲ Bullish' : '▼ Bearish'} (${m.histogram.toFixed(6)})`
    : '—';

  let msg = `${prefix}<b>⚡ AUTOPILOT FX — SIGNAL</b>

${sigEmoji(signal)} <b>${signal}</b>  <code>${symbol}</code>
<i>${name}</i>

💰 <b>Price:</b> <code>${fp(live, decimals)}</code>
🕐 <b>Time:</b> <code>${utcTime} UTC</code>
🌍 <b>Session:</b> ${sessionLine}
💧 <b>Liquidity:</b> ${liqLabel(sessions)}

<b>📊 Technical Indicators</b>
┣ RSI (14): <code>${rsiLabel(r)}</code>
┣ StochRSI: <code>${srLabel(sr)}</code>
┣ MACD: <code>${macdLine}</code>
┣ Bollinger: <code>${bbLabel(bb, live)}</code>
┣ BB Width: <code>${bb?.bandwidth?.toFixed(2) ?? '—'}%</code>
┣ EMA Cross: <code>${emaCross}</code>
┣ Trend: <code>${trendLabel(trend)}</code>
┗ ATR (14): <code>${at?.toFixed(5) ?? '—'}</code>

<b>💯 Signal Strength: ${confidence}%</b>
<code>${confBar(confidence)}</code>
<i>Bull ${bull} · Bear ${bear}</i>
`;

  if (signal !== 'WAIT') {
    msg += `
<b>🎯 Trade Levels</b>
┣ Entry:  <code>${fp(live, decimals)}</code>
┣ Target: <code>${fp(tp, decimals)}</code>  (+${tpPips} pips)
┣ Stop:   <code>${fp(sl, decimals)}</code>  (-${slPips} pips)
┗ R:R:   <code>1:${rr ?? '—'}</code>
`;
  }

  if (snr?.support != null) {
    msg += `
<b>🗺 Key Levels (20-day)</b>
┣ Resistance: <code>${fp(snr.resistance, decimals)}</code>
┗ Support:    <code>${fp(snr.support, decimals)}</code>
`;
  }

  msg += `\n<i>⚠️ Paper trading reference only — not financial advice</i>`;
  return msg;
}

// ─── Full Scan Report ─────────────────────────────────────────────────────────

function formatScanReport(allSignals, sessions) {
  const utcTime     = new Date().toUTCString().split(' ')[4];
  const sessionLine = sessions.length
    ? sessions.map(s => `${s.emoji} ${s.name}`).join(', ')
    : 'No major session active';

  const buys  = Object.entries(allSignals).filter(([, d]) => d.signal?.signal === 'BUY') .sort((a, b) => b[1].signal.confidence - a[1].signal.confidence);
  const sells = Object.entries(allSignals).filter(([, d]) => d.signal?.signal === 'SELL').sort((a, b) => b[1].signal.confidence - a[1].signal.confidence);
  const waits = Object.entries(allSignals).filter(([, d]) => d.signal?.signal === 'WAIT');

  let msg = `<b>🔍 FULL MARKET SCAN</b>
<code>${utcTime} UTC</code>  |  ${sessionLine}
Pairs scanned: <b>${Object.keys(allSignals).length}</b>

`;

  if (buys.length) {
    msg += `<b>🟢 BUY SIGNALS (${buys.length})</b>\n`;
    for (const [sym, d] of buys) {
      msg += `┣ <code>${sym.padEnd(7)}</code> ${d.signal.confidence}% conf  |  RSI ${d.signal.rsi?.toFixed(1) ?? '—'}  |  <code>${fp(d.latest, d.decimals)}</code>\n`;
    }
    msg += '\n';
  }

  if (sells.length) {
    msg += `<b>🔴 SELL SIGNALS (${sells.length})</b>\n`;
    for (const [sym, d] of sells) {
      msg += `┣ <code>${sym.padEnd(7)}</code> ${d.signal.confidence}% conf  |  RSI ${d.signal.rsi?.toFixed(1) ?? '—'}  |  <code>${fp(d.latest, d.decimals)}</code>\n`;
    }
    msg += '\n';
  }

  if (waits.length) {
    msg += `<b>🟡 NEUTRAL / WAIT (${waits.length})</b>\n`;
    for (const [sym, d] of waits) {
      msg += `┣ <code>${sym.padEnd(7)}</code> RSI ${d.signal?.rsi?.toFixed(1) ?? '—'}  |  <code>${fp(d.latest, d.decimals)}</code>\n`;
    }
    msg += '\n';
  }

  msg += `\n<i>Next auto-scan in ~15 min  |  /signal [PAIR] for full breakdown</i>`;
  return msg;
}

// ─── 4-Hour Market Report ─────────────────────────────────────────────────────

function formatMarketReport(allSignals, sessions) {
  const utcTime     = new Date().toUTCString();
  const sessionLine = sessions.length
    ? sessions.map(s => `${s.emoji} ${s.name}`).join(', ')
    : 'No major session active';

  const sorted = Object.entries(allSignals)
    .filter(([, d]) => d.signal?.signal !== 'WAIT')
    .sort((a, b) => b[1].signal.confidence - a[1].signal.confidence);

  const top3 = sorted.slice(0, 3);
  const totalBuys  = sorted.filter(([, d]) => d.signal.signal === 'BUY').length;
  const totalSells = sorted.filter(([, d]) => d.signal.signal === 'SELL').length;
  const bias = totalBuys > totalSells ? '🟢 Overall BULLISH bias' : totalSells > totalBuys ? '🔴 Overall BEARISH bias' : '🟡 Mixed / Neutral market';

  let msg = `<b>📊 4-HOUR MARKET REPORT</b>
<code>${utcTime}</code>

🌍 <b>Sessions:</b> ${sessionLine}
${bias}  (${totalBuys} buys · ${totalSells} sells)

<b>🏆 Top Opportunities</b>\n`;

  if (top3.length === 0) {
    msg += 'No strong setups right now — market may be consolidating.\n';
  } else {
    for (const [sym, d] of top3) {
      const s = d.signal;
      msg += `${sigEmoji(s.signal)} <code>${sym}</code> — <b>${s.signal}</b>  ${s.confidence}% conf
   <code>${fp(s.live, d.decimals)}</code>  ·  RSI ${s.rsi?.toFixed(1) ?? '—'}  ·  ${trendLabel(s.trend)}
   TP <code>${fp(s.tp, d.decimals)}</code>  SL <code>${fp(s.sl, d.decimals)}</code>  R:R 1:${s.rr ?? '—'}\n\n`;
    }
  }

  msg += `\n<i>Use /signal [PAIR] for deep analysis  |  /ai [PAIR] for AI insight</i>`;
  return msg;
}

// ─── Portfolio Summary ────────────────────────────────────────────────────────

function formatBalance(balance, paperTrades, closedTrades) {
  const floatPnL   = paperTrades.reduce((a, t) => a + (t.pnl || 0), 0);
  const equity     = balance + floatPnL;
  const totalPnL   = closedTrades.reduce((a, t) => a + (t.pnl || 0), 0);
  const wins       = closedTrades.filter(t => t.pnl > 0).length;
  const winRate    = closedTrades.length ? Math.round((wins / closedTrades.length) * 100) : 0;
  const pnlSign    = n => n >= 0 ? '+' : '';

  return `<b>💰 Paper Portfolio</b>

Balance:      <code>$${balance.toFixed(2)}</code>
Floating P&L: <code>${pnlSign(floatPnL)}$${floatPnL.toFixed(2)}</code>
Equity:       <code>$${equity.toFixed(2)}</code>

<b>📋 Performance</b>
Total P&L:   <code>${pnlSign(totalPnL)}$${totalPnL.toFixed(2)}</code>
Closed trades: ${closedTrades.length}
Open trades:   ${paperTrades.length}
Win Rate:    <code>${winRate}%</code>`;
}

// ─── Backtest Report ──────────────────────────────────────────────────────────

function formatBacktest(result, symbol, pip) {
  if (result.error) {
    return `<b>📊 Backtest — <code>${symbol}</code></b>\n\n❌ ${result.error}`;
  }
  if (!result.totalTrades) {
    return `<b>📊 Backtest — <code>${symbol}</code></b>\n\n🟡 ${result.message}`;
  }

  const toPips = v => Math.round(Math.abs(v) / (pip ?? 0.0001));
  const winEmoji = result.winRate >= 55 ? '🟢' : result.winRate >= 45 ? '🟡' : '🔴';
  const pfEmoji  = (typeof result.profitFactor === 'number' && result.profitFactor >= 1.5) ? '🟢'
                 : (typeof result.profitFactor === 'number' && result.profitFactor >= 1)   ? '🟡' : '🔴';

  return `<b>📊 STRATEGY BACKTEST — <code>${symbol}</code></b>
<i>~65 days of daily closes · no lookahead bias</i>

<b>🎯 Results</b>
┣ Total trades:    <code>${result.totalTrades}</code>
┣ Wins / Losses:   <code>${result.wins} / ${result.losses}</code>
┣ Win Rate:        ${winEmoji} <b>${result.winRate}%</b>
┗ Avg Confidence:  <code>${result.avgConfidence}%</code>

<b>💰 Performance</b>
┣ Profit Factor:   ${pfEmoji} <code>${result.profitFactor}</code>
┣ Avg Win:         <code>+${toPips(result.avgWinPips)} pips</code>
┣ Avg Loss:        <code>-${toPips(result.avgLossPips)} pips</code>
┣ Expectancy:      <code>${result.expectancy >= 0 ? '+' : ''}${toPips(result.expectancy)} pips/trade</code>
┗ Net Result:      <code>${result.netPips >= 0 ? '+' : ''}${toPips(result.netPips)} pips</code>

<b>⚠️ Risk</b>
┣ Max Drawdown:     <code>${toPips(result.maxDrawdown)} pips</code>
┣ Max Loss Streak:  <code>${result.maxLossStreak} in a row</code>
┗ Avg Hold Time:    <code>${result.avgHoldDays} days</code>

<i>Past performance on historical data does not guarantee future results. Small sample size — treat as directional, not definitive.</i>`;
}

// ─── Multi-Pair Backtest Ranking ──────────────────────────────────────────────

function formatBacktestAll(results) {
  const valid = results.filter(r => r.result.totalTrades > 0);
  const empty = results.filter(r => !r.result.totalTrades);

  if (!valid.length) {
    return `<b>📊 FULL STRATEGY BACKTEST</b>\n\n🟡 No pair produced enough qualifying signals in this window.`;
  }

  const ranked = [...valid].sort((a, b) => b.result.winRate - a.result.winRate);

  let msg = `<b>📊 FULL STRATEGY BACKTEST</b>
<i>~65 days of daily closes per pair · ranked by win rate</i>

`;

  for (const { symbol, decimals, pip, result: r } of ranked) {
    const toPips = v => Math.round(Math.abs(v) / (pip ?? 0.0001));
    const winEmoji = r.winRate >= 55 ? '🟢' : r.winRate >= 45 ? '🟡' : '🔴';
    const pf = typeof r.profitFactor === 'number' ? r.profitFactor : r.profitFactor;
    msg += `${winEmoji} <code>${symbol.padEnd(7)}</code> ${r.winRate}% win  ·  ${r.totalTrades} trades  ·  PF ${pf}  ·  ${r.expectancy >= 0 ? '+' : ''}${toPips(r.expectancy)} pips/trade\n`;
  }

  const avgWinRate = ranked.reduce((a, r) => a + r.result.winRate, 0) / ranked.length;
  msg += `\n<b>Average win rate across ${ranked.length} pairs:</b> <code>${Math.round(avgWinRate * 10) / 10}%</code>`;

  if (empty.length) {
    msg += `\n\n<i>No qualifying signals for: ${empty.map(e => e.symbol).join(', ')}</i>`;
  }

  msg += `\n\n<i>Use /backtest [PAIR] for full detail on any pair. Past performance does not guarantee future results.</i>`;
  return msg;
}

module.exports = { formatSignalAlert, formatScanReport, formatMarketReport, formatBalance, formatBacktest, formatBacktestAll, fp };