// lib/betfair/client.js
// Minimal Betfair JSON-RPC client using cert-based auth headers.
// Default endpoint can be overridden via BETFAIR_BETTING_URL.

import { getAuthHeaders, clearSessionCache } from './auth.js';

const BETTING_URL =
  process.env.BETFAIR_BETTING_URL ||
  'https://api.betfair.com/exchange/betting/json-rpc/v1';

// Build a single-call JSON-RPC 2.0 payload
function buildPayload(method, params) {
  return [{
    jsonrpc: '2.0',
    method: `SportsAPING/v1.0/${method}`,
    params: params || {},
    id: 1,
  }];
}

// Detect INVALID_SESSION_INFORMATION to trigger one re-login
function isInvalidSession(errObj) {
  if (!errObj) return false;
  const d = errObj.data?.APINGException || errObj.data;
  const code = d?.errorCode || errObj.errorCode || errObj.code;
  const msg = (d?.message || errObj.message || '').toString().toUpperCase();
  return code === 'INVALID_SESSION_INFORMATION' || msg.includes('INVALID_SESSION');
}

/**
 * Core RPC call with one automatic retry on invalid session.
 * @param {string} method - e.g. "listMarketCatalogue"
 * @param {object} params - method params
 * @param {object} [opts]
 * @param {boolean} [opts.retryOnInvalidSession=true]
 */
export async function rpc(method, params = {}, opts = {}) {
  const { retryOnInvalidSession = true } = opts;
  let headers = await getAuthHeaders();

  // 1st attempt
  let res = await fetch(BETTING_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildPayload(method, params)),
  });
  let text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  if (!res.ok || !Array.isArray(json)) {
    throw new Error(`RPC HTTP ${res.status} ${res.statusText} :: ${text}`);
  }

  const r0 = json[0];
  if (r0.error) {
    // One retry if invalid session
    if (retryOnInvalidSession && isInvalidSession(r0.error)) {
      await clearSessionCache();
      headers = await getAuthHeaders();
      res = await fetch(BETTING_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildPayload(method, params)),
      });
      text = await res.text();
      try { json = JSON.parse(text); } catch { json = null; }
      if (!res.ok || !Array.isArray(json)) {
        throw new Error(`RPC(retry) HTTP ${res.status} ${res.statusText} :: ${text}`);
      }
      const r1 = json[0];
      if (r1.error) throw new Error(`RPC(retry) ${method} error: ${JSON.stringify(r1.error)}`);
      return r1.result;
    }
    throw new Error(`RPC ${method} error: ${JSON.stringify(r0.error)}`);
  }

  return r0.result;
}

/**
 * listMarketCatalogue — supports BOTH signatures:
 *  A) legacy: listMarketCatalogue(filter, { marketProjection, sort, maxResults })
 *  B) modern: listMarketCatalogue({ marketIds?, filter?, marketProjection?, sort?, maxResults? })
 */
export async function listMarketCatalogue(arg1, arg2 = undefined) {
  const DEFAULT_PROJ = ['RUNNER_DESCRIPTION', 'EVENT', 'COMPETITION', 'MARKET_DESCRIPTION'];
  const DEFAULT_SORT = 'FIRST_TO_START';
  const DEFAULT_MAX  = 200;

  // Modern: single params object
  if (arg2 === undefined && arg1 && typeof arg1 === 'object' &&
      (Object.prototype.hasOwnProperty.call(arg1, 'marketIds') ||
       Object.prototype.hasOwnProperty.call(arg1, 'filter') ||
       Object.prototype.hasOwnProperty.call(arg1, 'eventIds') ||      // tolerate extra top-level keys
       Object.prototype.hasOwnProperty.call(arg1, 'eventTypeIds') ||
       Object.prototype.hasOwnProperty.call(arg1, 'competitionIds'))) {

    const {
      marketIds,
      filter = {},
      marketProjection = DEFAULT_PROJ,
      sort = DEFAULT_SORT,
      maxResults = DEFAULT_MAX
    } = arg1;

    const params = { filter, marketProjection, sort, maxResults };
    if (marketIds) params.marketIds = marketIds; // TOP-LEVEL as per Betfair API

    return rpc('listMarketCatalogue', params);
  }

  // Legacy: (filter, options)
  const filter = arg1 || {};
  const {
    marketProjection = DEFAULT_PROJ,
    sort = DEFAULT_SORT,
    maxResults = DEFAULT_MAX
  } = arg2 || {};

  return rpc('listMarketCatalogue', { filter, marketProjection, sort, maxResults });
}

/**
 * Convenience: listMarketBook (prices)
 * @param {string[]} marketIds
 * @param {object} [priceProjection]
 *   e.g. { priceData: ['EX_BEST_OFFERS'], virtualise: true, rolloverStakes: false }
 */
export async function listMarketBook(
  marketIds,
  priceProjection = { priceData: ['EX_BEST_OFFERS'] }
) {
  return rpc('listMarketBook', {
    marketIds,
    priceProjection
  });
}

export default { rpc, listMarketCatalogue, listMarketBook };