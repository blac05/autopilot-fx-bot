'use strict';

const axios = require('axios');
const http  = require('http');
const https = require('https');

// Force IPv4 — Windows sometimes hangs trying IPv6 first against this API
const agentOpts = { family: 4 };
const httpAgent  = new http.Agent(agentOpts);
const httpsAgent = new https.Agent(agentOpts);

const api = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 15000,
});

const BASE_URL = 'https://api.frankfurter.app';

/** All tracked forex pairs */
const PAIRS = [
  // ── Majors ──
  { symbol: 'EURUSD', base: 'EUR', quote: 'USD', name: 'Euro / US Dollar',                pip: 0.0001, decimals: 5 },
  { symbol: 'USDCHF', base: 'USD', quote: 'CHF', name: 'US Dollar / Swiss Franc',         pip: 0.0001, decimals: 5 },
  { symbol: 'GBPUSD', base: 'GBP', quote: 'USD', name: 'British Pound / US Dollar',       pip: 0.0001, decimals: 5 },
  { symbol: 'USDJPY', base: 'USD', quote: 'JPY', name: 'US Dollar / Japanese Yen',        pip: 0.01,   decimals: 3 },
  { symbol: 'AUDUSD', base: 'AUD', quote: 'USD', name: 'Australian Dollar / US Dollar',   pip: 0.0001, decimals: 5 },
  { symbol: 'USDCAD', base: 'USD', quote: 'CAD', name: 'US Dollar / Canadian Dollar',     pip: 0.0001, decimals: 5 },
  { symbol: 'NZDUSD', base: 'NZD', quote: 'USD', name: 'New Zealand Dollar / US Dollar',  pip: 0.0001, decimals: 5 },

  // ── Yen Crosses ──
  { symbol: 'EURJPY', base: 'EUR', quote: 'JPY', name: 'Euro / Japanese Yen',             pip: 0.01,   decimals: 3 },
  { symbol: 'GBPJPY', base: 'GBP', quote: 'JPY', name: 'British Pound / Japanese Yen',   pip: 0.01,   decimals: 3 },
  { symbol: 'CHFJPY', base: 'CHF', quote: 'JPY', name: 'Swiss Franc / Japanese Yen',     pip: 0.01,   decimals: 3 },
  { symbol: 'AUDJPY', base: 'AUD', quote: 'JPY', name: 'Australian Dollar / Japanese Yen', pip: 0.01, decimals: 3 },
  { symbol: 'CADJPY', base: 'CAD', quote: 'JPY', name: 'Canadian Dollar / Japanese Yen',  pip: 0.01,   decimals: 3 },
  { symbol: 'NZDJPY', base: 'NZD', quote: 'JPY', name: 'New Zealand Dollar / Japanese Yen', pip: 0.01, decimals: 3 },

  // ── Euro Crosses ──
  { symbol: 'EURGBP', base: 'EUR', quote: 'GBP', name: 'Euro / British Pound',            pip: 0.0001, decimals: 5 },
  { symbol: 'EURAUD', base: 'EUR', quote: 'AUD', name: 'Euro / Australian Dollar',        pip: 0.0001, decimals: 5 },
  { symbol: 'EURCHF', base: 'EUR', quote: 'CHF', name: 'Euro / Swiss Franc',              pip: 0.0001, decimals: 5 },
  { symbol: 'EURCAD', base: 'EUR', quote: 'CAD', name: 'Euro / Canadian Dollar',          pip: 0.0001, decimals: 5 },
  { symbol: 'EURNZD', base: 'EUR', quote: 'NZD', name: 'Euro / New Zealand Dollar',       pip: 0.0001, decimals: 5 },

  // ── Pound & Other Crosses ──
  { symbol: 'GBPCHF', base: 'GBP', quote: 'CHF', name: 'British Pound / Swiss Franc',     pip: 0.0001, decimals: 5 },
  { symbol: 'GBPAUD', base: 'GBP', quote: 'AUD', name: 'British Pound / Australian Dollar', pip: 0.0001, decimals: 5 },
  { symbol: 'GBPCAD', base: 'GBP', quote: 'CAD', name: 'British Pound / Canadian Dollar', pip: 0.0001, decimals: 5 },
  { symbol: 'AUDCAD', base: 'AUD', quote: 'CAD', name: 'Australian Dollar / Canadian Dollar', pip: 0.0001, decimals: 5 },
  { symbol: 'AUDNZD', base: 'AUD', quote: 'NZD', name: 'Australian Dollar / New Zealand Dollar', pip: 0.0001, decimals: 5 },
  { symbol: 'AUDCHF', base: 'AUD', quote: 'CHF', name: 'Australian Dollar / Swiss Franc', pip: 0.0001, decimals: 5 },
  { symbol: 'CADCHF', base: 'CAD', quote: 'CHF', name: 'Canadian Dollar / Swiss Franc',   pip: 0.0001, decimals: 5 },

  // ── Liquid Exotics (ECB reference data) ──
  { symbol: 'USDSEK', base: 'USD', quote: 'SEK', name: 'US Dollar / Swedish Krona',       pip: 0.0001, decimals: 4 },
  { symbol: 'USDNOK', base: 'USD', quote: 'NOK', name: 'US Dollar / Norwegian Krone',     pip: 0.0001, decimals: 4 },
  { symbol: 'USDSGD', base: 'USD', quote: 'SGD', name: 'US Dollar / Singapore Dollar',    pip: 0.0001, decimals: 5 },
  { symbol: 'USDHKD', base: 'USD', quote: 'HKD', name: 'US Dollar / Hong Kong Dollar',    pip: 0.0001, decimals: 4 },
  { symbol: 'USDMXN', base: 'USD', quote: 'MXN', name: 'US Dollar / Mexican Peso',        pip: 0.0001, decimals: 4 },
  { symbol: 'USDZAR', base: 'USD', quote: 'ZAR', name: 'US Dollar / South African Rand',  pip: 0.0001, decimals: 4 },
];

const fmt = d => d.toISOString().split('T')[0];

/** Fetch historical daily closes for one pair */
async function fetchPairHistory(base, quote, days = 65) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const url = `${BASE_URL}/${fmt(start)}..${fmt(end)}?from=${base}&to=${quote}`;
  const { data } = await api.get(url, { timeout: 15000 });

  if (!data.rates) return [];
  return Object.entries(data.rates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rates]) => ({ date, price: rates[quote] }))
    .filter(d => d.price != null);
}

/** Fetch today's latest rate for one pair */
async function fetchLatestPrice(base, quote) {
  const { data } = await api.get(
    `${BASE_URL}/latest?from=${base}&to=${quote}`,
    { timeout: 15000 }
  );
  return data.rates?.[quote] ?? null;
}

/** Fetch history + latest for all pairs, batched to avoid overwhelming the connection */
async function fetchAllPairsData(days = 65, batchSize = 8) {
  const results = {};

  for (let i = 0; i < PAIRS.length; i += batchSize) {
    const batch = PAIRS.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async pair => {
        try {
          const [history, latest] = await Promise.all([
            fetchPairHistory(pair.base, pair.quote, days),
            fetchLatestPrice(pair.base, pair.quote),
          ]);

          const closes = history.map(h => h.price);
          const finalLatest = latest ?? closes[closes.length - 1] ?? null;

          results[pair.symbol] = {
            ...pair,
            history,
            closes,
            latest: finalLatest,
            fetchedAt: new Date(),
          };
        } catch (err) {
          console.error(`[market] Failed ${pair.symbol}: ${err.message}`);
        }
      })
    );
  }

  return results;
}

module.exports = { PAIRS, fetchPairHistory, fetchLatestPrice, fetchAllPairsData };