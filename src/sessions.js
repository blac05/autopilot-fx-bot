'use strict';

const SESSIONS = [
  {
    name:      'Sydney',
    emoji:     '🦘',
    open:      22,
    close:     7,
    pairs:     ['AUDUSD', 'NZDUSD'],
    liquidity: 'LOW',
  },
  {
    name:      'Tokyo',
    emoji:     '🗾',
    open:      0,
    close:     9,
    pairs:     ['USDJPY', 'EURJPY', 'GBPJPY', 'CHFJPY', 'AUDUSD'],
    liquidity: 'MEDIUM',
  },
  {
    name:      'London',
    emoji:     '🇬🇧',
    open:      8,
    close:     17,
    pairs:     ['EURUSD', 'GBPUSD', 'EURGBP', 'USDCHF', 'EURJPY', 'EURAUD'],
    liquidity: 'HIGH',
  },
  {
    name:      'New York',
    emoji:     '🗽',
    open:      13,
    close:     22,
    pairs:     ['EURUSD', 'GBPUSD', 'USDCAD', 'USDCHF', 'NZDUSD'],
    liquidity: 'HIGH',
  },
];

function isActive(session, utcHour) {
  if (session.open < session.close) {
    return utcHour >= session.open && utcHour < session.close;
  }
  // Wraps midnight (e.g. Sydney 22-07)
  return utcHour >= session.open || utcHour < session.close;
}

function getActiveSessions(utcHour) {
  return SESSIONS.filter(s => isActive(s, utcHour));
}

function getPairLiquidity(symbol, utcHour) {
  const active = getActiveSessions(utcHour).filter(s => s.pairs.includes(symbol));
  if (active.length >= 2) return 'HIGH';
  if (active.length === 1) return active[0].liquidity;
  return 'LOW';
}

function getMarketOverlap(utcHour) {
  const active = getActiveSessions(utcHour);
  if (active.length >= 2) {
    return active.map(s => `${s.emoji} ${s.name}`).join(' + ') + ' Overlap 🔥';
  }
  return null;
}

function getNextSession(utcHour) {
  for (const s of SESSIONS) {
    if (s.open > utcHour) return { session: s, hoursUntil: s.open - utcHour };
  }
  // Wraps to next day
  return { session: SESSIONS[0], hoursUntil: 24 - utcHour + SESSIONS[0].open };
}

module.exports = { SESSIONS, getActiveSessions, getPairLiquidity, getMarketOverlap, getNextSession };
