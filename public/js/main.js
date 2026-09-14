import { connect, savedName, saveName } from './net.js';
import {
  initRender, paint, noteEvents, resetDecor, seatPercent, betPercent,
} from './render.js';
import { initAnim, flyChips, localCenter, percentToLocal, sparkle } from './anim.js';
import { formatChips } from './chips.js';
import { setFourColor } from './cards.js';
import * as sound from './sound.js';

const $ = (id) => document.getElementById(id);

const refs = {
  table: $('table'), seats: $('seats'), bets: $('bets'), fx: $('fx'),
  board: $('board'), pot: $('pot'), status: $('tableStatus'),
  actions: $('actions'), heroStrip: $('heroStrip'),
};

let snapshot = null;
let net = null;
let wantSeat = false;
let raiseValue = null;
let lastHandId = null;

/* ------------------------------ boot ------------------------------ */

initAnim({ fx: refs.fx, table: refs.table });
initRender(refs, {
  onSit: (seat) => net?.send('sit', { seat, name: savedName() }),
  onKickBot: (seat) => net?.send('removeBot', { seat }),
});

setFourColor(localStorage.getItem('pm-fourcolor') === '1');
$('btnFourColor').classList.toggle('on', localStorage.getItem('pm-fourcolor') === '1');
$('btnSound').classList.toggle('off', sound.isMuted());
$('btnSound').textContent = sound.isMuted() ? '✕' : '♪';

if (savedName()) {
  $('joinModal').hidden = true;
  start();
} else {
  $('nameInput').focus();
}

$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('nameInput').value.trim();
  if (!name) return;
  saveName(name);
  $('joinModal').hidden = true;
  sound.unlock();
  wantSeat = true;
  start();
});

function start() {
  net = connect({
    onUpdate: handleUpdate,
    onIdentity: (p) => { if (p.seat === null) wantSeat = wantSeat || !hasPlayed(); },
    onError: (message) => toast(message, 'error'),
    onStatus: (s) => {
      if (s === 'disconnected') toast('연결이 끊겼습니다 — 다시 연결하는 중…', 'error');
    },
  });
}

function hasPlayed() { return localStorage.getItem('pm-played') === '1'; }

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

  if (!first) {
    runEffects(events, before);
    playSounds(events);
  }

  if (wantSeat && !snapshot.you?.seated) {
    const free = snapshot.seats.findIndex((s) => s === null);
    if (free >= 0) {
      wantSeat = false;
      localStorage.setItem('pm-played', '1');
      net.send('sit', { seat: free, name: savedName() });
    }
  }

  $('blindsLabel').textContent = `블라인드 ${formatChips(snapshot.config.sb)} / ${formatChips(snapshot.config.bb)}`;
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
    if (toAct?.toCall > 0) addStrip('콜 금액', formatChips(toAct.toCall), 'to-call');
  }

  if (!toAct) {
    refs.actions.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'waiting-note';
    note.textContent = dockNote(s);
    refs.actions.appendChild(note);
    raiseValue = null;
    return;
  }
  renderActionButtons(s, toAct);
}

function addStrip(label, value, cls = '') {
  const span = document.createElement('span');
  span.className = cls;
  span.innerHTML = value ? `${label} <strong>${value}</strong>` : `<strong>${label}</strong>`;
  refs.heroStrip.appendChild(span);
}

function dockNote(s) {
  if (!s.you?.seated) return '빈 자리를 눌러 앉으세요 — 관전 중입니다';
  if (s.you.sittingOut) return '자리 비움 상태입니다';
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
    refs.actions.appendChild(
      button('call', '콜', formatChips(act.toCall), () => send('call')),
    );
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

  const presets = [
    ['½팟', 0.5], ['⅔팟', 0.667], ['팟', 1], ['올인', null],
  ];
  for (const [label, fraction] of presets) {
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

  const raiseBtn = button(
    'raise', act.isBet ? '벳' : '레이즈', formatChips(raiseValue),
    () => send('raise', raiseValue),
  );

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

$('btnStand').addEventListener('click', () => net?.send('stand'));

$('btnSettings').addEventListener('click', () => {
  if (!snapshot) return;
  $('cfgSb').value = snapshot.config.sb;
  $('cfgBb').value = snapshot.config.bb;
  $('cfgStack').value = snapshot.config.startingStack;
  $('cfgTurn').value = snapshot.config.turnSeconds;
  const host = !!snapshot.you?.isHost;
  for (const input of ['cfgSb', 'cfgBb', 'cfgStack', 'cfgTurn']) $(input).disabled = !host;
  $('btnAddBot').disabled = !host;
  $('settingsNote').textContent = host
    ? '핸드가 끝난 뒤에 적용됩니다.'
    : '호스트만 설정을 바꿀 수 있습니다.';
  $('settingsModal').hidden = false;
});

$('btnCloseSettings').addEventListener('click', () => { $('settingsModal').hidden = true; });
$('settingsModal').addEventListener('click', (e) => {
  if (e.target === $('settingsModal')) $('settingsModal').hidden = true;
});

$('btnAddBot').addEventListener('click', () => net?.send('addBot'));

$('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  net?.send('config', {
    sb: Number($('cfgSb').value),
    bb: Number($('cfgBb').value),
    startingStack: Number($('cfgStack').value),
    turnSeconds: Number($('cfgTurn').value),
  });
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
