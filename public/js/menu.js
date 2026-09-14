/**
 * The main menu. It reads the same snapshot the table does, so it always knows
 * whether it is opening a table or joining one that is already running.
 */

import { formatChips } from './chips.js';

const BLIND_PRESETS = [
  { sb: 25, bb: 50 },
  { sb: 50, bb: 100 },
  { sb: 100, bb: 200 },
  { sb: 200, bb: 400 },
];
const STACK_PRESETS = [5000, 10000, 20000, 50000];

const $ = (id) => document.getElementById(id);

const state = {
  mode: 'host',      // host | join
  bots: 4,
  blindIndex: 1,
  stack: 10000,
  open: true,
};

let handlers = {};

export function initMenu(h) {
  handlers = h;

  buildPresets($('blindPresets'), BLIND_PRESETS.map((b, i) => ({
    label: `${formatChips(b.sb)} / ${formatChips(b.bb)}`,
    isActive: () => state.blindIndex === i,
    select: () => { state.blindIndex = i; },
  })));

  buildPresets($('stackPresets'), STACK_PRESETS.map((v) => ({
    label: formatChips(v),
    isActive: () => state.stack === v,
    select: () => { state.stack = v; },
  })));

  $('botMinus').addEventListener('click', () => setBots(state.bots - 1));
  $('botPlus').addEventListener('click', () => setBots(state.bots + 1));
  $('menuEnter').addEventListener('click', enter);
  $('menuName').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
  $('menuInvite').addEventListener('click', () => handlers.onInvite?.());
  $('menuWatch').addEventListener('click', () => {
    state.open = false;
    hide();
    handlers.onWatch?.();
  });

  setBots(state.bots);
}

function buildPresets(host, items) {
  host.innerHTML = '';
  const buttons = items.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.textContent = item.label;
    b.addEventListener('click', () => {
      item.select();
      buttons.forEach((btn, i) => btn.classList.toggle('on', items[i].isActive()));
    });
    host.appendChild(b);
    return b;
  });
  buttons.forEach((btn, i) => btn.classList.toggle('on', items[i].isActive()));
}

function setBots(n) {
  state.bots = Math.max(0, Math.min(9, n));
  $('botCount').textContent = String(state.bots);
  $('botMinus').disabled = state.bots === 0;
  $('botPlus').disabled = state.bots === 9;
}

function enter() {
  const name = $('menuName').value.trim();
  if (!name) { $('menuName').focus(); return; }

  if (state.mode === 'host') {
    const { sb, bb } = BLIND_PRESETS[state.blindIndex];
    handlers.onStart?.({ name, seat: 0, sb, bb, startingStack: state.stack, bots: state.bots });
  } else {
    handlers.onJoin?.({ name });
  }
}

export function setName(name) {
  if (name) $('menuName').value = name;
}

export function isOpen() { return state.open; }

export function reopen() {
  state.open = true;
  $('menu').hidden = false;
}

export function hide() {
  $('menu').hidden = true;
}

/** Re-read the table and switch between "open a table" and "join one". */
export function updateMenu(snapshot) {
  if (!state.open) return;
  $('menu').hidden = false;

  const seated = snapshot.seats.filter(Boolean);
  const humans = seated.filter((s) => !s.isBot).length;
  state.mode = seated.length === 0 ? 'host' : 'join';

  const hosting = state.mode === 'host';
  $('hostSetup').hidden = !hosting;
  $('joinSummary').hidden = hosting;
  $('menuEnter').textContent = hosting ? '게임 시작' : '참가하기';
  $('menuTagline').textContent = hosting
    ? '같은 와이파이에 있는 친구들과 하는 홀덤 연습 테이블'
    : '이미 열려 있는 테이블입니다. 이름만 정하면 바로 앉습니다.';

  if (!hosting) {
    const free = snapshot.seats.filter((s) => s === null).length;
    $('joinSummary').innerHTML = `
      <div class="summary-row"><span>블라인드</span><strong>${formatChips(snapshot.config.sb)} / ${formatChips(snapshot.config.bb)}</strong></div>
      <div class="summary-row"><span>시작 스택</span><strong>${formatChips(snapshot.config.startingStack)}</strong></div>
      <div class="summary-row"><span>앉은 사람</span><strong>${seated.length}명 (사람 ${humans})</strong></div>`;
    $('menuEnter').disabled = free === 0;
    if (free === 0) $('menuEnter').textContent = '자리가 없습니다';
  } else {
    $('menuEnter').disabled = false;
  }
}
