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
const MODE_PRESETS = [
  { key: 'tournament', label: '토너먼트' },
  { key: 'timed', label: '시간 제한' },
  { key: 'cash', label: '캐시 게임' },
];
const LEVEL_PRESETS = [5, 10, 15];
const TOTAL_PRESETS = [30, 60, 90];

const MODE_BLURB = {
  tournament: '블라인드가 오르고, 칩을 다 잃으면 탈락합니다. 마지막 한 명이 우승.',
  timed: '정해진 시간이 지나면 칩이 가장 많은 사람이 우승합니다.',
  cash: '블라인드 고정, 칩이 떨어지면 자동 리바이. 끝없이 연습만 합니다.',
};

const $ = (id) => document.getElementById(id);

export const MODE_LABEL = { tournament: '토너먼트', timed: '시간 제한', cash: '캐시 게임' };

const state = {
  screen: 'host',    // host | join
  gameMode: 'tournament',
  bots: 4,
  blindIndex: 1,
  stack: 10000,
  levelMinutes: 10,
  totalMinutes: 60,
  open: true,
};

let handlers = {};

export function initMenu(h) {
  handlers = h;

  buildPresets($('modePresets'), MODE_PRESETS.map((m) => ({
    label: m.label,
    isActive: () => state.gameMode === m.key,
    select: () => { state.gameMode = m.key; syncMode(); },
  })));

  buildPresets($('levelPresets'), LEVEL_PRESETS.map((m) => ({
    label: `${m}분`,
    isActive: () => state.levelMinutes === m,
    select: () => { state.levelMinutes = m; },
  })));

  buildPresets($('totalPresets'), TOTAL_PRESETS.map((m) => ({
    label: `${m}분`,
    isActive: () => state.totalMinutes === m,
    select: () => { state.totalMinutes = m; },
  })));

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
  syncMode();
}

/** Only show the clock options the chosen mode actually uses. */
function syncMode() {
  $('levelRow').hidden = state.gameMode === 'cash';
  $('totalRow').hidden = state.gameMode !== 'timed';
  $('modeBlurb').textContent = MODE_BLURB[state.gameMode];
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

  if (state.screen === 'host') {
    const { sb, bb } = BLIND_PRESETS[state.blindIndex];
    handlers.onStart?.({
      name, seat: 0, sb, bb,
      startingStack: state.stack,
      bots: state.bots,
      mode: state.gameMode,
      levelMinutes: state.levelMinutes,
      totalMinutes: state.totalMinutes,
    });
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
  state.screen = seated.length === 0 ? 'host' : 'join';

  const hosting = state.screen === 'host';
  $('hostSetup').hidden = !hosting;
  $('joinSummary').hidden = hosting;
  $('menuEnter').textContent = hosting ? '게임 시작' : '참가하기';
  $('menuTagline').textContent = hosting
    ? '같은 와이파이에 있는 친구들과 하는 홀덤 연습 테이블'
    : '이미 열려 있는 테이블입니다. 이름만 정하면 바로 앉습니다.';

  if (!hosting) {
    const free = snapshot.seats.filter((s) => s === null).length;
    const game = snapshot.game;
    const locked = game.mode === 'tournament' && game.startedAt !== null;

    $('joinSummary').innerHTML = `
      <div class="summary-row"><span>게임 방식</span><strong>${MODE_LABEL[game.mode]}</strong></div>
      <div class="summary-row"><span>블라인드</span><strong>${formatChips(game.blinds.sb)} / ${formatChips(game.blinds.bb)}</strong></div>
      <div class="summary-row"><span>시작 스택</span><strong>${formatChips(snapshot.config.startingStack)}</strong></div>
      <div class="summary-row"><span>앉은 사람</span><strong>${seated.length}명 (사람 ${humans})</strong></div>`;

    if (locked) {
      $('menuEnter').disabled = true;
      $('menuEnter').textContent = '토너먼트 진행 중';
      $('menuTagline').textContent = '이미 시작된 토너먼트에는 참가할 수 없습니다. 관전은 됩니다.';
    } else if (free === 0) {
      $('menuEnter').disabled = true;
      $('menuEnter').textContent = '자리가 없습니다';
    } else {
      $('menuEnter').disabled = false;
      $('menuEnter').textContent = '참가하기';
    }
  } else {
    $('menuEnter').disabled = false;
  }
}
