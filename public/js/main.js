import { connect, savedName, saveName } from './net.js';
import {
  initRender, paint, noteEvents, resetDecor, seatPercent, betPercent,
} from './render.js';
import { initAnim, flyChips, localCenter, percentToLocal, sparkle } from './anim.js';
import { formatChips } from './chips.js';
import { setFourColor } from './cards.js';
import * as menu from './menu.js';
import { MODE_LABEL } from './menu.js';
import * as sound from './sound.js';

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

/* ------------------------------ boot ------------------------------ */

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
    if (free < 0) return toast('빈 자리가 없습니다', 'error');
    net?.send('sit', { seat: free, name });
  },
  onWatch: () => toast('관전 중입니다 — 빈 자리를 누르면 앉을 수 있습니다'),
  onInvite: openInvite,
});
menu.setName(savedName());

setFourColor(localStorage.getItem('pm-fourcolor') === '1');
$('btnFourColor').classList.toggle('on', localStorage.getItem('pm-fourcolor') === '1');
$('btnSound').classList.toggle('off', sound.isMuted());
$('btnSound').textContent = sound.isMuted() ? '✕' : '♪';

net = connect({
  onUpdate: handleUpdate,
  onIdentity: (p) => { invite = p.invite ?? null; paintInvite(); },
  onError: (message) => toast(message, 'error'),
  onStatus: (s) => {
    if (s === 'disconnected') toast('연결이 끊겼습니다 — 다시 연결하는 중…', 'error');
  },
});

/* ---------------------------- updates ----------------------------- */

function handleUpdate({ snapshot: next, events }) {
  const first = snapshot === null;
  const before = captureChipPositions();

  if (next.hand && next.hand.handId !== lastHandId) {
    lastHandId = next.hand.handId;
    if (!events.some((e) => e.type === 'handStart')) resetDecor();
  }

  noteEvents(events);
  snapshot = next;
  paint(snapshot);
  renderDock(snapshot);

  if (snapshot.you?.seated) menu.hide();
  else menu.updateMenu(snapshot);

  if (!first) {
    runEffects(events, before);
    playSounds(events);
    announceBustOuts(events, snapshot.you?.seat ?? null);
  }

  paintClock();
  paintResults(snapshot);
  if (lastPhase === 'finished' && snapshot.phase !== 'finished' && !snapshot.you?.seated) menu.reopen();
  lastPhase = snapshot.phase;

  $('handLabel').textContent = snapshot.hand ? `#${snapshot.hand.handId} 핸드` : '대기 중';
  $('btnStand').hidden = !snapshot.you?.seated;

  const watchers = snapshot.spectators.length;
  $('spectatorLabel').hidden = watchers === 0;
  $('spectatorLabel').textContent = `관전 ${watchers}명`;
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
    if (e.type === 'awardPot') {
      const to = percentToLocal(seatPercent(e.seat, snapshot));
      flyChips(before.pot ?? potAt, to, e.amount, { duration: 620, label: true });
      sparkle(to);
    }
  }
}

function playSounds(events) {
  const kinds = new Set(events.map((e) => e.type));
  if (kinds.has('deal')) sound.play('deal');
  if (kinds.has('community')) sound.play('flip');
  if (kinds.has('collectPot')) sound.play('potSlide');

  for (const e of events) {
    if (e.type === 'action') {
      if (e.action === 'fold') sound.play('fold');
      else if (e.action === 'check') sound.play('check');
      else sound.play('chips');
    }
    if (e.type === 'actionOn' && e.seat === snapshot.you?.seat) sound.play('turn');
    if (e.type === 'awardPot') sound.play(e.seat === snapshot.you?.seat ? 'win' : 'lose');
    if (e.type === 'rebuy') sound.play('chips');
  }
}

/** Busting out is the one thing you should never have to infer from the table. */
function announceBustOuts(events, mySeat) {
  for (const e of events) {
    if (e.type === 'rebuy' && e.seat === mySeat) {
      toast(e.remaining === null
        ? `칩이 떨어져 리바이했습니다`
        : `칩이 떨어져 리바이했습니다 — ${e.remaining}회 남음`);
    }
    if (e.type === 'knockOut') {
      toast(e.seat === mySeat
        ? '리바이를 모두 써서 탈락했습니다 — 관전으로 전환됩니다'
        : `${e.name} 탈락`, e.seat === mySeat ? 'error' : '');
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
    addStrip('스택', formatChips(s.seats[hero.seat]?.stack ?? hero.stack));
    if (s.hand) addStrip('팟', formatChips(s.hand.potTotal));
    const left = s.seats[hero.seat]?.rebuysLeft;
    if (left !== null && left !== undefined) addStrip('리바이', `${left}회 남음`);
    if (toAct?.toCall > 0) addStrip('콜 금액', formatChips(toAct.toCall), 'to-call');
  }

  if (!toAct) {
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
      add.innerHTML = '봇 추가<small>바로 시작하기</small>';
      add.addEventListener('click', () => net?.send('addBot'));
      refs.actions.appendChild(add);
    }
    raiseValue = null;
    return;
  }
  renderActionButtons(s, toAct);
}

function needsPlayers(s) {
  return s.you?.seated && !s.game?.finished && s.seats.filter(Boolean).length < 2;
}

function addStrip(label, value, cls = '') {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = value ? `${label} <strong>${value}</strong>` : `<strong>${label}</strong>`;
  refs.heroStrip.appendChild(span);
}

function dockNote(s) {
  if (s.game?.finished) return '게임이 끝났습니다';
  if (!s.you?.seated) return '빈 자리를 눌러 앉으세요 — 관전 중입니다';
  if (s.you.sittingOut) return '자리 비움 상태입니다';
  if (needsPlayers(s)) return '혼자입니다 — 봇을 추가하거나 친구를 부르세요';
  if (s.phase === 'idle') return '플레이어가 2명 이상이면 시작합니다';
  if (s.phase === 'countdown') return '곧 시작합니다…';
  if (s.hand && !s.hand.complete) {
    const who = s.seats[s.hand.currentSeat]?.name;
    return who ? `${who} 님의 차례` : '진행 중';
  }
  return '다음 핸드를 기다리는 중';
}

function renderActionButtons(s, act) {
  const pot = s.hand.potTotal;
  refs.actions.innerHTML = '';

  refs.actions.appendChild(button('fold', '폴드', '', () => send('fold')));

  if (act.canCheck) {
    refs.actions.appendChild(button('check', '체크', '', () => send('check')));
  } else {
    refs.actions.appendChild(button('call', '콜', formatChips(act.toCall), () => send('call')));
  }

  if (!act.canRaise) return;

  const min = act.minRaiseTo;
  const max = act.maxRaiseTo;
  if (raiseValue === null || raiseValue < min || raiseValue > max) {
    raiseValue = Math.min(max, Math.max(min, Math.round(pot * 0.6 + s.hand.currentBet)));
  }

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
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(Math.max(1, Math.round(s.config.bb / 2)));

  const sync = () => {
    slider.value = String(raiseValue);
    amount.textContent = formatChips(raiseValue);
    slider.style.setProperty('--fill', `${max > min ? ((raiseValue - min) / (max - min)) * 100 : 100}%`);
    raiseBtn.querySelector('small').textContent = raiseValue >= max ? '올인' : formatChips(raiseValue);
  };

  slider.addEventListener('input', () => { raiseValue = Number(slider.value); sync(); });

  for (const [label, fraction] of [['½팟', 0.5], ['⅔팟', 0.667], ['팟', 1], ['올인', null]]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'quick-btn';
    b.textContent = label;
    b.addEventListener('click', () => {
      const target = fraction === null ? max : s.hand.currentBet + Math.round(pot * fraction);
      raiseValue = Math.min(max, Math.max(min, target));
      sync();
    });
    quick.appendChild(b);
  }

  const raiseBtn = button('raise', act.isBet ? '벳' : '레이즈', formatChips(raiseValue),
    () => send('raise', raiseValue));

  panel.append(top, slider);
  refs.actions.append(panel, raiseBtn);
  sync();
}

function button(kind, label, sub, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `act-btn ${kind}`;
  b.innerHTML = `${label}<small>${sub}</small>`;
  b.addEventListener('click', () => { sound.unlock(); onClick(); });
  return b;
}

function send(type, amount) {
  raiseValue = null;
  net.send('action', { type, amount });
}

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

  const clock = $('clockLabel');
  clock.hidden = !game.startedAt;
  if (game.startedAt) clock.textContent = mmss(Date.now() - game.startedAt);

  // The level prefix only means something once a game is actually running.
  $('blindsLabel').textContent = game.rising && game.startedAt
    ? `L${game.level + 1} · ${formatChips(game.blinds.sb)} / ${formatChips(game.blinds.bb)}`
    : `블라인드 ${formatChips(game.blinds.sb)} / ${formatChips(game.blinds.bb)}`;

  const level = $('levelLabel');
  let text = null;
  let urgent = false;

  if (game.mode === 'timed' && game.endsAt) {
    const left = game.endsAt - Date.now();
    text = left > 0 ? `종료까지 ${mmss(left)}` : '마지막 핸드';
    urgent = left > 0 && left < 60_000;
  } else if (game.rising && game.levelEndsAt && game.nextBlinds) {
    const left = game.levelEndsAt - Date.now();
    text = left > 0
      ? `다음 ${formatChips(game.nextBlinds.sb)}/${formatChips(game.nextBlinds.bb)} · ${mmss(left)}`
      : '다음 핸드부터 블라인드 상승';
    urgent = left > 0 && left < 60_000;
  }

  level.hidden = text === null;
  if (text !== null) level.textContent = text;
  level.classList.toggle('urgent', urgent);
}

setInterval(paintClock, 1000);

/* ---------------------------- standings ---------------------------- */

function paintResults(s) {
  const results = s.game?.finished ? s.game.results : null;
  if (!results) { $('resultsModal').hidden = true; resultsKey = null; return; }

  // Render once; if the player closes it, a later snapshot must not reopen it.
  const key = `${results.reason}:${results.standings.length}:${results.durationMs}`;
  if (resultsKey === key) return;
  resultsKey = key;

  $('resultsTitle').textContent = results.standings[0]
    ? `${results.standings[0].name} 우승`
    : '게임 종료';
  $('resultsSub').textContent =
    `${MODE_LABEL[s.game.mode]} · ${results.reason} · ${results.hands}핸드 · ${mmss(results.durationMs)}`;

  $('standings').innerHTML = '';
  for (const row of results.standings) {
    const li = document.createElement('li');
    li.className = `standing ${row.place === 1 ? 'winner' : ''}`;
    li.innerHTML = `
      <span class="place">${row.place}</span>
      <span class="who">${escapeHtml(row.name)}${row.isBot ? ' <span class="bot-mark">BOT</span>' : ''}</span>
      <span class="chips">${row.stack > 0 ? formatChips(row.stack) : '탈락'}${
        row.rebuysUsed ? `<span class="rebuy-mark">리바이 ${row.rebuysUsed}</span>` : ''
      }</span>`;
    $('standings').appendChild(li);
  }

  const host = !!s.you?.isHost;
  $('btnNewGame').disabled = !host;
  $('btnNewGame').textContent = host ? '새 게임' : '호스트를 기다리는 중';
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
  $('inviteAlt').textContent = invite.hasLan
    ? (others.length ? `안 되면 이 주소도 시도해 보세요: ${others.join(', ')}` : '')
    : '이 컴퓨터가 네트워크에 연결되어 있지 않아 친구를 부를 주소를 찾지 못했습니다.';
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
    toast('주소를 복사했습니다');
  } catch {
    toast('복사가 막혀 있습니다 — 주소를 길게 눌러 직접 복사해 주세요', 'error');
  }
});

/* --------------------------- chrome & UI --------------------------- */

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const act = snapshot?.toAct;
  if (!act) return;
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
  if (snapshot) paint(snapshot);
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

  $('settingsNote').textContent = !host
    ? '호스트만 설정을 바꿀 수 있습니다.'
    : rising
      ? '블라인드는 레벨에 따라 자동으로 오릅니다. 나머지는 핸드가 끝난 뒤에 적용됩니다.'
      : '핸드가 끝난 뒤에 적용됩니다.';
  $('settingsModal').hidden = false;
});

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
  $('btnEndGame').textContent = '게임 끝내고 메인 메뉴로';
  $('btnEndGame').classList.remove('armed');
}

$('btnEndGame').addEventListener('click', () => {
  if (!endGameArmed) {
    endGameArmed = true;
    $('btnEndGame').textContent = '한 번 더 누르면 끝납니다';
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
  resizeRaf = requestAnimationFrame(() => { if (snapshot) paint(snapshot); });
});

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
