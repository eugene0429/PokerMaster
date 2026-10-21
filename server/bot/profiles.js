/**
 * Bot archetypes. Each bot is dealt one of these at creation and keeps it for
 * its life at the table. Players never see which is which — reading the
 * opponent is the practice.
 *
 * All thresholds are on the 0..1 hand-strength scale the bot module produces.
 *
 *  open      preflop strength needed to come in for a raise
 *  limp      width of the band below `open` that is called rather than raised
 *  call      preflop strength needed to call one
 *  threeBet  strength needed to re-raise
 *  aggression  how often a strong hand becomes a bet rather than a call
 *  bluff     how often a weak hand fires anyway
 *  sizing    bet size as a fraction of the pot, [min, max]
 *  pressure  resistance to folding against a big bet (high = calls light)
 *  slowplay  how often a monster just checks
 *  position  how much being on the button widens the opening range
 *  chase     multiplier on draw equity
 */
export const PROFILES = [
  { key: 'nit',     open: 0.42, limp: 0.02, call: 0.45, threeBet: 0.63, aggression: 0.80, bluff: 0.02,
    sizing: [0.45, 0.65], pressure: 0.10, slowplay: 0.10, position: 0.04, chase: 0.5 },

  { key: 'rock',    open: 0.38, limp: 0.07, call: 0.38, threeBet: 0.58, aggression: 0.50, bluff: 0.05,
    sizing: [0.50, 0.70], pressure: 0.20, slowplay: 0.22, position: 0.05, chase: 0.7 },

  { key: 'tag',     open: 0.32, limp: 0.05, call: 0.32, threeBet: 0.52, aggression: 0.80, bluff: 0.20,
    sizing: [0.60, 0.85], pressure: 0.35, slowplay: 0.15, position: 0.08, chase: 0.9 },

  { key: 'lag',     open: 0.23, limp: 0.02, call: 0.21, threeBet: 0.45, aggression: 0.85, bluff: 0.36,
    sizing: [0.65, 1.00], pressure: 0.50, slowplay: 0.10, position: 0.10, chase: 1.1 },

  { key: 'station', open: 0.34, limp: 0.18, call: 0.10, threeBet: 0.74, aggression: 0.08, bluff: 0.03,
    sizing: [0.35, 0.55], pressure: 0.85, slowplay: 0.35, position: 0.02, chase: 1.4 },

  { key: 'maniac',  open: 0.12, limp: 0.04, call: 0.10, threeBet: 0.32, aggression: 0.95, bluff: 0.52,
    sizing: [0.85, 1.45], pressure: 0.55, slowplay: 0.02, position: 0.06, chase: 1.2 },

  { key: 'tricky',  open: 0.30, limp: 0.04, call: 0.27, threeBet: 0.49, aggression: 0.70, bluff: 0.30,
    sizing: [0.40, 1.05], pressure: 0.45, slowplay: 0.45, position: 0.09, chase: 1.0 },
];

export const PROFILE_BY_KEY = Object.fromEntries(PROFILES.map((p) => [p.key, p]));

export const DEFAULT_PROFILE = PROFILE_BY_KEY.tag;

/**
 * Hand out archetypes from a shuffled bag, so a table of five bots gets five
 * different personalities rather than three maniacs by luck.
 */
export function makeProfileDealer(rand = Math.random) {
  let bag = [];
  return function nextProfile() {
    if (bag.length === 0) {
      bag = PROFILES.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop();
  };
}

/* ------------------------------ pro bots ----------------------------- */

/**
 * Pro styles sit on top of one strong core. They change taste, not skill.
 *
 *  width     multiplier on every preflop chart
 *  bluffCap  multiplier on the balanced bluff ratio
 *  mix       how close two options must be (fraction of the pot) to mix them
 *  sizes     bet sizes considered, as fractions of the pot
 *  slowplay  how often a monster checks when it could bet
 *  edgeMix   how often a hand just outside the opening range opens anyway
 */
export const PRO_STYLES = [
  { key: 'pro-solid',  width: 1.0, bluffCap: 1.0, mix: 0.08, sizes: [0.33, 0.66, 1.0], slowplay: 0.08, edgeMix: 0.3 },
  { key: 'pro-tight',  width: 0.8, bluffCap: 0.6, mix: 0.08, sizes: [0.5, 0.75],       slowplay: 0.05, edgeMix: 0.15 },
  { key: 'pro-loose',  width: 1.3, bluffCap: 1.0, mix: 0.08, sizes: [0.5, 0.75, 1.25], slowplay: 0.05, edgeMix: 0.45 },
  { key: 'pro-tricky', width: 1.0, bluffCap: 1.1, mix: 0.16, sizes: [0.33, 0.75, 1.1], slowplay: 0.3,  edgeMix: 0.3 },
];

export const PRO_STYLE_BY_KEY = Object.fromEntries(PRO_STYLES.map((s) => [s.key, s]));

/**
 * Difficulty is the same engine run more or less carefully.
 *
 *  samples/timeMs  Monte Carlo budget per decision, whichever runs out first
 *  narrow          narrow opponents' ranges by their postflop actions
 *  exploit         0..1, how far session stats move the opponent model
 *  mistake         chance of taking the second-best option
 *  realization     discount equity for position and streets to come
 *  balance         cap bluffs at the ratio the bet size can support
 */
export const SKILLS = {
  easy:   { key: 'easy',   samples: 400,  timeMs: 30,  narrow: false, exploit: 0,   mistake: 0.2,  realization: false, balance: false },
  normal: { key: 'normal', samples: 1500, timeMs: 60,  narrow: true,  exploit: 0.5, mistake: 0.12, realization: true,  balance: true },
  hard:   { key: 'hard',   samples: 4000, timeMs: 100, narrow: true,  exploit: 1,   mistake: 0,    realization: true,  balance: true },
};
