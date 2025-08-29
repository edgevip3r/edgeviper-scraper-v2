// bettypes/WIN_AND_BTTS/extractor.js
// Extract teams from titles like:
//  - "Bayern & PSG Both To Win & All 4 Teams To Score"
//  - "Chelsea, Inter & Milan to win & BTTS"
//  - "Arsenal & Spurs Win & BTTS in each game"
function normalize(s){ return String(s||'').replace(/\s+/g,' ').trim(); }

function splitTeams(prefix, original){
  const pre = prefix.replace(/\s*&\s*/gi, ',').replace(/\s+and\s+/gi, ',').replace(/\s*\+\s*/g, ',');
  const parts = pre.split(',').map(x=>x.trim()).filter(Boolean);
  const legs = []; let cursor=0;
  for (const p of parts) {
    const idx = original.toLowerCase().indexOf(p.toLowerCase(), cursor);
    if (idx>=0){ legs.push(original.slice(idx, idx+p.length).trim()); cursor = idx+p.length; }
    else legs.push(p);
  }
  const seen = new Set();
  return legs.filter(t=>{const k=t.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return t.length>=2;});
}

async function classify(title /*, ctx */){
  const original = normalize(title);

  // Reject obvious non-type
  if (/anytime\s*scorer/i.test(original)) return { match:false, legs:[], reason:'SCORER' };

  // Take everything before the "win & btts" anchor
  const reList = [
    /^(.*?)(?:\s*(?:both|all)?\s*to\s*win\s*&\s*(?:all\s*\d+\s*teams\s*to\s*score|btts(?:\s*in\s*each)?))/i,
    /^(.*?)(?:\s*to\s*win\s*&\s*(?:both\s*teams\s*to\s*score|btts))/i,
    /^(.*?)(?:\s*win\s*&\s*btts)/i
  ];
  let prefix=null;
  for (const re of reList) { const m=original.match(re); if (m) { prefix=m[1]; break; } }
  if (!prefix) prefix = original;

  const legs = splitTeams(prefix, original);
  return legs.length>=2 ? { match:true, legs } : { match:false, legs:[], reason:'legs<2' };
}

export default { classify };