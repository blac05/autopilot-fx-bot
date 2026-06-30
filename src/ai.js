'use strict';

const axios = require('axios');

/**
 * Run a deep AI analysis on a pair using Claude.
 * Returns parsed JSON with signal, confidence, reasoning, setup, etc.
 */
async function runDeepAnalysis(pairData, sig, sessions) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const { symbol, name, decimals } = pairData;
  const {
    rsi: r, macd: m, bb, ema20, ema50,
    stochRsi: sr, trend, atr: at, live,
  } = sig;

  const sessionNames = sessions.length
    ? sessions.map(s => s.name).join(', ')
    : 'No major session active';

  const fmt = (v, d = 5) => v != null ? Number(v).toFixed(d) : 'N/A';

  const prompt = `You are ForexGPT, an elite quantitative analyst specializing in technical analysis. Analyze the data below and provide a structured trading insight.

PAIR: ${name} (${symbol})
LIVE PRICE: ${fmt(live, decimals ?? 5)}
UTC HOUR: ${new Date().getUTCHours()}
ACTIVE SESSIONS: ${sessionNames}

INDICATORS:
RSI-14:       ${fmt(r, 2)} ${r < 30 ? '[OVERSOLD]' : r > 70 ? '[OVERBOUGHT]' : '[NEUTRAL]'}
StochRSI-14:  ${fmt(sr, 2)}
MACD Line:    ${fmt(m?.line, 6)}
MACD Signal:  ${fmt(m?.signal, 6)}
MACD Hist:    ${fmt(m?.histogram, 6)} ${m?.histogram > 0 ? '[BULLISH]' : '[BEARISH]'}
BB Upper:     ${fmt(bb?.upper)}
BB Middle:    ${fmt(bb?.middle)}
BB Lower:     ${fmt(bb?.lower)}
BB Bandwidth: ${fmt(bb?.bandwidth, 2)}%
EMA-20:       ${fmt(ema20)}
EMA-50:       ${fmt(ema50)}
EMA Cross:    ${ema20 && ema50 ? (ema20 > ema50 ? 'GOLDEN (Bullish)' : 'DEATH (Bearish)') : 'N/A'}
ATR-14:       ${fmt(at)}
Trend:        ${trend}

Respond with ONLY valid JSON — no markdown fences, no commentary outside JSON:
{
  "signal": "BUY|SELL|WAIT",
  "confidence": 0-100,
  "setup": "setup name (e.g. RSI Divergence, BB Squeeze, MACD Cross)",
  "bias": "BULLISH|BEARISH|NEUTRAL",
  "condition": "TRENDING|RANGING|VOLATILE|BREAKOUT",
  "timeframe": "best timeframe (H1|H4|D1)",
  "reasoning": "2-3 sentence technical justification",
  "warning": "key risk or caveat to watch (1 sentence)",
  "key_levels": ["level 1", "level 2", "level 3"]
}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      timeout: 30000,
    }
  );

  const text  = (response.data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in AI response');
  return JSON.parse(match[0]);
}

/** Format the AI response into a Telegram HTML message */
function formatAIAnalysis(analysis, symbol) {
  const condEmoji = { TRENDING: '📈', RANGING: '↔️', VOLATILE: '⚡', BREAKOUT: '🚀' };
  const biasEmoji = { BULLISH: '🟢', BEARISH: '🔴', NEUTRAL: '🟡' };
  const sigEmoji  = { BUY: '🟢', SELL: '🔴', WAIT: '🟡' };

  let msg = `<b>🤖 AI DEEP ANALYSIS — <code>${symbol}</code></b>

${sigEmoji[analysis.signal] || '⚪'} <b>${analysis.signal}</b>  ·  Confidence: <b>${analysis.confidence}%</b>
${condEmoji[analysis.condition] || '📊'} ${analysis.condition}  ·  ${biasEmoji[analysis.bias] || ''} ${analysis.bias}  ·  ${analysis.timeframe}

<b>Setup:</b> <i>${analysis.setup}</i>

<b>📝 Analysis:</b>
${analysis.reasoning}

${analysis.warning ? `<b>⚠️ Risk Note:</b> <i>${analysis.warning}</i>` : ''}`;

  if (analysis.key_levels?.length) {
    msg += `\n\n<b>🗺 Key Levels:</b>`;
    for (const lvl of analysis.key_levels) {
      msg += `\n┣ <code>${lvl}</code>`;
    }
  }

  msg += `\n\n<i>Powered by Claude AI · Not financial advice</i>`;
  return msg;
}

module.exports = { runDeepAnalysis, formatAIAnalysis };
