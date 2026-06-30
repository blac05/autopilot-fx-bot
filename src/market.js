'use strict';

const axios = require('axios');

const BASE_URL = 'https://api.frankfurter.app';

/** All tracked forex pairs */
const PAIRS = [
  { symbol: 'EURUSD', base: 'EUR', quote: 'USD', name: 'Euro / US Dollar',                pip: 0.0001, decimals: 5 },
  { symbol: 'USDCHF', base: 'USD', quote: 'CHF', name: 'US Dollar / Swiss Franc',         pip: 0.0001, decimals: 5 },
  { symbol: 'GBPUSD', base: 'GBP', quote: 'USD', name: 'British Pound / US Dollar',       pip: 0.0001, decimals: 5 },
  { symbol: 'USDJPY', base: 'USD', quote: 'JPY', name: 'US Dollar / Japanese Yen',        pip: 0.01,   decimals: 3 },
  { symbol: 'AUDUSD', base: 'AUD', quote: 'USD', name: 'Australian Dollar / US Dollar',   pip: 0.0001, decimals: 5 },
  { symbol: 'USDCAD', base: 'USD', quote: 'CAD', name: 'US Dollar / Canadian Dollar',     pip: 0.0001, decimals: 5 },
  { symbol: 'NZDUSD', base: 'NZD', quote: 'USD', name: 'New Zealand Dollar / US Dollar',  pip: 0.0001, decimals: 5 },
  { symbol: 'EURJPY', base: 'EUR', quote: 'JPY', name: 'Euro / Japanese Yen',             pip: 0.01,   decimals: 3 },
  { symbol: 'GBPJPY', base: 'GBP', quote: 'JPY', name: 'British Pound / Japanese Yen',   pip: 0.01,   decimals: 3 },
  { symbol: 'EURGBP', base: 'EUR', quote: 'GBP', name: 'Euro / British Pound',            pip: 0.0001, decimals: 5 },
  { symbol: 'EURAUD', base: 'EUR', quote: 'AUD', name: 'Euro / Australian Dollar',        pip: 0.0001, decimals: 5 },
  { symbol: 'CHFJPY', base: 'CHF', quote: 'JPY', name: 'Swiss Franc / Japanese Yen',     pip: 0.01,   decimals: 3 },
];

const fmt = d => d.toISOString().split('T')[0];

/** Fetch historical daily closes for one pair */
async function fetchPairHistory(base, quote, days = 65) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const url = `${BASE_URL}/${fmt(start)}..${fmt(end)}?from=${base}&to=${quote}`;
  const { data } = await axios.get(url, { timeout: 12000 });

  if (!data.rates) return [];
  return Object.entries(data.rates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rates]) => ({ date, price: rates[quote] }))
    .filter(d => d.price != null);
}

/** Fetch today's latest rate for one pair */
async function fetchLatestPrice(base, quote) {
  const { data } = await axios.get(
    `${BASE_URL}/latest?from=${base}&to=${quote}`,
    { timeout: 8000 }
  );
  return data.rates?.[quote] ?? null;
}

/** Fetch history + latest for all pairs concurrently */
async function fetchAllPairsData(days = 65) {
  const results = {};

  await Promise.allSettled(
    PAIRS.map(async pair => {
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

  return results;
}

module.exports = { PAIRS, fetchPairHistory, fetchLatestPrice, fetchAllPairsData };
