//
// bettypes/FOOTBALL_MULTI_AND/mapper.js
// v3 — Clean, legacy-proven routing
//  - TEAM WIN legs → BF.mapAllToWinLegs (batch)  ✅
//  - SGM MO+BTTS   → BF.mapMatchOddsAndBTTS (per-leg) ✅
//  - DRAW          → FOOTBALL_TEAM_TO_DRAW mapper ✅
//  - WIN TO NIL    → FOOTBALL_WIN_TO_NIL mapper ✅
// Exports: map(offer, ctx)
//
import * as BF from '../../lib/map/betfair-football.js';
import { printMapperDebug } from '../../lib/map/shared/print.js';

import { map as mapTeamToDraw } from '../FOOTBALL_TEAM_TO_DRAW/mapper.js';
import { map as mapSgmMoBtts }  from '../FOOTBALL_SGM_MO_BTTS/mapper.js';
import { map as mapWinToNil }   from '../FOOTBALL_WIN_TO_NIL/mapper.js';

const norm = s => String(s||'').trim();
function kindOf(k){
  const K = String(k||'').toUpperCase();
  if (K === 'FOOTBALL_TEAM_WIN') return 'MO_TEAM_WIN';
  if (K === 'FOOTBALL_TEAM_TO_DRAW' || K === 'MO_DRAW') return 'MO_DRAW';
  if (K === 'FOOTBALL_SGM_MO_BTTS' || K === 'WIN_AND_BTTS' || K === 'MO_BTTS_SGM') return 'MO_BTTS_SGM';
  if (K === 'FOOTBALL_WIN_TO_NIL' || K === 'WIN_TO_NIL') return 'WIN_TO_NIL';
  return K || 'MO_TEAM_WIN'; // default to win for legacy multi-and legs with no kind
}

export async function map(offer, ctx = {}){
  const debug = !!ctx.debug;
  const maxFutureHours = Number(process.env.EV_MAX_FUTURE_HOURS || (ctx.maxFutureHours ?? 72));
  const legs = (offer?.legs || []).map(L => ({ team: norm(L.team || L.label || L.name), kind: kindOf(L.kind || L.betKind || L.type || L.typeId) }));

  const out = { mapped: [], unmatched: [] };

  // 1) TEAM WINS in one batch via legacy-proven mapper
  const winLegs = legs.filter(L => L.kind === 'MO_TEAM_WIN' && L.team);
  if (winLegs.length){
    try {
      const res = await BF.mapAllToWinLegs(winLegs.map(L => ({ team: L.team })), { bookie: ctx.bookie, maxFutureHours, debug:false });
      // BF.mapAllToWinLegs returns { mapped:[], unmatched:[] } (and may include per-leg reasons)
      if (Array.isArray(res?.mapped)) out.mapped.push(...res.mapped);
      if (Array.isArray(res?.unmatched)) out.unmatched.push(...res.unmatched);
      // Mark market tag for clarity
      for (const m of out.mapped.slice(-winLegs.length)) m._marketTag = m._marketTag || 'MO:WIN';
    } catch (e){
      for (const L of winLegs) out.unmatched.push({ team:L.team, reason:`ERROR(${e?.message||e})` });
    }
  }

  // 2) SGM MO+BTTS (per leg)
  const sgmLegs = legs.filter(L => L.kind === 'MO_BTTS_SGM' && L.team);
  for (const L of sgmLegs){
    try {
      const r = await mapSgmMoBtts({ legs:[{ team:L.team }] }, { ...ctx, debug:false, maxFutureHours });
      if (r?.mapped?.length) out.mapped.push({ ...r.mapped[0], _marketTag:'SGM:MO+BTTS' });
      else out.unmatched.push({ team:L.team, reason:(r?.unmatched?.[0]?.reason || 'NO_SGM_MAPPING') });
    } catch (e){
      out.unmatched.push({ team:L.team, reason:`ERROR(${e?.message||e})` });
    }
  }

  // 3) DRAW (per leg)
  const drawLegs = legs.filter(L => L.kind === 'MO_DRAW' && L.team);
  for (const L of drawLegs){
    try {
      const r = await mapTeamToDraw({ legs:[{ team:L.team }] }, { ...ctx, debug:false, maxFutureHours });
      if (r?.mapped?.length) out.mapped.push(r.mapped[0]);
      else out.unmatched.push({ team:L.team, reason:(r?.unmatched?.[0]?.reason || 'NO_DRAW_MAPPING') });
    } catch (e){
      out.unmatched.push({ team:L.team, reason:`ERROR(${e?.message||e})` });
    }
  }

  // 4) WIN TO NIL (per leg)
  const wtnLegs = legs.filter(L => L.kind === 'WIN_TO_NIL' && L.team);
  for (const L of wtnLegs){
    try {
      const r = await mapWinToNil({ legs:[{ team:L.team }] }, { ...ctx, debug:false, maxFutureHours });
      if (r?.mapped?.length) out.mapped.push(r.mapped[0]);
      else out.unmatched.push({ team:L.team, reason:(r?.unmatched?.[0]?.reason || 'NO_WTN_MAPPING') });
    } catch (e){
      out.unmatched.push({ team:L.team, reason:`ERROR(${e?.message||e})` });
    }
  }

  // 5) Any legs with missing team or unknown kind
  for (const L of legs){
    if (!L.team) out.unmatched.push({ team:'', reason:'NO_TEAM' });
    // Unknown kinds are currently ignored; composer should ensure kinds
  }

  if (debug){
    printMapperDebug('FOOTBALL_MULTI_AND', legs, out, { maxFutureHours });
  }
  return out;
}

export default { map };
