// lib/log/skiplog.js
// Structured skip/error logging to Google Sheets "Skipped" tab, with local JSONL fallback.
// - Use skipLogInit({ sheetId, tab }) once per run
// - Call skipLogWrite(entry) for each skip/unmatch/etc.
// - Call skipLogFlush({ dryRun }) at the end
//
// Columns (order):
// ts, stage, bookie, typeHint, reasonCode, reasonDetail, actionable,
// sourceUrl, snapshotRef, textRaw, oddsRaw, textClean, legsExtracted, mapDebug, uidOffer, uidSource

import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { google } from 'googleapis';
import cfg from '../../config/global.json' with { type: 'json' };

let _ctx = {
  sheetId: null,
  tab: 'Skipped',
  rows: [],
  jsonlPath: null,
};

export async function skipLogInit({ sheetId, tab } = {}) {
  _ctx.sheetId = sheetId || process.env.SKIPPED_SHEET_ID || process.env.BET_TRACKER_SHEET_ID || null;
  _ctx.tab = tab || cfg.logging?.skipSheetTab || 'Skipped';

  // Local JSONL fallback (e.g. ./logs/skip-YYYY-MM-DD.jsonl)
  const ptn = cfg.logging?.skipLogPath || './logs/skip-YYYY-MM-DD.jsonl';
  const today = new Date().toISOString().slice(0,10);
  _ctx.jsonlPath = path.resolve(ptn.replace('YYYY-MM-DD', today));

  // Ensure logs dir exists
  await fs.mkdir(path.dirname(_ctx.jsonlPath), { recursive: true }).catch(() => {});
}

export function skipLogWrite({
  stage = '', bookie = '', typeHint = '', reasonCode = '', reasonDetail = '', actionable = '',
  sourceUrl = '', snapshotRef = '', textRaw = '', oddsRaw = '', textClean = '',
  legsExtracted = '', mapDebug = '', uidOffer = '', uidSource = ''
} = {}) {
  const ts = new Date().toISOString();
  const row = [
    ts, stage, bookie, typeHint, reasonCode, reasonDetail, actionable,
    sourceUrl, snapshotRef, textRaw, oddsRaw, textClean, legsExtracted, mapDebug, uidOffer, uidSource
  ];
  _ctx.rows.push(row);

  // Also append to JSONL immediately (best-effort)
  const obj = { ts, stage, bookie, typeHint, reasonCode, reasonDetail, actionable,
                sourceUrl, snapshotRef, textRaw, oddsRaw, textClean, legsExtracted, mapDebug, uidOffer, uidSource };
  fss.appendFile(_ctx.jsonlPath, JSON.stringify(obj) + '\n', 'utf8', ()=>{});
}

export async function skipLogFlush({ dryRun = false } = {}) {
  if (!_ctx.rows.length) return { ok: true, written: 0, dryRun };
  if (dryRun || !_ctx.sheetId) {
    return { ok: true, written: 0, dryRun, note: dryRun ? 'dry-run: wrote JSONL only' : 'no sheetId: JSONL only' };
  }
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: _ctx.sheetId,
    range: `${_ctx.tab}!A:A`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: _ctx.rows }
  });
  const n = _ctx.rows.length;
  _ctx.rows = [];
  return { ok: true, written: n, dryRun: false };
}

export default { skipLogInit, skipLogWrite, skipLogFlush };