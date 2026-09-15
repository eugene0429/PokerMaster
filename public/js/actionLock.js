/**
 * One press, one action.
 *
 * Between the click and the server's reply the buttons would still be live,
 * and a second press lands out of turn. But "wait until it is no longer my
 * turn" is the wrong release condition: closing a betting round can hand the
 * action straight back to you on the next street, and then the buttons would
 * stay dead until the clock ran out.
 *
 * So the lock is tied to the decision point, not to whose turn it is.
 */

export function decisionKey(snapshot) {
  const hand = snapshot?.hand;
  if (!hand || hand.complete) return 'idle';
  return [
    hand.handId,
    hand.street,
    hand.currentSeat,
    hand.currentBet,
    snapshot.you?.seat ?? '-',
  ].join(':');
}

export function createActionLock({ timeoutMs = 4000, now = () => Date.now() } = {}) {
  let armedKey = null;
  let armedAt = 0;

  const release = () => { armedKey = null; };

  return {
    get locked() { return armedKey !== null; },

    arm(snapshot) {
      armedKey = decisionKey(snapshot);
      armedAt = now();
    },

    release,

    /** Free the buttons once the table has moved on — or if no reply came. */
    sync(snapshot) {
      if (armedKey === null) return;
      if (!snapshot?.toAct) return release();
      if (decisionKey(snapshot) !== armedKey) return release();
      // Last resort: never leave someone unable to act because a reply was lost.
      if (now() - armedAt > timeoutMs) return release();
    },
  };
}
