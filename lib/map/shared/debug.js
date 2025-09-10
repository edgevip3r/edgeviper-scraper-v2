// lib/map/shared/debug.js
// Lightweight debug collector for mapping flows (bettype-agnostic).
// Usage:
//   import { createCollector } from '../../lib/map/shared/debug.js';
//   const dbg = createCollector(ctx?.debug);
//   dbg.beginLeg(teamKey);
//   dbg.addCandidate(teamKey, candidateName, { koIso, comp });
//   dbg.addSkip(teamKey, candidateName, 'RESERVE_TEAM');
//   dbg.setChosen(teamKey, { eventName, eventStart, competition, marketId, selectionId, selName });
//   dbg.addNote(teamKey, '[SKIP:FUTURE +96h]');
//   const details = dbg.details();
//
// Notes:
// - Keys are normalised to lower-case to make lookups robust (mapper printers can try lower + raw).
// - No side-effects: this module only aggregates in-memory structures for logs.
// - Safe to include even when disabled: createCollector(false) returns a no-op with the same API.

function normaliseKey(k) {
  if (k == null) return '';
  return String(k).trim().toLowerCase();
}

function ensureLeg(store, key) {
  const k = normaliseKey(key);
  if (!store[k]) {
    store[k] = {
      candidates: [],   // [{ name, ...meta }]
      skipped: [],      // [{ name, reason }]
      chosen: null,     // { eventName, eventStart, competition, marketId, selectionId, selName }
      notes: []         // ['[SKIP:FUTURE +96h]', ...]
    };
  }
  return store[k];
}

export function createCollector(enabled = true) {
  if (!enabled) return NoopCollector;

  const store = Object.create(null);

  return {
    beginLeg(key) { ensureLeg(store, key); },

    addCandidate(key, name, meta = {}) {
      const leg = ensureLeg(store, key);
      leg.candidates.push({ name: String(name || ''), ...meta });
    },

    addSkip(key, name, reason = 'filtered', meta = {}) {
      const leg = ensureLeg(store, key);
      leg.skipped.push({ name: String(name || ''), reason: String(reason || 'filtered'), ...meta });
    },

    setChosen(key, payload = {}) {
      const leg = ensureLeg(store, key);
      // Only first 'chosen' is kept; subsequent calls overwrite to keep the final decision.
      leg.chosen = {
        eventName: payload.eventName || payload.event || null,
        eventStart: payload.eventStart || payload.koIso || payload.kickoff || null,
        competition: payload.competition || payload.league || null,
        marketId: payload.marketId || null,
        selectionId: payload.selectionId ?? null,
        selName: payload.selName || payload.runnerName || null
      };
    },

    addNote(key, note) {
      const leg = ensureLeg(store, key);
      if (note) leg.notes.push(String(note));
    },

    details() {
      return store;
    }
  };
}

// A no-op collector with the same surface so callers don’t need branches.
export const NoopCollector = {
  beginLeg() {},
  addCandidate() {},
  addSkip() {},
  setChosen() {},
  addNote() {},
  details() { return null; }
};

export default { createCollector, NoopCollector };
