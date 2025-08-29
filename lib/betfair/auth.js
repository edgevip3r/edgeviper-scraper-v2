// lib/betfair/auth.js
// Cert-based, non-interactive Betfair auth with local token cache + keepAlive.
// Uses Node's https for certlogin (PFX or PEM) and fetch for keepAlive.

import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const APP_KEY    = process.env.BETFAIR_APP_KEY || '';
const USERNAME   = process.env.BETFAIR_USERNAME || '';
const PASSWORD   = process.env.BETFAIR_PASSWORD || '';
const PFX_PATH   = process.env.BETFAIR_PFX || '';
const PFX_PASS   = process.env.BETFAIR_PFX_PASSPHRASE || '';
const CERT_PATH  = process.env.BETFAIR_CERT || '';
const KEY_PATH   = process.env.BETFAIR_KEY || '';
const REGION     = (process.env.BETFAIR_REGION || 'com').toLowerCase(); // 'com', 'it', 'es', 'com.au'

if (!APP_KEY) console.warn('[betfair/auth] BETFAIR_APP_KEY is not set');
if (!USERNAME || !PASSWORD) console.warn('[betfair/auth] BETFAIR_USERNAME or BETFAIR_PASSWORD is not set');

const IDENTITY_CERT_HOST = `identitysso-cert.betfair.${REGION}`;
const IDENTITY_HOST      = `identitysso.betfair.${REGION}`;
const CERTLOGIN_PATH     = `/api/certlogin`;
const KEEPALIVE_URL      = `https://${IDENTITY_HOST}/api/keepAlive`;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const CACHE_DIR  = process.env.BETFAIR_SESSION_CACHE_DIR
  ? path.resolve(process.env.BETFAIR_SESSION_CACHE_DIR)
  : path.resolve(__dirname, '..', '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'betfair-session.json');

// Heuristics
const KEEPALIVE_POKE_MS   = 60 * 60 * 1000; // 60 min
const ABSOLUTE_EXPIRY_MS  = 10 * 60 * 60 * 1000; // 10 hours (conservative)
const DEBUG = !!process.env.DEBUG_BETFAIR;
const dbg = (...a) => { if (DEBUG) console.log('[betfair/auth]', ...a); };

// -------- internal helpers

async function readCache() {
  try { return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')); } catch { return null; }
}
async function writeCache(obj) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
}
function isCacheValid(c) {
  if (!c || !c.sessionToken || !c.obtainedAt) return false;
  return (Date.now() - new Date(c.obtainedAt).getTime()) < ABSOLUTE_EXPIRY_MS;
}
function needsKeepAlive(c) {
  if (!c || !c.sessionToken || !c.lastKeepAlive) return true;
  return (Date.now() - new Date(c.lastKeepAlive).getTime()) > KEEPALIVE_POKE_MS;
}

async function buildTlsOptions() {
  if (PFX_PATH) {
    if (!fss.existsSync(PFX_PATH)) throw new Error(`PFX not found at BETFAIR_PFX=${PFX_PATH}`);
    return { pfx: await fs.readFile(PFX_PATH), passphrase: PFX_PASS || undefined };
  }
  if (CERT_PATH && KEY_PATH) {
    if (!fss.existsSync(CERT_PATH)) throw new Error(`CERT not found at BETFAIR_CERT=${CERT_PATH}`);
    if (!fss.existsSync(KEY_PATH))  throw new Error(`KEY not found at BETFAIR_KEY=${KEY_PATH}`);
    return { cert: await fs.readFile(CERT_PATH), key: await fs.readFile(KEY_PATH) };
  }
  throw new Error('No client certificate configured. Set BETFAIR_PFX (+ BETFAIR_PFX_PASSPHRASE) OR BETFAIR_CERT + BETFAIR_KEY.');
}

function postHttps({ host, path, headers, body, tls }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host,
      method: 'POST',
      path,
      headers,
      ...tls
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// -------- main flows

async function certLogin() {
  const tls = await buildTlsOptions();
  const form = new URLSearchParams({ username: USERNAME, password: PASSWORD }).toString();

  const { statusCode, data } = await postHttps({
    host: IDENTITY_CERT_HOST,
    path: CERTLOGIN_PATH,
    headers: {
      'X-Application': APP_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(form)
    },
    body: form,
    tls
  });

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`certlogin failed: HTTP ${statusCode} :: ${data}`);
  }
  let json;
  try { json = JSON.parse(data); } catch { json = {}; }
  if (json.loginStatus !== 'SUCCESS' || !json.sessionToken) {
    throw new Error(`certlogin error: ${JSON.stringify(json)}`);
  }

  dbg('certlogin SUCCESS');
  const cache = {
    sessionToken: json.sessionToken,
    obtainedAt: new Date().toISOString(),
    lastKeepAlive: new Date().toISOString()
  };
  await writeCache(cache);
  return cache;
}

async function keepAlive(sessionToken) {
  const res = await fetch(KEEPALIVE_URL, {
    method: 'POST',
    headers: {
      'X-Application': APP_KEY,
      'X-Authentication': sessionToken
    }
  });
  const text = await res.text().catch(() => '');
  let json = {};
  try { json = JSON.parse(text); } catch {}
  const ok = json && (json.status === 'SUCCESS' || json.token || json.product || json.loginStatus === 'SUCCESS');
  return { ok, json, raw: text, status: res.status };
}

// -------- public API

export async function getSessionToken() {
  let cache = await readCache();
  if (cache && !isCacheValid(cache)) {
    dbg('cache hard-expired; re-login');
    cache = await certLogin();
  }
  if (!cache) {
    dbg('no cache; certlogin');
    cache = await certLogin();
  }
  if (needsKeepAlive(cache)) {
    dbg('keepAlive…');
    const ka = await keepAlive(cache.sessionToken);
    if (ka.ok) {
      cache.lastKeepAlive = new Date().toISOString();
      await writeCache(cache);
    } else {
      dbg('keepAlive failed; re-login', ka.status, ka.raw);
      cache = await certLogin();
    }
  }
  return cache.sessionToken;
}

export async function getAuthHeaders() {
  const token = await getSessionToken();
  return {
    'X-Application': APP_KEY,
    'X-Authentication': token,
    'Content-Type': 'application/json'
  };
}

export async function clearSessionCache() {
  try { await fs.unlink(CACHE_FILE); } catch {}
}

export default { getSessionToken, getAuthHeaders, clearSessionCache };