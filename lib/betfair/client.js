//
// lib/betfair/client.js
// Minimal Betfair JSON-RPC client using cert-based auth headers.
// Default endpoint can be overridden via BETFAIR_BETTING_URL.
//
import { getAuthHeaders, clearSessionCache } from './auth.js';

const BETTING_URL = process.env.BETFAIR_BETTING_URL || 'https://api.betfair.com/exchange/betting/json-rpc/v1';

// Tunables (env overrides)
const MAX_IDS_PER_CALL = Number(process.env.EV_BF_BOOK_CHUNK || 20);        // safer than 40
const MAX_CONCURRENCY  = Number(process.env.EV_BF_BOOK_CONCURRENCY || 2);   // polite parallelism
const BASE_BACKOFF_MS  = Number(process.env.EV_BF_BACKOFF_MS_BASE || 200);
const BEST_DEPTH       = Number(process.env.EV_BF_BEST_DEPTH || 1);
const VIRTUALISE       = String(process.env.EV_BF_VIRTUALISE || 'true').toLowerCase() === 'true';

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

// Detect Betfair APING TOO_MUCH_DATA
function isTooMuchData(errObj){
  const d = errObj?.data?.APINGException || errObj?.data || {};
  const code = d.errorCode || errObj?.errorCode || '';
  const msg  = (d.message || errObj?.message || '').toString().toUpperCase();
  return code === 'TOO_MUCH_DATA' || msg.includes('TOO_MUCH_DATA');
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
 * A) legacy: listMarketCatalogue(filter, { marketProjection, sort, maxResults })
 * B) modern: listMarketCatalogue({ marketIds?, filter?, marketProjection?, sort?, maxResults? })
 */
export async function listMarketCatalogue(arg1, arg2 = undefined) {
  const DEFAULT_PROJ = ['RUNNER_DESCRIPTION', 'EVENT', 'COMPETITION', 'MARKET_DESCRIPTION'];
  const DEFAULT_SORT = 'FIRST_TO_START';
  const DEFAULT_MAX = 200;

  // Modern: single params object
  if (arg2 === undefined && arg1 && typeof arg1 === 'object' && (
    Object.prototype.hasOwnProperty.call(arg1, 'marketIds') ||
    Object.prototype.hasOwnProperty.call(arg1, 'filter') ||
    Object.prototype.hasOwnProperty.call(arg1, 'eventIds') ||
    // tolerate extra top-level keys
    Object.prototype.hasOwnProperty.call(arg1, 'eventTypeIds') ||
    Object.prototype.hasOwnProperty.call(arg1, 'competitionIds')
  )){
    const { marketIds, filter = {}, marketProjection = DEFAULT_PROJ, sort = DEFAULT_SORT, maxResults = DEFAULT_MAX } = arg1;
    const params = { filter, marketProjection, sort, maxResults };
    if (marketIds) params.marketIds = marketIds; // TOP-LEVEL as per Betfair API
    return rpc('listMarketCatalogue', params);
  }

  // Legacy: (filter, options)
  const filter = arg1 || {};
  const { marketProjection = DEFAULT_PROJ, sort = DEFAULT_SORT, maxResults = DEFAULT_MAX } = arg2 || {};
  return rpc('listMarketCatalogue', { filter, marketProjection, sort, maxResults });
}

/**
 * Internal: listMarketBook for one chunk of marketIds with minimal price projection.
 */
async function listMarketBookOneChunk(ids, priceProjection){
  const proj = priceProjection && typeof priceProjection === 'object'
    ? priceProjection
    : { priceData: ['EX_BEST_OFFERS'] };

  // Enforce minimal data for mids
  if (!proj.priceData) proj.priceData = ['EX_BEST_OFFERS'];
  if (!proj.exBestOffersOverrides) proj.exBestOffersOverrides = {};
  if (typeof proj.exBestOffersOverrides.bestPricesDepth !== 'number') {
    proj.exBestOffersOverrides.bestPricesDepth = BEST_DEPTH; // 1 by default
  }
  if (typeof proj.virtualise !== 'boolean') proj.virtualise = VIRTUALISE;

  return rpc('listMarketBook', { marketIds: ids, priceProjection: proj });
}

/**
 * Convenience: listMarketBook (prices) — chunked to avoid TOO_MUCH_DATA.
 * @param {string[]} marketIds
 * @param {object} [priceProjection]  e.g. { priceData:['EX_BEST_OFFERS'], exBestOffersOverrides:{ bestPricesDepth:1 }, virtualise:true }
 * @returns {Promise<Array>} combined market books
 */
export async function listMarketBook(marketIds, priceProjection) {
  const ids = Array.from(new Set((marketIds || []).filter(Boolean)));
  if (!ids.length) return [];

  // Short path: small batches
  if (ids.length <= MAX_IDS_PER_CALL) {
    try {
      return await listMarketBookOneChunk(ids, priceProjection);
    } catch (e) {
      // If the only problem is TOO_MUCH_DATA, fall through to chunking/backoff
      try {
        const obj = JSON.parse((e && e.message || '{}').replace(/^RPC .* error:\s*/,'') || '{}');
        if (!isTooMuchData(obj)) throw e;
      } catch {
        // non-APING error, rethrow
        throw e;
      }
    }
  }

  // Chunk + throttle + backoff
  const chunks = [];
  for (let i=0; i<ids.length; i+=MAX_IDS_PER_CALL) chunks.push(ids.slice(i, i+MAX_IDS_PER_CALL));

  const results = [];
  let delay = BASE_BACKOFF_MS;

  for (const group of chunks){
    // Attempt once; if TOO_MUCH_DATA, split further and retry
    try {
      const r = await listMarketBookOneChunk(group, priceProjection);
      results.push(...r);
    } catch (e) {
      let errObj = null;
      try { errObj = JSON.parse((e && e.message || '{}').replace(/^RPC .* error:\s*/,'') || '{}'); } catch {}
      if (!isTooMuchData(errObj)) throw e;

      // Split the chunk into halves and retry sequentially with backoff
      const g1 = group.slice(0, Math.ceil(group.length/2));
      const g2 = group.slice(Math.ceil(group.length/2));
      await new Promise(res => setTimeout(res, delay));
      const r1 = await listMarketBookOneChunk(g1, priceProjection);
      await new Promise(res => setTimeout(res, delay));
      const r2 = await listMarketBookOneChunk(g2, priceProjection);
      results.push(...r1, ...r2);

      // Increase delay slightly with jitter
      delay = Math.min(delay * 1.5 + Math.floor(Math.random()*50), 2000);
    }
  }

  return results;
}

export default { rpc, listMarketCatalogue, listMarketBook };
