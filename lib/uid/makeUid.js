import crypto from 'crypto';
export function makeUid({ typeId, legs, latestKoIso }) {
const legsKey = (legs||[])
.map(l => `${(l.home||'').toLowerCase()}-${(l.away||'').toLowerCase()}-${l.koIso||''}-${l.line||''}-${l.scope||''}`)
.sort()
.join('|');
const basis = `${typeId}|${latestKoIso||''}|${legsKey}`;
return crypto.createHash('sha1').update(basis).digest('hex');
}