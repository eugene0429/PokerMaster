/**
 * The main menu. It reads the same snapshot the table does, so it always knows
 * whether it is opening a table or joining one that is already running.
 */

import { formatChips } from './chips.js';
import { renderChat, bindChatForm } from './chat.js';
import { t } from './i18n.js';

const BLIND_PRESETS = [
  { sb: 25, bb: 50 },
  { sb: 50, bb: 100 },
  { sb: 100, bb: 200 },
  { sb: 200, bb: 400 },
];
const STACK_PRESETS = [5000, 10000, 20000, 50000];
const MODE_PRESETS = ['tournament', 'timed', 'cash'];
const STRUCTURE_PRESETS = ['standard', 'turbo'];
const LEVEL_PRESETS = [5, 10, 15];
const TOTAL_PRESETS = [30, 60, 90];
const REBUY_PRESETS = [0, 1, 2, 3, -1];
const DEFAULT_REBUYS = { tournament: 0, timed: 0, cash: -1 };
const BOT_MODE_PRESETS = ['casual', 'practice'];
const BOT_SKILL_PRESETS = ['easy', 'normal', 'hard'];

/** How many rebuys, in words: none, a count, or unlimited. */
export function rebuyLabel(value) {
  if (value === -1) return t('rebuy.unlimited');
  if (value === 0) return t('rebuy.none');
  return t('rebuy.count', { n: value });
}

/** The blurb has to describe the actual combination, not just the mode. */
function blurbFor(mode, rebuys, structure = 'standard') {
  const unlimited = rebuys === -1;
  const fate = unlimited
    ? t('blurb.fateUnlimited')
    : rebuys === 0
      ? t('blurb.fateNone')
      : t('blurb.fateCount', { n: rebuys });

  if (mode === 'cash') return t('blurb.cash', { fate, unlimited });
  // Rebuys follow the blinds up, so a buy-back late in the game still plays.
  const deeper = rebuys === 0 ? '' : t('blurb.deeper');
  const climb = structure === 'turbo' ? t('blurb.climbTurbo') : t('blurb.climbStandard');

  if (mode === 'timed') return t('blurb.timed', { climb, fate, deeper });
  return t('blurb.tournament', { climb, fate, deeper, unlimited });
}

const $ = (id) => document.getElementById(id);

export const modeLabel = (mode) => t(`mode.${mode}`);

const state = {
  screen: 'host',    // host | waiting | join
  gameMode: 'tournament',
  bots: 4,
  blindIndex: 1,
  stack: 10000,
  levelMinutes: 10,
  totalMinutes: 60,
  structure: 'standard',
  rebuys: 0,
  rebuysTouched: false,
  botMode: 'casual',
  botSkill: 'normal',
  open: true,
};

let handlers = {};

export function initMenu(h) {
  handlers = h;

  buildPresets($('modePresets'), MODE_PRESETS.map((key) => ({
    label: () => modeLabel(key),
    isActive: () => state.gameMode === key,
    select: () => { state.gameMode = key; syncMode(); },
  })));

  buildPresets($('structurePresets'), STRUCTURE_PRESETS.map((key) => ({
    label: () => t(`structure.${key}Preset`),
    isActive: () => state.structure === key,
    select: () => { state.structure = key; syncBlurb(); },
  })));

  buildPresets($('levelPresets'), LEVEL_PRESETS.map((m) => ({
    label: () => t('menu.minutes', { n: m }),
    isActive: () => state.levelMinutes === m,
    select: () => { state.levelMinutes = m; },
  })));

  buildPresets($('totalPresets'), TOTAL_PRESETS.map((m) => ({
    label: () => t('menu.minutes', { n: m }),
    isActive: () => state.totalMinutes === m,
    select: () => { state.totalMinutes = m; },
  })));

  rebuyButtons = buildPresets($('rebuyPresets'), REBUY_PRESETS.map((value) => ({
    label: () => rebuyLabel(value),
    isActive: () => state.rebuys === value,
    select: () => { state.rebuys = value; state.rebuysTouched = true; syncBlurb(); },
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

  buildPresets($('botModePresets'), BOT_MODE_PRESETS.map((key) => ({
    label: () => t(`botMode.${key}`),
    isActive: () => state.botMode === key,
    select: () => { state.botMode = key; syncBotMode(); },
  })));

  buildPresets($('botSkillPresets'), BOT_SKILL_PRESETS.map((key) => ({
    label: () => t(`botSkill.${key}`),
    isActive: () => state.botSkill === key,
    select: () => { state.botSkill = key; },
  })));

  $('botMinus').addEventListener('click', () => setBots(state.bots - 1));
  $('botPlus').addEventListener('click', () => setBots(state.bots + 1));
  $('menuEnter').addEventListener('click', enter);
  $('menuName').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
  $('menuInvite').addEventListener('click', () => handlers.onInvite?.());
  $('lobbyInvite').addEventListener('click', () => handlers.onInvite?.());

  bindChatForm($('menuChatForm'), $('menuChatInput'), (text) => handlers.onChat?.(text));

  // Changing the name while waiting shows up in everyone else's roster.
  $('menuName').addEventListener('change', () => {
    const name = $('menuName').value.trim();
    if (name) handlers.onRename?.(name);
  });
  $('menuWatch').addEventListener('click', () => {
    state.open = false;
    hide();
    handlers.onWatch?.();
  });

  setBots(state.bots);
  syncMode();
  syncBotMode();
}

/** Difficulty only means something when every bot is a pro. */
function syncBotMode() {
  $('botSkillRow').hidden = state.botMode !== 'practice';
  $('botModeBlurb').textContent = t(`botMode.blurb.${state.botMode}`);
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
/** Every preset group, so a language change can reword their buttons. */
const presetGroups = [];

const labelOf = (item) => (typeof item.label === 'function' ? item.label() : item.label);

function buildPresets(host, items) {
  host.innerHTML = '';
  const buttons = items.map((item) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.textContent = labelOf(item);
    b.addEventListener('click', () => {
      item.select();
      buttons.forEach((btn, i) => btn.classList.toggle('on', items[i].isActive()));
    });
    host.appendChild(b);
    return b;
  });
  buttons.forEach((btn, i) => btn.classList.toggle('on', items[i].isActive()));
  const group = { buttons, items };
  presetGroups.push(group);
  return group;
}

/** Reword everything the menu wrote itself, after the language changes. */
export function relabelMenu() {
  for (const { buttons, items } of presetGroups) {
    buttons.forEach((btn, i) => { btn.textContent = labelOf(items[i]); });
  }
  syncBlurb();
  syncBotMode();
  // Only a menu that is on screen gets redrawn; a hidden one catches up when it reopens.
  if ($('menu').hidden) return;
  if (lastSnapshot) updateMenu(lastSnapshot);
  else $('menuEnter').textContent = t('menu.enter');
}

function repaintPresets(group) {
  if (!group) return;
  group.buttons.forEach((btn, i) => btn.classList.toggle('on', group.items[i].isActive()));
}

let botCeiling = 9;

/** The table is ten chairs: every friend who shows up costs a bot seat. */
function setBotCeiling(max) {
  botCeiling = Math.max(0, max);
  if (state.bots > botCeiling) state.bots = botCeiling;
  setBots(state.bots);
}

function setBots(n) {
  state.bots = Math.max(0, Math.min(botCeiling, n));
  $('botCount').textContent = String(state.bots);
  $('botMinus').disabled = state.bots === 0;
  $('botPlus').disabled = state.bots >= botCeiling;
}

function enter() {
  const name = $('menuName').value.trim();
  if (!name) { $('menuName').focus(); return; }

  if (state.screen === 'host') {
    const { sb, bb } = BLIND_PRESETS[state.blindIndex];
    handlers.onStart?.({
      name, sb, bb,
      startingStack: state.stack,
      bots: state.bots,
      mode: state.gameMode,
      levelMinutes: state.levelMinutes,
      totalMinutes: state.totalMinutes,
      structure: state.structure,
      rebuys: state.rebuys,
      botMode: state.botMode,
      botSkill: state.botSkill,
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

/** Re-read the table: are we setting one up, waiting on the host, or joining? */
let lastSnapshot = null;

export function updateMenu(snapshot) {
  lastSnapshot = snapshot;
  if (!state.open) return;
  $('menu').hidden = false;

  const seated = snapshot.seats.filter(Boolean);
  const humans = seated.filter((s) => !s.isBot).length;
  const running = seated.length > 0;
  const iAmHost = !!snapshot.you?.isHost;
  state.screen = running ? 'join' : (iAmHost ? 'host' : 'waiting');

  renderLobby(snapshot, running);
  renderChatPanel(snapshot);
  setBotCeiling(snapshot.maxBots ?? 9);

  const hosting = state.screen === 'host';
  $('hostSetup').hidden = !hosting;
  $('joinSummary').hidden = state.screen !== 'join';

  if (hosting) {
    $('menuEnter').textContent = t('menu.start');
    $('menuTagline').textContent = t('menu.taglineHost');
  } else if (state.screen === 'waiting') {
    $('menuEnter').textContent = t('menu.waitHost');
    $('menuEnter').disabled = true;
    $('menuTagline').textContent = t('menu.taglineWaiting');
  } else {
    $('menuEnter').textContent = t('menu.join');
    $('menuTagline').textContent = t('menu.taglineJoin');
  }

  if (state.screen === 'join') {
    const free = snapshot.seats.filter((s) => s === null).length;
    const game = snapshot.game;
    const locked = game.mode === 'tournament' && game.startedAt !== null;

    const bots = snapshot.config.botMode === 'practice'
      ? t('summary.botsPractice', { skill: t(`botSkill.${snapshot.config.botSkill}`) })
      : t('summary.botsCasual');
    const rows = [
      [t('summary.mode'), modeLabel(game.mode)],
      [t('summary.blinds'), `${formatChips(game.blinds.sb)} / ${formatChips(game.blinds.bb)}`],
      [t('summary.stack'), formatChips(snapshot.config.startingStack)],
      [t('summary.structure'), game.rising ? t(`structure.${game.structure ?? 'standard'}`) : t('summary.fixed')],
      [t('summary.bots'), bots],
      [t('summary.rebuys'), rebuyLabel(game.rebuysUnlimited ? -1 : game.rebuys)],
      [t('summary.seated'), t('summary.seatedCount', { n: seated.length, humans })],
    ];
    $('joinSummary').innerHTML = rows
      .map(([label, value]) => `<div class="summary-row"><span>${label}</span><strong>${value}</strong></div>`)
      .join('');

    if (locked) {
      $('menuEnter').disabled = true;
      $('menuEnter').textContent = t('menu.tournamentRunning');
      $('menuTagline').textContent = t('menu.taglineLocked');
    } else if (free === 0) {
      $('menuEnter').disabled = true;
      $('menuEnter').textContent = t('menu.noSeats');
    } else {
      $('menuEnter').disabled = false;
      $('menuEnter').textContent = t('menu.join');
    }
  } else if (hosting) {
    $('menuEnter').disabled = false;
  }
}

function renderLobby(snapshot, running) {
  const roster = snapshot.lobby ?? [];
  const seats = snapshot.config.maxSeats;
  $('lobbyLabel').textContent = running
    ? t('menu.spectators', { n: roster.length })
    : t('menu.players', { n: roster.length, max: seats });

  const list = $('lobbyList');
  list.innerHTML = '';
  if (roster.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'lobby-empty';
    empty.textContent = running ? t('menu.noSpectators') : t('menu.empty');
    list.appendChild(empty);
    return;
  }

  for (const member of roster) {
    const li = document.createElement('li');
    li.className = `lobby-member${member.name === snapshot.you?.name ? ' me' : ''}`;
    if (member.isHost) {
      const crown = document.createElement('span');
      crown.className = 'crown';
      crown.textContent = t('menu.host');
      li.appendChild(crown);
    }
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = member.name;          // never innerHTML: this is someone's input
    li.appendChild(who);
    list.appendChild(li);
  }
}

function renderChatPanel(snapshot) {
  renderChat($('menuChatList'), snapshot.chat ?? [], snapshot.you?.name);
}
