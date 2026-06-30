'use strict';

/** Simple Moving Average */
function sma(arr, n) {
  if (!arr || arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

/** Exponential Moving Average */
function ema(arr, n) {
  if (!arr || arr.length < n) return null;
  const k = 2 / (n + 1);
  let val = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < arr.length; i++) {
    val = arr[i] * k + val * (1 - k);
  }
  return val;
}

/** RSI — Relative Strength Index (Wilder smoothing) */
function rsi(arr, n = 14) {
  if (!arr || arr.length < n + 1) return null;
  const deltas = arr.slice(1).map((v, i) => v - arr[i]);
  let avgG = deltas.slice(0, n).filter(d => d > 0).reduce((a, b) => a + b, 0) / n;
  let avgL = deltas.slice(0, n).filter(d => d < 0).reduce((a, b) => a + Math.abs(b), 0) / n;
  for (let i = n; i < deltas.length; i++) {
    avgG = (avgG * (n - 1) + (deltas[i] > 0 ? deltas[i] : 0)) / n;
    avgL = (avgL * (n - 1) + (deltas[i] < 0 ? Math.abs(deltas[i]) : 0)) / n;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

/** MACD — 12/26/9 */
function macd(arr) {
  if (!arr || arr.length < 35) return null;
  const e12 = ema(arr, 12);
  const e26 = ema(arr, 26);
  if (e12 == null || e26 == null) return null;
  const line = e12 - e26;

  // Build MACD line history for signal calculation
  const macdHistory = [];
  for (let i = 26; i <= arr.length; i++) {
    const sl = arr.slice(0, i);
    const m12 = ema(sl, 12), m26 = ema(sl, 26);
    if (m12 != null && m26 != null) macdHistory.push(m12 - m26);
  }
  const signal = macdHistory.length >= 9 ? ema(macdHistory, 9) : null;
  return {
    line,
    signal,
    histogram: signal != null ? line - signal : null,
  };
}

/** Bollinger Bands (20 period, 2σ default) */
function bollingerBands(arr, n = 20, mult = 2) {
  if (!arr || arr.length < n) return null;
  const slice = arr.slice(-n);
  const mid = slice.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / n);
  return {
    upper: mid + mult * sd,
    middle: mid,
    lower: mid - mult * sd,
    bandwidth: ((mult * 2 * sd) / mid) * 100,
    sd,
  };
}

/** Stochastic RSI */
function stochRsi(arr, n = 14) {
  const r = rsi(arr, n);
  if (r == null) return null;
  const rsiHistory = [];
  for (let i = n + 1; i <= arr.length; i++) {
    const v = rsi(arr.slice(0, i), n);
    if (v != null) rsiHistory.push(v);
  }
  if (rsiHistory.length < n) return null;
  const slice = rsiHistory.slice(-n);
  const lo = Math.min(...slice), hi = Math.max(...slice);
  if (hi === lo) return 50;
  return ((r - lo) / (hi - lo)) * 100;
}

/** Average True Range (simplified using close-only) */
function atr(closes, n = 14) {
  if (!closes || closes.length < n + 1) return null;
  const trs = closes.slice(1).map((c, i) => Math.abs(c - closes[i]));
  return trs.slice(-n).reduce((a, b) => a + b, 0) / n;
}

/** Detect support and resistance over a lookback window */
function supportResistance(closes, lookback = 20) {
  if (!closes || closes.length < lookback) return { support: null, resistance: null };
  const slice = closes.slice(-lookback);
  return { support: Math.min(...slice), resistance: Math.max(...slice) };
}

/** Trend direction from two EMAs */
function trendStrength(closes, fast = 10, slow = 20) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  if (!fastEma || !slowEma) return 'NEUTRAL';
  const diff = ((fastEma - slowEma) / slowEma) * 100;
  if (diff > 0.06) return 'UPTREND';
  if (diff < -0.06) return 'DOWNTREND';
  return 'RANGING';
}

module.exports = { sma, ema, rsi, macd, bollingerBands, stochRsi, atr, supportResistance, trendStrength };
