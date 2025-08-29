// lib/publish/sheets.bettracker.js
import { google } from 'googleapis';

async function getSheets() {
  const auth = await new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * Append rows starting at the first row where Column A is empty,
 * writing ONLY our owned columns (A,C,D,E,F,G,H,I,L,N,AA) to avoid clobbering formulas.
 *
 * rows: the same arrays you're already building in run.publish.js
 * (we pull values out of the correct indices for each target column)
 */
export async function publishRows(rows, { sheetId, tab, dryRun = false }) {
  if (!sheetId) throw new Error('publishRows: sheetId missing');
  if (!tab) throw new Error('publishRows: tab missing');

  const sheets = await getSheets();

  // Verify the tab exists
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties(title,sheetId)',
  });
  const tabs = (meta.data.sheets || []).map(s => s.properties?.title);
  if (!tabs.includes(tab)) {
    throw new Error(`publishRows: tab "${tab}" not found. Available tabs: ${tabs.join(', ') || '(none)'}`);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: true, written: 0, updatedRange: null, dryRun };
  }

  // 1) Find the first empty row in Column A
  // (Values API returns up to the last non-empty cell in A)
  const aCol = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!A:A`,
  });
  const firstEmptyRow = (aCol.data.values?.length || 0) + 1; // 1-based
  const start = firstEmptyRow;
  const end = start + rows.length - 1;

  // 2) Build column-wise payloads (write only A,C,D,E,F,G,H,I,L,N,AA)
  //    Pull values from your existing row arrays by index.
  //    NOTE: your run.publish.js currently places URL at index 14 (column O).
  //    We correct that here by writing the URL into N regardless of where it sits in the array.
  const get = (row, idx) => (row[idx] ?? '');
  const pickUrl = (row) => row[13] || row[14] || ''; // prefer N (13), fallback O (14) as per your current script
  const pickUid = (row) => row[26] || row[row.length - 1] || '';

  const colA = rows.map(r => get(r, 0));   // A
  const colC = rows.map(r => get(r, 2));   // C
  const colD = rows.map(r => get(r, 3));   // D
  const colE = rows.map(r => get(r, 4));   // E
  const colF = rows.map(r => get(r, 5));   // F
  const colG = rows.map(r => get(r, 6));   // G
  const colH = rows.map(r => get(r, 7));   // H
  const colI = rows.map(r => get(r, 8));   // I
  const colL = rows.map(r => get(r, 11));  // L
  const colN = rows.map(r => pickUrl(r));  // N (corrects current script’s O-placement)
  const colAA = rows.map(r => pickUid(r)); // AA

  const data = [
    vr(`${tab}!A${start}:A${end}`, [colA]),
    vr(`${tab}!C${start}:C${end}`, [colC]),
    vr(`${tab}!D${start}:D${end}`, [colD]),
    vr(`${tab}!E${start}:E${end}`, [colE]),
    vr(`${tab}!F${start}:F${end}`, [colF]),
    vr(`${tab}!G${start}:G${end}`, [colG]),
    vr(`${tab}!H${start}:H${end}`, [colH]),
    vr(`${tab}!I${start}:I${end}`, [colI]),
    vr(`${tab}!L${start}:L${end}`, [colL]),
    vr(`${tab}!N${start}:N${end}`, [colN]),
    vr(`${tab}!AA${start}:AA${end}`, [colAA]),
  ];

  if (dryRun) {
    return {
      ok: true,
      written: 0,
      updatedRange: `${tab}!A${start}:AA${end}`,
      dryRun: true,
      note: 'dry-run: prepared batchUpdate for A,C,D,E,F,G,H,I,L,N,AA',
    };
  }

  // 3) Batch update the specific columns
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data,
    },
  });

  return {
    ok: true,
    written: rows.length,
    updatedRange: `${tab}!A${start}:AA${end}`,
    dryRun: false,
  };
}

function vr(range, valuesColumns) {
  // valuesColumns with majorDimension=COLUMNS means each inner array is a full column down the range.
  return { range, majorDimension: 'COLUMNS', values: valuesColumns };
}

export default publishRows;