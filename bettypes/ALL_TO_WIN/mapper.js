// bettypes/ALL_TO_WIN/mapper.js
// Wraps the central Betfair football mapper for MO legs.

import { mapAllToWinLegs } from '../../lib/map/betfair-football.js';

/**
 * @param {object} offer - { legs:[{team}], ... }
 * @param {object} ctx   - { debug, bookie }
 * @returns {Promise<{ mapped: Array, unmatched: Array }>}
 */
async function map(offer, ctx = {}) {
  const legs = (offer.legs || []).map(L => ({ team: L.team || L.label || L.name || '' }));
  return await mapAllToWinLegs(legs, { debug: !!ctx.debug, bookie: ctx.bookie });
}

export { map };
export default { map };