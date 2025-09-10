
// bettypes/FOOTBALL_MULTI_AND/mapper.js
// Multi-leg orchestrator that delegates each leg to the appropriate mapper/resolver.
// Now supports WIN_TO_NIL legs (Task 2), alongside MO_TEAM_WIN, MO_DRAW, and MO_BTTS_SGM.
import { mapAllToWinLegs } from '../../lib/map/betfair-football.js';
import { printMapperDebug } from '../../lib/map/shared/print.js';

// Delegate to existing bettype mappers to avoid duplication.
import { map as mapTeamToDraw } from '../FOOTBALL_TEAM_TO_DRAW/mapper.js';
import { map as mapSgmMoBtts } from '../FOOTBALL_SGM_MO_BTTS/mapper.js';
import { map as mapWinToNil } from '../FOOTBALL_WIN_TO_NIL/mapper.js';

function normKind(x){
  const k = String(x||'').toUpperCase();
  if (k === 'FOOTBALL_TEAM_WIN') return 'MO_TEAM_WIN';
  if (k === 'FOOTBALL_TEAM_TO_DRAW' || k === 'MO_DRAW') return 'MO_DRAW';
  if (k === 'FOOTBALL_SGM_MO_BTTS' || k === 'WIN_AND_BTTS' || k === 'MO_BTTS_SGM') return 'MO_BTTS_SGM';
  if (k === 'FOOTBALL_WIN_TO_NIL' || k === 'WIN_TO_NIL') return 'WIN_TO_NIL';
  return k;
}

function teamOf(L){ return L.team || L.label || L.name || ''; }

export async function map(offer, ctx = {}){
  const debug = !!ctx.debug;
  const maxFutureHrs = Number(process.env.EV_MAX_FUTURE_HOURS || (ctx.maxFutureHours ?? 72));

  const legsIn = (offer.legs || []).map(L => ({
    team: teamOf(L),
    kind: normKind(L.kind || L.betKind || L.type || L.typeId)
  }));

  const out = { mapped: [], unmatched: [] };

  for (const leg of legsIn){
    const { team, kind } = leg;
    if (!team) { out.unmatched.push({ team: '', reason: 'NO_TEAM' }); continue; }

    if (kind === 'MO_TEAM_WIN' || !kind){
      // default to team win if kind missing (legacy multi-and)
      const mo = await mapAllToWinLegs([{ team }], { debug:false, bookie: ctx.bookie, horizonHours: maxFutureHrs });
      if (mo?.mapped?.length) out.mapped.push({ ...mo.mapped[0], _marketTag:'MO:WIN' });
      else out.unmatched.push({ team, reason: (mo?.unmatched?.[0]?.reason || 'NO_MO_MAPPING') });
      continue;
    }

    if (kind === 'MO_DRAW'){
      const res = await mapTeamToDraw({ legs:[{ team }] }, { ...ctx, debug:false });
      if (res?.mapped?.length) out.mapped.push(res.mapped[0]);
      else out.unmatched.push({ team, reason: (res?.unmatched?.[0]?.reason || 'NO_DRAW_MAPPING') });
      continue;
    }

    if (kind === 'MO_BTTS_SGM'){
      const res = await mapSgmMoBtts({ legs:[{ team }] }, { ...ctx, debug:false });
      if (res?.mapped?.length) out.mapped.push(res.mapped[0]);
      else out.unmatched.push({ team, reason: (res?.unmatched?.[0]?.reason || 'NO_SGM_MAPPING') });
      continue;
    }

    if (kind === 'WIN_TO_NIL'){
      const res = await mapWinToNil({ legs:[{ team }] }, { ...ctx, debug:false });
      if (res?.mapped?.length) out.mapped.push(res.mapped[0]);
      else out.unmatched.push({ team, reason: (res?.unmatched?.[0]?.reason || 'NO_WTN_MAPPING') });
      continue;
    }

    out.unmatched.push({ team, reason: `UNKNOWN_LEG_KIND:${kind}` });
  }

  if (debug){
    printMapperDebug('FOOTBALL_MULTI_AND', legsIn, out, { horizonHours: maxFutureHrs });
  }
  return out;
}

export default { map };
