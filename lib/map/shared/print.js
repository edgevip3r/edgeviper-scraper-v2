
// lib/map/shared/print.js
// Standardised mapping debug printer (bettype-agnostic).
// It expects the mapper's result shape: { mapped: [], unmatched: [], details?: {} }.

function fmt(dt){
  if(!dt) return 'n/a';
  try { const d = new Date(dt);
    const y = d.getUTCFullYear(); const m = String(d.getUTCMonth()+1).padStart(2,'0');
    const da = String(d.getUTCDate()).padStart(2,'0'); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
    return `${y}-${m}-${da} ${hh}:${mm}Z`;
  } catch { return String(dt); }
}
function hoursFromNow(dt){
  if(!dt) return null;
  try { return (new Date(dt).getTime() - Date.now()) / 36e5; } catch { return null; }
}
function legLine(L){
  const ev = L.eventName || L.event || L.match || 'unknown event';
  const k = fmt(L.eventStart || L.koIso || L.startTime || L.kickoff);
  const comp = L.competition || L.league || '';
  const mk = L.marketId ? ` mkt=${L.marketId}` : '';
  const sel = L.selectionId ? ` sel=${L.selectionId}` : '';
  return `${L.team || L.label || ''} -> ${ev}${comp? ' ('+comp+')' : ''} @ ${k}${mk}${sel}`;
}

export function printMapperDebug(tag, legsIn, result, opts = {}){
  const maxFutureHrs = Number(process.env.EV_MAX_FUTURE_HOURS || (opts.horizonHours ?? 72));
  const details = result?.details || null;

  console.log(`[map:${tag}] legs=${(legsIn||[]).length} candidates=`);
  for (const L of (legsIn||[])){
    const team = L.team || L.label || L.name || '';
    const key = String(team).toLowerCase();
    const d = details ? (details[key] || details[team] || {}) : null;
    const cand = d && Array.isArray(d.candidates) ? d.candidates : null;
    const skipped = d && Array.isArray(d.skipped) ? d.skipped : [];
    const candLine = cand ? `candidates=${cand.length}${cand.length? ' -> '+cand.map(c=>c.name||c.event||c.match||'?').join(' | ') : ''}` : 'candidates=n/a';
    console.log(`  - ${team}: ${candLine}`);
    if (skipped && skipped.length) console.log(`    skipped: ` + skipped.map(s => `${s.name||'?'}:${s.reason || 'filtered'}`).join(' | '));
  }

  const mapped = Array.isArray(result?.mapped) ? result.mapped : [];
  if (mapped.length){
    for (const m of mapped){
      const h = hoursFromNow(m.eventStart || m.koIso);
      const far = (h!=null && h>maxFutureHrs) ? ` [SKIP:FUTURE +${Math.round(h)}h]` : '';
      console.log('    ✓ ' + legLine(m) + far + (m._marketTag ? ` [market=${m._marketTag}]` : ''));
    }
  }
  const unmatched = Array.isArray(result?.unmatched) ? result.unmatched : [];
  if (unmatched.length){
    console.log('    ✗ unmatched -> ' + unmatched.map(u => `${u.team||u.label||'?'}:${u.reason||'no-match'}`).join(' | '));
  }
}

export default { printMapperDebug };
