// bettypes/FOOTBALL_WIN_TO_NIL/mapper.js — map against "<Team> Win To Nil" (Yes) market
import { mapWinToNilLegs } from '../../lib/map/betfair-football.js';

function fmt(dt){
  if(!dt) return 'n/a';
  try {
    const d = new Date(dt);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth()+1).padStart(2,'0');
    const da = String(d.getUTCDate()).padStart(2,'0');
    const hh=String(d.getUTCHours()).padStart(2,'0');
    const mm=String(d.getUTCMinutes()).padStart(2,'0');
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

export async function map(offer, ctx = {}) {
  const debug = !!ctx.debug;
  const maxFutureHrs = Number(process.env.EV_MAX_FUTURE_HOURS || (ctx.maxFutureHours ?? 72));

  const legsIn = (offer.legs || []).map(L => ({ team: L.team || L.label || L.name || '' }));
  const res = await mapWinToNilLegs(legsIn, { debug: false, horizonHours: maxFutureHrs });
  const mapped = Array.isArray(res?.mapped) ? res.mapped : [];
  const unmatched = Array.isArray(res?.unmatched) ? res.unmatched : [];

  if (debug) {
    console.log(`[map:FOOTBALL_WIN_TO_NIL] legs=${legsIn.length}`);
    if (mapped.length){
      for (const m of mapped){
        const h = hoursFromNow(m.eventStart || m.koIso);
        const far = (h!=null && h>maxFutureHrs) ? ` [SKIP:FUTURE +${Math.round(h)}h]` : '';
        console.log(' ✓ ' + legLine(m) + far + ' [market=WIN_TO_NIL:Yes]');
      }
    }
    if (unmatched.length){
      console.log(' ✗ unmatched -> ' + unmatched.map(u => `${u.team}:${u.reason||'no-match'}`).join(' | '));
    }
  }

  return { mapped: mapped || [], unmatched: unmatched || [] };
}

export default { map };
