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
const STRUCTURE_PRESETS = [
  { key: 'standard', label: '정석 1.5배' },
  { key: 'turbo', label: '터보 2배' },
];
const LEVEL_PRESETS = [5, 10, 15];
const TOTAL_PRESETS = [30, 60, 90];
const REBUY_PRESETS = [
  { value: 0, label: '없음' },
  { value: 1, label: '1회' },
  { value: 2, label: '2회' },
  { value: 3, label: '3회' },
  { value: -1, label: '무제한' },
];
const DEFAULT_REBUYS = { tournament: 0, timed: 0, cash: -1 };

/** The blurb has to describe the actual combination, not just the mode. */
function blurbFor(mode, rebuys, structure = 'standard') {
  const unlimited = rebuys === -1;
  const fate = unlimited
    ? '칩이 떨어지면 계속 리바이해서 탈락이 없습니다.'
    : rebuys === 0
      ? '칩을 잃으면 바로 탈락합니다.'
      : `리바이 ${rebuys}회를 다 쓰면 탈락합니다.`;

  if (mode === 'cash') {
    return `블라인드 고정. ${fate}${unlimited ? ' 끝없이 연습만 합니다.' : ' 마지막 한 명이 남으면 끝납니다.'}`;
  }
  const climb = structure === 'turbo'
    ? '블라인드가 레벨마다 2배가 됩니다'
    : '블라인드가 레벨마다 1.5배씩 오릅니다';

  if (mode === 'timed') {
    return `${climb}. 정한 시간이 지나면 칩 1위가 우승합니다. ${fate}`;
  }
  return `${climb}. ${fate}${unlimited ? ' 탈락이 없어 저절로 끝나지는 않습니다.' : ' 마지막 한 명이 우승합니다.'}`;
}

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
  structure: 'standard',
  rebuys: 0,
  rebuysTouched: false,
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

  buildPresets($('structurePresets'), STRUCTURE_PRESETS.map((x) => ({
    label: x.label,
    isActive: () => state.structure === x.key,
    select: () => { state.structure = x.key; syncBlurb(); },
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

  rebuyButtons = buildPresets($('rebuyPresets'), REBUY_PRESETS.map((r) => ({
    label: r.label,
    isActive: () => state.rebuys === r.value,
    select: () => { state.rebuys = r.value; state.rebuysTouched = true; syncBlurb(); },
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
  $('structureRow').hidden = state.gameMode === 'cash';
  $('totalRow').hidden = state.gameMode !== 'timed';
  // Each mode has a sensible rebuy default, but once you pick one it sticks.
  if (!state.rebuysTouched) {
    state.rebuys = DEFAULT_REBUYS[state.gameMode];
    repaintPresets(rebuyButtons);
  }
  syncBlurb();
}

function syncBlurb() {
  $('modeBlurb').textContent = blurbFor(state.gameMode, state.rebuys, state.structure);
}

let rebuyButtons = [];

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
  return { buttons, items };
}

function repaintPresets(group) {
  if (!group) return;
  group.buttons.forEach((btn, i) => btn.classList.toggle('on', group.items[i].isActive()));
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
      structure: state.structure,
      rebuys: state.rebuys,
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
      <div class="summary-row"><span>상승 폭</span><strong>${game.rising ? game.structureLabel : '고정'}</strong></div>
      <div class="summary-row"><span>리바이</span><strong>${game.rebuysUnlimited ? '무제한' : (game.rebuys === 0 ? '없음' : `${game.rebuys}회`)}</strong></div>
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
