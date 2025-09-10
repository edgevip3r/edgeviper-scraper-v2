// bettypes/FOOTBALL_MULTI_AND/mapper.js
import path from 'path'; import { pathToFileURL } from 'url'; import fs from 'fs';
async function importIfExists(p){ try{ return await import(pathToFileURL(p).href) }catch { return null } }

export async function map(offer, ctx = {}) {
  const debug = !!ctx.debug;
  const out = { mapped: [], unmatched: [] };
  const legs = Array.isArray(offer.legs) ? offer.legs : [];

  for (let i = 0; i < legs.length; i++) {
    const L = legs[i]; const kind = String(L?.kind || '').trim(); const params = L?.params || {};
    if (!kind) continue;

    // Normalise sub-offer legs
    let subOffer;
    if (kind === 'FOOTBALL_TEAM_WIN') {
      const teams = Array.isArray(params.teams) ? params.teams : (params.team ? [params.team] : []);
      subOffer = { legs: teams.map(t => ({ team: t })) };
    } else if (kind === 'WIN_AND_BTTS' || kind === 'FOOTBALL_SGM_MO_BTTS' || kind === 'FOOTBALL_WIN_TO_NIL') {
      const team = params.team || (Array.isArray(params.teams) ? params.teams[0] : '');
      subOffer = { legs: [{ team }] };
    } else if (kind === 'ALL_TO_WIN') {
      const teams = Array.isArray(params.teams) ? params.teams : [];
      subOffer = { legs: teams.map(t => ({ team: t })) };
    } else {
      const teams = Array.isArray(params.teams) ? params.teams : (params.team ? [params.team] : []);
      subOffer = { legs: teams.map(t => ({ team: t })) };
    }

    // Resolve mapper path(s)
    const tryKinds = [kind];
    if (kind === 'FOOTBALL_TEAM_WIN') tryKinds.push('ALL_TO_WIN');
    if (kind === 'FOOTBALL_SGM_MO_BTTS') tryKinds.push('WIN_AND_BTTS');
    const tried = [];
    let mod = null;
    for (const k of tryKinds) {
      const p = path.resolve('bettypes', k, 'mapper.js');
      tried.push(p);
      if (fs.existsSync(p)) { mod = await importIfExists(p); if (mod) break; }
    }
    if (!mod || !mod.map) {
      out.unmatched.push({ kind, reason: 'MAPPER_NOT_FOUND', tried: tried.map(x=>x.replace(process.cwd()+'/','')) });
      if (debug) console.log(`[multi_and] ${kind} -> MAPPER_NOT_FOUND`);
      continue;
    }

    try {
      const res = await mod.map(subOffer, ctx);
      (res?.mapped || []).forEach(m => out.mapped.push({ ...m, _kind: kind }));
      (res?.unmatched || []).forEach(u => out.unmatched.push({ ...u, _kind: kind }));
    } catch (e) {
      out.unmatched.push({ kind, reason: 'SUBMAP_ERROR', error: String(e?.message || e) });
      if (debug) console.log(`[multi_and] ${kind} -> SUBMAP_ERROR:`, e?.message || e);
    }
  }

  if (debug) {
    const unm = (out.unmatched||[]).map(u => `${u._kind||'?'}:${u.team||u.reason}`).join(' | ') || 'none';
    console.log(`[map:FOOTBALL_MULTI_AND] done -> mapped=${out.mapped.length}/${offer.legs?.length||0}; unmatched: ${unm}`);
  }
  return out;
}
export default { map };
