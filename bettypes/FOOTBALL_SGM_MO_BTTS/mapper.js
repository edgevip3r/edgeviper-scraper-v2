// bettypes/FOOTBALL_SGM_MO_BTTS/mapper.js — MO-anchored SGM mapping
import { mapAllToWinLegs, mapWinAndBttsLegs } from '../../lib/map/betfair-football.js';

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
function roughlySameKickoff(a,b){
  try { const ta = new Date(a).getTime(); const tb = new Date(b).getTime(); return Math.abs(ta - tb) <= 90*60*1000; } catch { return false; }
}

export async function map(offer, ctx = {}){
  const debug = !!ctx.debug;
  const bookie = ctx.bookie;
  const maxFutureHrs = Number(process.env.EV_MAX_FUTURE_HOURS || (ctx.maxFutureHours ?? 72));
  const legsIn = (offer.legs || []).map(L => ({ team: L.team || L.label || L.name || '' }));

  // 1) Anchor via MO
  const mo = await mapAllToWinLegs(legsIn, { debug: false, bookie, horizonHours: maxFutureHrs });
  const moByTeam = new Map();
  for (const m of mo?.mapped || []) moByTeam.set(String(m.team||'').toLowerCase(), m);

  // 2) Try SGM bulk
  let sgm = await mapWinAndBttsLegs(legsIn, { debug: false, bookie, horizonHours: maxFutureHrs });
  let mapped = Array.isArray(sgm?.mapped) ? [...sgm.mapped] : [];
  let unmatched = Array.isArray(sgm?.unmatched) ? [...sgm.unmatched] : [];

  // 2b) Per-leg retry (some libs search better per call)
  for (const L of legsIn){
    const tkey = String(L.team||'').toLowerCase();
    const already = mapped.some(x => String(x.team||'').toLowerCase()===tkey);
    if (already) continue;
    const partial = await mapWinAndBttsLegs([L], { debug: false, bookie, horizonHours: maxFutureHrs });
    if (Array.isArray(partial?.mapped) && partial.mapped.length){
      mapped.push(partial.mapped[0]);
      unmatched = unmatched.filter(u => String(u.team||'').toLowerCase() !== tkey);
    }
  }

  // 3) Event sanity vs MO anchor
  const outMapped = [];
  for (const m of mapped){
    const tkey = String(m.team||'').toLowerCase();
    const moLeg = moByTeam.get(tkey);
    if (moLeg && m.eventStart && moLeg.eventStart && !roughlySameKickoff(m.eventStart, moLeg.eventStart)){
      if (debug){
        console.log(`    ⚠ SGM_EVENT_MISMATCH ${m.team}: SGM @ ${fmt(m.eventStart)} vs MO @ ${fmt(moLeg.eventStart)} — continuing with SGM result`);
      }
    }
    outMapped.push(m);
  }

  // 4) If MO exists but SGM missing, log it explicitly
  if (debug){
    console.log(`[map:FOOTBALL_SGM_MO_BTTS] legs=${legsIn.length}`);
    for (const L of legsIn){
      const tkey = String(L.team||'').toLowerCase();
      const moLeg = moByTeam.get(tkey);
      const sgmLeg = outMapped.find(x => String(x.team||'').toLowerCase() === tkey);
      if (moLeg && !sgmLeg){
        const h = hoursFromNow(moLeg.eventStart || moLeg.koIso);
        const far = (h!=null && h>maxFutureHrs) ? ` [SKIP:FUTURE +${Math.round(h)}h]` : '';
        console.log(`    ⚠ MO_OK_SGM_MISSING ${legLine(moLeg)}${far}`);
      }
    }
    for (const m of outMapped){
      const h = hoursFromNow(m.eventStart || m.koIso);
      const far = (h!=null && h>maxFutureHrs) ? ` [SKIP:FUTURE +${Math.round(h)}h]` : '';
      console.log('    ✓ ' + legLine(m) + far + ' [market=SGM:MO+BTTS]');
    }
    if (unmatched.length){
      console.log('    ✗ unmatched -> ' + unmatched.map(u => `${u.team}:${u.reason||'no-match'}`).join(' | '));
    }
  }

  return { mapped: outMapped, unmatched };
}

export default { map };