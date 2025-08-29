export function fracToDec(frac) {
// Very light stub: handle N/D and EVS
const s = (frac||"").trim().toUpperCase();
if (s === "EVS" || s === "EVENS") return 2.0;
const m = s.match(/^(\d+)\s*[\/\u2044]\s*(\d+)$/);
if (!m) return null; const n = Number(m[1]), d = Number(m[2]);
if (!d) return null; return 1 + n/d;
}