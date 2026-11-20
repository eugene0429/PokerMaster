import { connect, savedName, saveName } from './net.js';
import {
  initRender, paint, noteEvents, resetDecor, seatPercent, betPercent, displayStack,
} from './render.js';
import { initAnim, flyChips, localCenter, percentToLocal, sparkle } from './anim.js';
import { formatChips } from './chips.js';
import { setFourColor } from './cards.js';
import { renderChat, bindChatForm, resetChat } from './chat.js';
import { createReveal } from './reveal.js';
import { createActionLock } from './actionLock.js';
import * as menu from './menu.js';
import { modeLabel } from './menu.js';
import * as sound from './sound.js';
import { t, applyStatic, toggleLang, onLangChange, errorText } from './i18n.js';

const $ = (id) => document.getElementById(id);

const refs = {
  table: $('table'), seats: $('seats'), bets: $('bets'), fx: $('fx'),
  board: $('board'), pot: $('pot'), status: $('tableStatus'),
  actions: $('actions'), heroStrip: $('heroStrip'),
};

let snapshot = null;
let net = null;
let invite = null;
let raiseValue = null;
let lastHandId = null;
let lastPhase = null;
let resultsKey = null;
let pendingAwards = [];
let pendingBustOuts = [];

/** Guards against a second press landing before the first is answered. */
const actionLock = createActionLock();

/** The table lags the server on purpose; this owns how far behind it is. */
const reveal = createReveal(onRevealStep);

function onRevealStep(step) {
  if (!snapshot) return;

  // Grab the pot's position before the repaint sweeps it off the felt.
  const potAt = step === 'settled' ? localCenter(refs.pot) : null;

  paint(snapshot, reveal.view());
  renderDock(snapshot);

  if (step === 'board' || step === 'tabled') sound.play('flip');
  if (step === 'settled') {
    playAwards(potAt);
    announceBustOuts(pendingBustOuts, snapshot.you?.seat ?? null);
    pendingBustOuts = [];
  }
  if (step === 'results') paintResults(snapshot, true);
}

function playAwards(potAt) {
  const from = potAt ?? percentToLocal({ x: 50, y: 62 });
  for (const award of pendingAwards) {
    const to = percentToLocal(seatPercent(award.seat, snapshot));
    flyChips(from, to, award.amount, { duration: 620, label: true });
    sparkle(to);
    sound.play(award.seat === snapshot.you?.seat ? 'win' : 'lose');
  }
  pendingAwards = [];
}

/* ------------------------------ boot ------------------------------ */

applyStatic();
initAnim({ fx: refs.fx, table: refs.table });
initRender(refs, {
  onSit: (seat) => net?.send('sit', { seat, name: savedName() }),
  onAddBot: (seat) => net?.send('addBot', { seat }),
  onKick: (seat) => net?.send('kick', { seat }),
});

menu.initMenu({
  onStart: (opts) => { saveName(opts.name); sound.unlock(); net?.send('startTable', opts); },
  onJoin: ({ name }) => {
    saveName(name);
    sound.unlock();
    const free = snapshot?.seats.findIndex((s) => s === null) ?? -1;
    if (free < 0) return toast(t('toast.noSeat'), 'error');
    net?.send('sit', { seat: free, name });
  },
  onWatch: () => toast(t('toast.watching')),
  onInvite: openInvite,
  onChat: (text) => net?.send('chat', { text }),
  onRename: (name) => { saveName(name); net?.send('rename', { name }); },
});
menu.setName(savedName());

setFourColor(localStorage.getItem('pm-fourcolor') === '1');
$('btnFourColor').classList.toggle('on', localStorage.getItem('pm-fourcolor') === '1');
$('btnSound').classList.toggle('off', sound.isMuted());
$('btnSound').textContent = sound.isMuted() ? '✕' : '♪';

net = connect({
  onUpdate: handleUpdate,
  onIdentity: (p) => { invite = p.invite ?? null; paintInvite(); },
  onError: (message, code, params) => {
    actionLock.release();           // the action bounced; let them try again
    toast(errorText(message, code, params), 'error');
    if (snapshot) renderDock(snapshot);
  },
  onStatus: (s) => {
    if (s === 'disconnected') toast(t('toast.disconnected'), 'error');
  },
});

/* ---------------------------- updates ----------------------------- */

function handleUpdate({ snapshot: next, events }) {
  const first = snapshot === null;
  const before = captureChipPositions();

  if (next.hand && next.hand.handId !== lastHandId) {
    lastHandId = next.hand.handId;
    pendingAwards = [];
    pendingBustOuts = [];
    if (!events.some((e) => e.type === 'handStart')) resetDecor();
  }

  // Free the buttons once the table has moved past the spot we acted on.
  actionLock.sync(next);

  noteEvents(events);
  snapshot = next;
  reveal.sync(snapshot);
  paint(snapshot, reveal.view());
  renderDock(snapshot);

  if (snapshot.you?.seated) menu.hide();
  else menu.updateMenu(snapshot);
  paintTableChat(snapshot);

  if (!first) {
    runEffects(events, before);
    playSounds(events);
    // Held until the reveal settles — see onRevealStep.
    for (const e of events) {
      if (e.type === 'rebuy' || e.type === 'knockOut') pendingBustOuts.push(e);
    }
  }

  paintClock();
  paintPause(snapshot);
  paintResults(snapshot, reveal.view().results);
  if (lastPhase === 'finished' && snapshot.phase !== 'finished' && !snapshot.you?.seated) menu.reopen();
  lastPhase = snapshot.phase;

  paintTopLabels(snapshot);
}

function paintTopLabels(s) {
  $('handLabel').textContent = s.hand ? t('top.hand', { n: s.hand.handId }) : t('top.waiting');
  $('btnStand').hidden = !s.you?.seated;

  const watchers = s.spectators.length;
  $('spectatorLabel').hidden = watchers === 0;
  $('spectatorLabel').textContent = t('top.watching', { n: watchers });
}

function captureChipPositions() {
  const map = new Map();
  for (const el of refs.bets.children) {
    const seat = Number(el.dataset.key.split('-')[1]);
    map.set(seat, { at: localCenter(el), amount: Number(el.dataset.amount ?? 0) });
  }
  return { bets: map, pot: localCenter(refs.pot) ?? percentToLocal({ x: 50, y: 62 }) };
}

function runEffects(events, before) {
  const potAt = localCenter(refs.pot) ?? before.pot;

  for (const e of events) {
    if (e.type === 'collectPot') {
      let i = 0;
      for (const [, info] of before.bets) {
        if (!info.at || !info.amount) continue;
        flyChips(info.at, potAt, info.amount, { delay: i * 45 });
        i++;
      }
    }
    if (e.type === 'returnBet') {
      const info = before.bets.get(e.seat);
      const to = percentToLocal(seatPercent(e.seat, snapshot));
      flyChips(info?.at ?? percentToLocal(betPercent(e.seat, snapshot)), to, e.amount, { duration: 420 });
    }
    // The pot does not move until the reveal pipeline says the hand is settled.
    if (e.type === 'awardPot') pendingAwards.push(e);
  }
}

function playSounds(events) {
  const kinds = new Set(events.map((e) => e.type));
  if (kinds.has('deal')) sound.play('deal');
  if (kinds.has('collectPot')) sound.play('potSlide');
  // Board cards and the pot award are voiced by the reveal pipeline instead,
  // so the sound lands with the card rather than with the network packet.

  for (const e of events) {
    if (e.type === 'action') {
      if (e.action === 'fold') sound.play('fold');
      else if (e.action === 'check') sound.play('check');
      else sound.play('chips');
    }
    if (e.type === 'actionOn' && e.seat === snapshot.you?.seat) sound.play('turn');
    if (e.type === 'rebuy') sound.play('chips');
  }
}

/** Busting out is the one thing you should never have to infer from the table. */
function announceBustOuts(events, mySeat) {
  for (const e of events) {
    if (e.type === 'rebuy' && e.seat === mySeat) {
      // The amount follows the blinds, so say what is coming back.
      const left = e.remaining === null ? '' : t('toast.rebuyLeft', { n: e.remaining });
      toast(t('toast.rebuy', { stack: formatChips(e.stack), left }));
    }
    if (e.type === 'knockOut') {
      toast(e.seat === mySeat
        ? t('toast.youreOut')
        : t('toast.out', { name: e.name }), e.seat === mySeat ? 'error' : '');
    }
  }
}

/* ------------------------------ dock ------------------------------ */

function renderDock(s) {
  const hero = s.you;
  const toAct = s.toAct;

  refs.heroStrip.innerHTML = '';
  if (hero?.seated) {
    addStrip(`${hero.name}`, '');
    addStrip(t('dock.stack'), formatChips(displayStack(s, reveal.view(), hero.seat)));
    if (s.hand) addStrip(t('dock.pot'), formatChips(s.hand.potTotal));
    const left = s.seats[hero.seat]?.rebuysLeft;
    if (left !== null && left !== undefined) addStrip(t('dock.rebuys'), t('dock.rebuysLeft', { n: left }));
    if (toAct?.toCall > 0) addStrip(t('dock.toCall'), formatChips(toAct.toCall), 'to-call');
  }

  if (!toAct || s.game?.paused) {
    refs.actions.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'waiting-note';
    note.textContent = dockNote(s);
    refs.actions.appendChild(note);

    // Never leave the player with nothing to press while the table is short.
    if (needsPlayers(s) && s.you?.isHost) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'act-btn check dock-cta';
      add.innerHTML = `${t('dock.addBot')}<small>${t('dock.addBotSub')}</small>`;
      add.addEventListener('click', () => net?.send('addBot'));
      refs.actions.appendChild(add);
    }
    raiseValue = null;
    return;
  }
  renderActionButtons(s, toAct);
}

function needsPlayers(s) {
  return s.you?.seated && !s.game?.finished && !s.game?.paused
    && s.seats.filter(Boolean).length < 2;
}

function addStrip(label, value, cls = '') {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = value ? `${label} <strong>${value}</strong>` : `<strong>${label}</strong>`;
  refs.heroStrip.appendChild(span);
}

function dockNote(s) {
  if (s.game?.paused) {
    return s.you?.isHost ? t('dock.pausedHost') : t('dock.paused');
  }
  if (s.game?.finished) return t('dock.finished');
  if (!s.you?.seated) return t('dock.spectating');
  if (s.you.sittingOut) return t('dock.sittingOut');
  if (needsPlayers(s)) return t('dock.alone');
  if (s.phase === 'idle') return t('dock.idle');
  if (s.phase === 'countdown') return t('dock.countdown');
  if (s.hand && !s.hand.complete) {
    const who = s.seats[s.hand.currentSeat]?.name;
    return who ? t('dock.turnOf', { name: who }) : t('dock.inProgress');
  }
  return t('dock.nextHand');
}

function renderActionButtons(s, act) {
  const pot = s.hand.potTotal;
  refs.actions.innerHTML = '';
  const locked = actionLock.locked;

  refs.actions.appendChild(button('fold', t('act.fold'), '', () => send('fold'), locked));

  if (act.canCheck) {
    refs.actions.appendChild(button('check', t('act.check'), '', () => send('check'), locked));
  } else {
    refs.actions.appendChild(button('call', t('act.call'), formatChips(act.toCall), () => send('call'), locked));
  }

  if (!act.canRaise) return;

  const min = act.minRaiseTo;
  const max = act.maxRaiseTo;
  const unit = act.chipUnit || 1;
  // The slider counts chips, not points: notch k is k chips of `unit`, with the
  // two ends pinned to the minimum and the all-in, which may be odd amounts.
  const lo = Math.floor(min / unit);
  const hi = Math.ceil(max / unit);
  const valueAt = (k) => (k <= lo ? min : k >= hi ? max : k * unit);
  const notchOf = (v) => (v <= min ? lo : v >= max ? hi : Math.round(v / unit));
  const snap = (v) => valueAt(notchOf(Math.min(max, Math.max(min, v))));
  if (raiseValue === null || raiseValue < min || raiseValue > max) {
    raiseValue = snap(pot * 0.6 + s.hand.currentBet);
  }
  raiseValue = snap(raiseValue);

  const panel = document.createElement('div');
  panel.className = 'raise-panel';

  const top = document.createElement('div');
  top.className = 'raise-top';
  const amount = document.createElement('span');
  amount.className = 'raise-amount';
  const quick = document.createElement('div');
  quick.className = 'raise-quick';
  top.append(amount, quick);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(lo);
  slider.max = String(hi);
  slider.step = '1';
  slider.disabled = locked;

  const sync = () => {
    slider.value = String(notchOf(raiseValue));
    amount.textContent = formatChips(raiseValue);
    slider.style.setProperty('--fill', `${max > min ? ((raiseValue - min) / (max - min)) * 100 : 100}%`);
    raiseBtn.querySelector('small').textContent = raiseValue >= max ? t('act.allIn') : formatChips(raiseValue);
  };

  slider.addEventListener('input', () => { raiseValue = valueAt(Number(slider.value)); sync(); });

  const quickBets = [
    [t('act.halfPot'), 0.5], [t('act.twoThirdsPot'), 0.667], [t('act.pot'), 1], [t('act.allIn'), null],
  ];
  for (const [label, fraction] of quickBets) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'quick-btn';
    b.textContent = label;
    b.disabled = locked;
    b.addEventListener('click', () => {
      raiseValue = fraction === null ? max : snap(s.hand.currentBet + pot * fraction);
      sync();
    });
    quick.appendChild(b);
  }

  const raiseBtn = button('raise', act.isBet ? t('act.bet') : t('act.raise'), formatChips(raiseValue),
    () => send('raise', raiseValue), locked);

  panel.append(top, slider);
  refs.actions.append(panel, raiseBtn);
  sync();
}

function button(kind, label, sub, onClick, locked = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `act-btn ${kind}`;
  b.disabled = locked;
  b.innerHTML = `${label}<small>${sub}</small>`;
  b.addEventListener('click', () => { sound.unlock(); onClick(); });
  return b;
}

/**
 * One press, one action. Between the click and the server's reply the buttons
 * would otherwise still be live, and a second press lands out of turn.
 */
function send(type, amount) {
  if (actionLock.locked) return;
  actionLock.arm(snapshot);
  raiseValue = null;
  net.send('action', { type, amount });
  if (snapshot) renderDock(snapshot);
}

/* ------------------------ chat at the table ------------------------ */

let chatOpen = false;
let unread = 0;

bindChatForm($('gameChatForm'), $('gameChatInput'), (text) => net?.send('chat', { text }));

$('chatToggle').addEventListener('click', () => {
  chatOpen = !chatOpen;
  $('chatPanel').hidden = !chatOpen;
  if (chatOpen) {
    unread = 0;
    paintBadge();
    // While hidden the list has no height, so autoscroll could not run.
    const list = $('gameChatList');
    list.scrollTop = list.scrollHeight;
    $('gameChatInput').focus();
  }
});

function paintBadge() {
  $('chatBadge').hidden = unread === 0;
  $('chatBadge').textContent = unread > 99 ? '99+' : String(unread);
}

function paintTableChat(s) {
  // The menu has its own chat panel; two of them on screen would be noise.
  const menuVisible = !$('menu').hidden;
  $('tableChat').hidden = menuVisible;
  if (menuVisible) return;

  const list = $('gameChatList');
  const firstPaint = !list.dataset.lastId;
  const added = renderChat(list, s.chat ?? [], s.you?.name);

  // A full history on the first paint is not "unread".
  if (!firstPaint && added > 0 && !chatOpen) {
    unread += added;
    paintBadge();
  }
}

/* ----------------------------- paused ------------------------------ */

function paintPause(s) {
  const game = s.game ?? {};
  const running = s.seats.some(Boolean) && !game.finished;

  $('btnPause').hidden = !(running && s.you?.isHost);
  $('btnPause').textContent = game.paused ? t('top.resume') : t('top.pause');
  $('btnPause').classList.toggle('danger', !!game.paused);

  $('pauseVeil').hidden = !game.paused;
  $('pauseSub').textContent = s.you?.isHost
    ? t('pause.hostHint')
    : t('pause.waitHost');
}

$('btnPause').addEventListener('click', () => {
  net?.send(snapshot?.game?.paused ? 'resume' : 'pause');
});

/* --------------------------- game clock ---------------------------- */

function mmss(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * The server sends reference timestamps, not a countdown — a tab that sleeps
 * would drift if the client counted the seconds itself.
 */
function paintClock() {
  const game = snapshot?.game;
  if (!game) return;

  // While paused the clocks read from the moment they stopped, so nothing
  // creeps forward and then snaps back when the game resumes.
  const now = game.pausedAt ?? Date.now();

  const clock = $('clockLabel');
  clock.hidden = !game.startedAt;
  if (game.startedAt) clock.textContent = mmss(now - game.startedAt);
  clock.classList.toggle('paused', !!game.paused);

  // The level prefix only means something once a game is actually running.
  $('blindsLabel').textContent = game.rising && game.startedAt
    ? `L${game.level + 1} · ${formatChips(game.blinds.sb)} / ${formatChips(game.blinds.bb)}`
    : t('top.blinds', { sb: formatChips(game.blinds.sb), bb: formatChips(game.blinds.bb) });

  const level = $('levelLabel');
  let text = null;
  let urgent = false;

  if (game.mode === 'timed' && game.endsAt) {
    const left = game.endsAt - now;
    text = left > 0 ? t('top.untilEnd', { time: mmss(left) }) : t('top.lastHand');
    urgent = left > 0 && left < 60_000;
  } else if (game.rising && game.levelEndsAt && game.nextBlinds) {
    const left = game.levelEndsAt - now;
    text = left > 0
      ? t('top.nextLevel', {
        sb: formatChips(game.nextBlinds.sb), bb: formatChips(game.nextBlinds.bb), time: mmss(left),
      })
      : t('top.levelUpNext');
    urgent = left > 0 && left < 60_000;
  }

  level.hidden = text === null;
  if (text !== null) level.textContent = text;
  level.classList.toggle('urgent', urgent);
}

setInterval(paintClock, 1000);

/* ---------------------------- standings ---------------------------- */

function paintResults(s, ready) {
  // The standings wait until the table has finished showing who won with what.
  const results = ready && s.game?.finished ? s.game.results : null;
  if (!results) { $('resultsModal').hidden = true; resultsKey = null; return; }

  // Render once; if the player closes it, a later snapshot must not reopen it.
  const key = `${results.reason}:${results.standings.length}:${results.durationMs}`;
  if (resultsKey === key) return;
  resultsKey = key;

  $('resultsTitle').textContent = results.standings[0]
    ? t('results.winner', { name: results.standings[0].name })
    : t('results.gameOver');
  const reason = t(`reason.${results.reason}`);
  $('resultsSub').textContent = [
    modeLabel(s.game.mode), reason, t('results.hands', { n: results.hands }), mmss(results.durationMs),
  ].join(' · ');

  $('standings').innerHTML = '';
  for (const row of results.standings) {
    const li = document.createElement('li');
    li.className = `standing ${row.place === 1 ? 'winner' : ''}`;
    li.innerHTML = `
      <span class="place">${row.place}</span>
      <span class="who">${escapeHtml(row.name)}${row.isBot ? ' <span class="bot-mark">BOT</span>' : ''}</span>
      <span class="chips">${row.stack > 0 ? formatChips(row.stack) : t('results.out')}${
        row.rebuysUsed ? `<span class="rebuy-mark">${t('results.rebuys', { n: row.rebuysUsed })}</span>` : ''
      }</span>`;
    $('standings').appendChild(li);
  }

  const host = !!s.you?.isHost;
  $('btnNewGame').disabled = !host;
  $('btnNewGame').textContent = host ? t('results.newGame') : t('results.waitHost');
  $('resultsModal').hidden = false;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

$('btnCloseResults').addEventListener('click', () => { $('resultsModal').hidden = true; });
$('btnNewGame').addEventListener('click', () => {
  net?.send('reset');
  $('resultsModal').hidden = true;
  menu.reopen();
});

/* ----------------------------- invite ------------------------------ */

function paintInvite() {
  if (!invite) return;
  $('inviteUrl').textContent = invite.primary;
  $('inviteQr').innerHTML = invite.qr ?? '';
  $('inviteQr').hidden = !invite.qr;
  const others = invite.urls.slice(1);
  $('inviteSub').textContent = invite.isPublic
    ? t('invite.public')
    : t('invite.lan');
  $('inviteAlt').textContent = invite.hasLan || invite.isPublic
    ? (others.length ? t('invite.alsoLan', { urls: others.join(', ') }) : '')
    : t('invite.noNetwork');
}

function openInvite() {
  paintInvite();
  $('inviteModal').hidden = false;
}

$('btnInviteTop').addEventListener('click', openInvite);
$('btnCloseInvite').addEventListener('click', () => { $('inviteModal').hidden = true; });
$('inviteModal').addEventListener('click', (e) => {
  if (e.target === $('inviteModal')) $('inviteModal').hidden = true;
});
$('btnCopyUrl').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(invite?.primary ?? '');
    toast(t('invite.copied'));
  } catch {
    toast(t('invite.copyBlocked'), 'error');
  }
});

/* --------------------------- chrome & UI --------------------------- */

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const act = snapshot?.toAct;
  if (!act || actionLock.locked) return;
  const key = e.key.toLowerCase();
  if (key === 'f') send('fold');
  if (key === 'c') send(act.canCheck ? 'check' : 'call');
  if (key === 'r' && act.canRaise && raiseValue) send('raise', raiseValue);
});

$('btnSound').addEventListener('click', () => {
  sound.setMuted(!sound.isMuted());
  $('btnSound').classList.toggle('off', sound.isMuted());
  $('btnSound').textContent = sound.isMuted() ? '✕' : '♪';
  if (!sound.isMuted()) { sound.unlock(); sound.play('check'); }
});

$('btnFourColor').addEventListener('click', () => {
  const on = localStorage.getItem('pm-fourcolor') !== '1';
  localStorage.setItem('pm-fourcolor', on ? '1' : '0');
  setFourColor(on);
  $('btnFourColor').classList.toggle('on', on);
  refs.board.dataset.keys = '';
  for (const box of refs.seats.querySelectorAll('.seat-cards')) box.dataset.keys = '';
  if (snapshot) paint(snapshot, reveal.view());
});

$('btnStand').addEventListener('click', () => {
  net?.send('stand');
  menu.reopen();
});

$('btnSettings').addEventListener('click', () => {
  if (!snapshot) return;
  $('cfgSb').value = snapshot.config.sb;
  $('cfgBb').value = snapshot.config.bb;
  $('cfgStack').value = snapshot.config.startingStack;
  $('cfgTurn').value = snapshot.config.turnSeconds;
  const host = !!snapshot.you?.isHost;
  const rising = !!snapshot.game?.rising;
  const started = !!snapshot.game?.startedAt;
  const lockedTable = snapshot.game?.mode === 'tournament' && started;

  for (const input of ['cfgStack', 'cfgTurn']) $(input).disabled = !host;
  // Blinds are on a clock in tournament and timed games; editing them by hand
  // would fight the level that is about to be applied.
  for (const input of ['cfgSb', 'cfgBb']) $(input).disabled = !host || rising;
  $('btnAddBot').disabled = !host || lockedTable;
  $('btnEndGame').disabled = !host;
  disarmEndGame();

  paintSettingsNote();
  $('settingsModal').hidden = false;
});

function paintSettingsNote() {
  if (!snapshot) return;
  $('settingsNote').textContent = !snapshot.you?.isHost
    ? t('settings.noteGuest')
    : snapshot.game?.rising
      ? t('settings.noteRising')
      : t('settings.noteHost');
}

$('btnCloseSettings').addEventListener('click', () => {
  $('settingsModal').hidden = true;
  disarmEndGame();
});
$('settingsModal').addEventListener('click', (e) => {
  if (e.target === $('settingsModal')) $('settingsModal').hidden = true;
});

$('btnAddBot').addEventListener('click', () => net?.send('addBot'));

/**
 * Ending the game clears the table for everyone, so it asks twice. Without
 * this there is no way off a running table back to the main menu.
 */
let endGameArmed = false;

function disarmEndGame() {
  endGameArmed = false;
  $('btnEndGame').textContent = t('settings.endGame');
  $('btnEndGame').classList.remove('armed');
}

$('btnEndGame').addEventListener('click', () => {
  if (!endGameArmed) {
    endGameArmed = true;
    $('btnEndGame').textContent = t('settings.endGameConfirm');
    $('btnEndGame').classList.add('armed');
    setTimeout(disarmEndGame, 5000);
    return;
  }
  disarmEndGame();
  net?.send('reset');
  $('settingsModal').hidden = true;
  menu.reopen();
});

$('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const patch = {
    startingStack: Number($('cfgStack').value),
    turnSeconds: Number($('cfgTurn').value),
  };
  if (!snapshot?.game?.rising) {
    patch.sb = Number($('cfgSb').value);
    patch.bb = Number($('cfgBb').value);
  }
  net?.send('config', patch);
  $('settingsModal').hidden = true;
});

let resizeRaf = null;
window.addEventListener('resize', () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => { if (snapshot) paint(snapshot, reveal.view()); });
});

/* ---------------------------- language ----------------------------- */

for (const id of ['btnLang', 'menuLang', 'settingsLang']) $(id).addEventListener('click', toggleLang);

/** Everything on screen was worded when it was drawn, so draw it all again. */
onLangChange(() => {
  resetChat($('gameChatList'));
  resetChat($('menuChatList'));
  menu.relabelMenu();
  disarmEndGame();
  paintInvite();
  if (!snapshot) return;
  paint(snapshot, reveal.view());
  renderDock(snapshot);
  paintTableChat(snapshot);
  paintTopLabels(snapshot);
  paintClock();
  paintPause(snapshot);
  paintSettingsNote();
  if (!$('resultsModal').hidden) {
    resultsKey = null;
    paintResults(snapshot, reveal.view().results);
  }
});

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
