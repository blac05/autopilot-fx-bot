'use strict';

const {
  rsi, macd, bollingerBands, ema,
  stochRsi, atr, supportResistance, trendStrength,
} = require('./indicators');

/**
 * Compute a composite BUY / SELL / WAIT signal from a closes array.
 * Returns signal, confidence (0-100), all sub-indicators, and TP/SL levels.
 */
function computeSignal(closes, live) {
  if (!closes || closes.length < 30) return null;

  const r   = rsi(closes);
  const m   = macd(closes);
  const bb  = bollingerBands(closes);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const sr  = stochRsi(closes);
  const at  = atr(closes);
  const snr = supportResistance(closes, 20);
  const trend = trendStrength(closes);

  let bull = 0, bear = 0;

  // ── RSI (max 4 pts) ──────────────────────────────────────
  if (r != null) {
    if      (r < 25) bull += 4;
    else if (r < 35) bull += 2;
    else if (r < 45) bull += 1;
    else if (r > 75) bear += 4;
    else if (r > 65) bear += 2;
    else if (r > 55) bear += 1;
  }

  // ── MACD (max 3 pts) ─────────────────────────────────────
  if (m?.histogram != null) {
    m.histogram > 0 ? (bull += 2) : (bear += 2);
    if (m.line > 0 && m.histogram > 0) bull++;
    if (m.line < 0 && m.histogram < 0) bear++;
  }

  // ── Bollinger Bands (max 3 pts) ──────────────────────────
  if (bb && live != null) {
    if      (live < bb.lower)  bull += 3;
    else if (live < bb.middle) bull += 1;
    else if (live > bb.upper)  bear += 3;
    else if (live > bb.middle) bear += 1;
  }

  // ── EMA cross + price location (max 3 pts) ───────────────
  if (e20 != null && e50 != null) {
    e20 > e50 ? (bull += 2) : (bear += 2);
    if (live != null) {
      if (live > e20 && live > e50)      bull++;
      else if (live < e20 && live < e50) bear++;
    }
  }

  // ── StochRSI (max 3 pts) ─────────────────────────────────
  if (sr != null) {
    if      (sr < 15) bull += 3;
    else if (sr < 25) bull += 2;
    else if (sr > 85) bear += 3;
    else if (sr > 75) bear += 2;
  }

  // ── Trend (max 1 pt) ─────────────────────────────────────
  if (trend === 'UPTREND')   bull++;
  else if (trend === 'DOWNTREND') bear++;

  // ── Composite decision ───────────────────────────────────
  const total      = bull + bear || 1;
  const bullPct    = (bull / total) * 100;
  const signal     = bullPct >= 62 ? 'BUY' : bullPct <= 38 ? 'SELL' : 'WAIT';
  const confidence = signal === 'BUY'
    ? Math.min(Math.round(bullPct), 99)
    : signal === 'SELL'
    ? Math.min(Math.round(100 - bullPct), 99)
    : 50;

  // ── ATR-based TP / SL ────────────────────────────────────
  let tp = null, sl = null, rr = null;
  if (at && live && signal !== 'WAIT') {
    const tpDist = at * 2.5;
    const slDist = at * 1.2;
    if (signal === 'BUY') {
      tp = live + tpDist;
      sl = live - slDist;
    } else {
      tp = live - tpDist;
      sl = live + slDist;
    }
    rr = (tpDist / slDist).toFixed(2);
  }

  return {
    signal,
    confidence,
    bull,
    bear,
    rsi:      r,
    macd:     m,
    bb,
    ema20:    e20,
    ema50:    e50,
    stochRsi: sr,
    atr:      at,
    snr,
    trend,
    tp,
    sl,
    rr,
    live,
  };
}

module.exports = { computeSignal };
