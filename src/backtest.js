'use strict';

const { computeSignal } = require('./signals');

/**
 * Backtest the composite signal strategy against historical daily closes.
 * No lookahead bias: at each step, the signal is computed using ONLY data
 * available up to that point in time.
 *
 * Trade simulation (since we only have daily closes, not OHLC):
 *  - Entry at the close where a BUY/SELL signal first fires
 *  - Each subsequent day's close is checked against TP/SL levels
 *  - If neither is hit within maxHoldDays, the trade is closed at market
 *    (time-exit) using the close price on that final day
 *
 * @param {number[]} closes - full historical closes array (oldest -> newest)
 * @param {object} opts
 * @param {number} opts.minHistory   - min bars needed before signals start (default 35)
 * @param {number} opts.maxHoldDays  - max bars to hold a trade before time-exit (default 10)
 * @param {number} opts.cooldownDays - bars to wait after closing a trade before re-entry (default 1)
 */
function runBacktest(closes, opts = {}) {
  const minHistory   = opts.minHistory   ?? 35;
  const maxHoldDays   = opts.maxHoldDays  ?? 10;
  const cooldownDays = opts.cooldownDays ?? 1;

  if (!closes || closes.length < minHistory + 10) {
    return { error: 'Not enough historical data to backtest (need at least 45 data points).' };
  }

  const trades = [];
  let i = minHistory;
  let cooldownUntil = -1;

  while (i < closes.length - 1) {
    if (i <= cooldownUntil) { i++; continue; }

    const hist = closes.slice(0, i + 1);
    const sig  = computeSignal(hist, hist[hist.length - 1]);

    if (!sig || sig.signal === 'WAIT' || sig.tp == null || sig.sl == null) {
      i++;
      continue;
    }

    const entryIdx   = i;
    const entryPrice = closes[entryIdx];
    const { signal, tp, sl, confidence } = sig;

    // Walk forward to find exit
    let exitIdx   = null;
    let exitPrice = null;
    let outcome   = null; // 'WIN' | 'LOSS' | 'TIME'

    for (let j = entryIdx + 1; j <= Math.min(entryIdx + maxHoldDays, closes.length - 1); j++) {
      const p = closes[j];
      if (signal === 'BUY') {
        if (p >= tp) { exitIdx = j; exitPrice = tp; outcome = 'WIN';  break; }
        if (p <= sl) { exitIdx = j; exitPrice = sl; outcome = 'LOSS'; break; }
      } else {
        if (p <= tp) { exitIdx = j; exitPrice = tp; outcome = 'WIN';  break; }
        if (p >= sl) { exitIdx = j; exitPrice = sl; outcome = 'LOSS'; break; }
      }
      exitIdx   = j;
      exitPrice = p;
    }

    if (exitIdx == null) { i++; continue; }

    if (outcome === null) {
      // Time-exit: determine win/loss by whether price moved favorably at all
      const moved = signal === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
      outcome = moved > 0 ? 'WIN' : 'LOSS';
    }

    const pipsResult = signal === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;

    trades.push({
      entryIdx, exitIdx, signal, confidence,
      entryPrice, exitPrice, outcome,
      pips: pipsResult,
      barsHeld: exitIdx - entryIdx,
    });

    cooldownUntil = exitIdx + cooldownDays - 1;
    i = exitIdx + 1;
  }

  return summarize(trades);
}

function summarize(trades) {
  if (!trades.length) {
    return {
      totalTrades: 0,
      message: 'No qualifying signals were generated in this historical window.',
    };
  }

  const wins   = trades.filter(t => t.outcome === 'WIN');
  const losses = trades.filter(t => t.outcome === 'LOSS');

  const winRate = (wins.length / trades.length) * 100;

  const grossWin  = wins.reduce((a, t) => a + Math.abs(t.pips), 0);
  const grossLoss = losses.reduce((a, t) => a + Math.abs(t.pips), 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  const avgWin  = wins.length   ? grossWin  / wins.length   : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss;

  // Equity curve (in "pip units") + max drawdown
  let equity = 0, peak = 0, maxDD = 0;
  const curve = [];
  for (const t of trades) {
    equity += t.pips;
    curve.push(equity);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  // Max consecutive losses (real risk indicator)
  let maxStreak = 0, curStreak = 0;
  for (const t of trades) {
    curStreak = t.outcome === 'LOSS' ? curStreak + 1 : 0;
    if (curStreak > maxStreak) maxStreak = curStreak;
  }

  const avgConfidence = trades.reduce((a, t) => a + t.confidence, 0) / trades.length;
  const avgHoldDays   = trades.reduce((a, t) => a + t.barsHeld, 0) / trades.length;

  return {
    totalTrades:   trades.length,
    wins:          wins.length,
    losses:        losses.length,
    winRate:       Math.round(winRate * 10) / 10,
    profitFactor:  isFinite(profitFactor) ? Math.round(profitFactor * 100) / 100 : '∞',
    avgWinPips:    Math.round(avgWin * 100000) / 100000,
    avgLossPips:   Math.round(avgLoss * 100000) / 100000,
    expectancy:    Math.round(expectancy * 100000) / 100000,
    maxDrawdown:   Math.round(maxDD * 100000) / 100000,
    maxLossStreak: maxStreak,
    avgConfidence: Math.round(avgConfidence),
    avgHoldDays:   Math.round(avgHoldDays * 10) / 10,
    netPips:       Math.round(equity * 100000) / 100000,
    trades,
    curve,
  };
}

module.exports = { runBacktest };