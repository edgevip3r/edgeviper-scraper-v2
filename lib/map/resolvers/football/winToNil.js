// lib/map/resolvers/football/winToNil.js
// Resolver family: football/WinToNil
// Book-agnostic. Prefer composite Betfair market (To Win to Nil).
// Selection is the TEAM runner in that market.

import { listMarketCatalogue } from '../../../betfair/client.js';
import fs from 'fs';
import path from 'path';

const SOCCER_EVENT_TYPE_ID = '1';

function nowIso(offsetMs = 0){ return new Date(Date.now() + offsetMs).toISOString(); }
function canon(s){ return String(s || '').toLowerCase().replace(/[\s\u00A0]+/g, ' ').trim(); }
function normalizeForWordish(s){
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function wordishContains(hay, needle){
  const H=' '+normalizeForWordish(hay)+' '; const N=' '+normalizeForWordish(needle)+' ';
  return N.trim() ? H.indexOf(N)!==-1 : false;
}
function sortByOpenDateAsc(a,b){
  const da=new Date((a&&a.event&&a.event.openDate)||0).getTime();
  const db=new Date((b&&b.event&&b.event.openDate)||0).getTime();
  return da===db?0:(da<db?-1:1);
}

// --- aliases (shared files) ---
let __CFG=null, __ALIAS_MAP=null;
function loadConfig(){
  if(!__CFG){
    const p=path.resolve('config/global.json');
    __CFG=JSON.parse(fs.readFileSync(p,'utf8'));
  } return __CFG;
}
function loadAliasMap(){
  if(!__ALIAS_MAP){
    const cfg=loadConfig();
    const p=path.resolve((cfg&&cfg.normalize&&cfg.normalize.teamAliasesPath)||'data/compiled/aliases.index.json');
    __ALIAS_MAP=JSON.parse(fs.readFileSync(p,'utf8'));
  } return __ALIAS_MAP;
}
function canonTeamName(input){
  if(!input) return input;
  const m=loadAliasMap(); const key=canon(input); const val=m[key];
  return (typeof val==='string') ? val : input;
}
function aliasKeysForInput(rawTeam){
  try{
    const m=loadAliasMap(); const key=canon(rawTeam); const val=m[key];
    const ids=Array.isArray(val)?new Set(val):(val?new Set([val]):new Set());
    if(!ids.size) return [];
    const out=[];
    for(const k in m){
      if(!Object.prototype.hasOwnProperty.call(m,k)) continue;
      const v=m[k]; const arr=Array.isArray(v)?v:(v?[v]:[]);
      for(let i=0;i<arr.length;i++){ if(ids.has(arr[i])){ out.push(k); break; } }
    }
    const seen=new Set(); const ded=[]; for(const k of out){ if(!seen.has(k)){ seen.add(k); ded.push(k);} }
    return ded;
  }catch{ return []; }
}
function matchesAnyAliasName(runnerName, aliasNames){
  const rn=runnerName||'';
  for(let i=0;i<aliasNames.length;i++){
    const a=aliasNames[i]; if(!a) continue;
    if(canon(rn)===canon(a)) return true;
    if(wordishContains(rn,a)) return true;
  } return false;
}

// --- youth / women / B team filters (parity with MO) ---
const B_WHITELIST=new Set(['real sociedad b','barcelona b','bayern munich ii','real madrid castilla','jong ajax','jong psv','jong az','jong utrecht']);
function hasWomenMarkers(n=''){ return /(?:^|[\s-])(women|ladies|femenino|fem)(?:$|[\s-])/i.test(n); }
function hasYouthMarkers(n=''){ return /(?:^|[\s-])(u-?\d{2}|under\s?\d{2}|u\d{2}|youth)(?:$|[\s-])/i.test(n); }
function hasReserveMarkers(n=''){ return /\breserves?\b/i.test(n); }
function hasBTeamMarkers(n=''){ if(/(?:^|[\s-])(b|ii)(?:\s*team)?$/i.test(n)) return true; if(/\bcastilla\b/i.test(n)) return true; if(/^\s*jong\s+/i.test(n)) return true; return false; }
function flagsFor(name=''){ const lc=canon(name); return { isWomen:hasWomenMarkers(name), isYouth:hasYouthMarkers(name), isReserve:hasReserveMarkers(name), isBTeam:hasBTeamMarkers(name), isWhitelistedB:B_WHITELIST.has(lc)}; }
function splitNonDrawRunners(c){
  const runners=(c&&c.runners)||[]; const out=[];
  for(let j=0;j<runners.length;j++){ const rr=runners[j]; if(rr&&rr.runnerName&&canon(rr.runnerName)!=='the draw') out.push(rr); }
  return out;
}
function shouldDropBySelfVsOpponent({ runnerNames=[], aliasNames=[], rawTeam='' }){
  const nonDraw=runnerNames.filter(n=>canon(n)!=='the draw');
  let self=null; for(let i=0;i<nonDraw.length;i++){ if(matchesAnyAliasName(nonDraw[i],aliasNames)){ self=nonDraw[i]; break; } }
  const opponent=nonDraw.find(r=>r!==self)||'';
  const selfFlags=flagsFor(self); const oppFlags=flagsFor(opponent); const reqFlags=flagsFor(rawTeam);
  if(selfFlags.isWomen) return !reqFlags.isWomen;
  const selfYouthish=selfFlags.isYouth||selfFlags.isReserve; const reqYouthish=reqFlags.isYouth||reqFlags.isReserve;
  if(selfYouthish) return !reqYouthish;
  if(selfFlags.isBTeam){ if(selfFlags.isWhitelistedB) return false; if(reqFlags.isBTeam) return false; return true; }
  const opponentIsYouthish=oppFlags.isWomen||oppFlags.isYouth||oppFlags.isReserve||oppFlags.isBTeam;
  if(opponentIsYouthish) return false;
  return false;
}

// --- Betfair catalogue fetch (with compatibility) ---
async function listMarketCatalogueCompat(filter, { maxResults=200, marketProjection=['EVENT','COMPETITION','RUNNER_DESCRIPTION'], sort='FIRST_TO_START' } = {}){
  try{ const r=await listMarketCatalogue({ filter, maxResults, marketProjection, sort }); if(Array.isArray(r)) return r; }catch(e){}
  try{ const r=await listMarketCatalogue(filter, { maxResults, marketProjection, sort }); if(Array.isArray(r)) return r; }catch(e){}
  try{ const r=await listMarketCatalogue(filter, maxResults, marketProjection, sort); if(Array.isArray(r)) return r; }catch(e){ throw e; }
  return [];
}

async function fetchCandidatesForTeam(team, { horizonHours=72, marketTypeCodes=[] } = {}){
  const fromIso=nowIso(-2*60*60*1000); const toIso=nowIso(horizonHours*60*60*1000);
  const filter={
    eventTypeIds:[SOCCER_EVENT_TYPE_ID],
    marketTypeCodes: marketTypeCodes && marketTypeCodes.length ? marketTypeCodes : ['TO_WIN_TO_NIL','WIN_TO_NIL','TEAM_TO_WIN_TO_NIL'],
    inPlayOnly:false,
    marketStartTime:{ from:fromIso, to:toIso },
    textQuery:team
  };
  const cats=await listMarketCatalogueCompat(filter, { maxResults:200, marketProjection:['EVENT','COMPETITION','RUNNER_DESCRIPTION'], sort:'FIRST_TO_START' });
  return Array.isArray(cats)?cats:[];
}

// --- pick runner matching the team ---
function pickCandidate(cats, aliasNames, { preferExact=true } = {}){
  const exact=[], fuzzy=[];
  for(let i=0;i<cats.length;i++){
    const c=cats[i]; const nonDraw=splitNonDrawRunners(c); let hasExact=false;
    for(let j=0;j<nonDraw.length;j++){ const nm=nonDraw[j].runnerName;
      for(let k=0;k<aliasNames.length;k++){ if(canon(nm)===canon(aliasNames[k])){ hasExact=true; break; } }
      if(hasExact) break;
    }
    (hasExact?exact:fuzzy).push(c);
  }
  exact.sort(sortByOpenDateAsc); fuzzy.sort(sortByOpenDateAsc);
  function pickFrom(list, preferExact){
    for(let i=0;i<list.length;i++){
      const c=list[i]; const nonDraw=splitNonDrawRunners(c); let hit=null;
      if(preferExact){
        for(let j=0;j<nonDraw.length;j++){ const nm=nonDraw[j].runnerName;
          for(let k=0;k<aliasNames.length;k++){ if(canon(nm)===canon(aliasNames[k])){ hit=nonDraw[j]; break; } }
          if(hit) break;
        }
      }
      if(!hit){
        for(let j=0;j<nonDraw.length;j++){ if(matchesAnyAliasName(nonDraw[j].runnerName, aliasNames)){ hit=nonDraw[j]; break; } }
      }
      if(hit) return { c, hit };
    }
    return { c:null, hit:null };
  }
  let chosen=null, runner=null;
  ({ c:chosen, hit:runner } = pickFrom(exact, true));
  if(!chosen || !runner){ ({ c:chosen, hit:runner } = pickFrom(fuzzy, false)); }
  return { chosen, runner };
}

/**
 * Resolve "Team X to win to nil"
 * @param {Object} leg - { team }
 * @param {Object} opts - { debug, horizonHours, hints }
 */
export async function resolveWinToNil(leg, { debug=false, horizonHours=72, hints={} } = {}){
  const rawTeam=(leg&&(leg.team||leg.label||leg.name))||'';
  const teamCanon=canonTeamName(rawTeam);
  const aliasKeys=aliasKeysForInput(rawTeam);
  const aliasNames=Array.from(new Set([teamCanon, ...aliasKeys])).filter(Boolean);
  const marketTypeCodes = (hints && hints.marketTypeCodes) || [];

  // Fan-out queries using alias variants until we get candidates
  let cats=[];
  for(let i=0;i<aliasNames.length;i++){
    const q=aliasNames[i]; const r=await fetchCandidatesForTeam(q, { horizonHours, marketTypeCodes });
    if(debug) console.log(`[map:WinToNil] textQuery="${q}" -> candidates=${(Array.isArray(r)?r.length:0)}`);
    if(r&&r.length){ cats=r; break; }
  }
  const triedName=teamCanon;
  if(!cats.length) return { ok:false, team:rawTeam, reason:'NO_CANDIDATES', triedName };

  // Keep only candidates that contain our team among runners (excluding draw)
  const withTeam=[];
  for(let i=0;i<cats.length;i++){
    const c=cats[i]; const nonDraw=splitNonDrawRunners(c);
    let ok=false;
    for(let j=0;j<nonDraw.length;j++){ if(matchesAnyAliasName(nonDraw[j].runnerName, aliasNames)){ ok=true; break; } }
    if(ok) withTeam.push(c);
  }
  if(!withTeam.length){
    const hint=cats.slice(0,8).map(c=>c&&c.event&&c.event.name).filter(Boolean);
    return { ok:false, team:rawTeam, reason:'NO_EVENT_MATCH', triedName, candidatesHint:hint };
  }

  // Apply same youth/B/W filters as MO
  const postFilter=[];
  for(let i=0;i<withTeam.length;i++){
    const c=withTeam[i]; const names=((c&&c.runners)||[]).map(r=>r&&r.runnerName||'');
    const drop=shouldDropBySelfVsOpponent({ runnerNames:names, aliasNames, rawTeam });
    if(debug && drop) console.log('[map:WinToNil] drop self youth/B/women', { eventName:c&&c.event&&c.event.name });
    if(!drop) postFilter.push(c);
  }
  if(!postFilter.length){
    const hint=withTeam.slice(0,8).map(c=>c&&c.event&&c.event.name).filter(Boolean);
    return { ok:false, team:rawTeam, reason:'NO_EVENT_MATCH_AFTER_FILTER', triedName, candidatesHint:hint };
  }

  // Pick candidate & runner (team)
  const { chosen, runner } = pickCandidate(postFilter, aliasNames, { preferExact:true });
  if(!chosen || !runner){
    const hint=postFilter.slice(0,8).map(c=>c&&c.event&&c.event.name).filter(Boolean);
    return { ok:false, team:rawTeam, reason:'NO_RUNNER_FOR_TEAM', triedName, candidatesHint:hint };
  }

  const res={ ok:true, team:rawTeam, marketId:chosen.marketId, selectionId:runner&&runner.selectionId||null, eventId:(chosen&&chosen.event&&chosen.event.id)||null, eventName:(chosen&&chosen.event&&chosen.event.name)||null, koIso:(chosen&&chosen.event&&chosen.event.openDate)||null, competition:(chosen&&chosen.competition&&chosen.competition.name)||null };
  if(debug) console.log(`[map:WinToNil] OK "${teamCanon}" -> event="${res.eventName}" | marketId=${res.marketId} | sel=${res.selectionId}`);
  return res;
}

export default { resolveWinToNil };
