/**
 * Snapshot -> DOM. Elements are keyed and reused so CSS transitions survive
 * a repaint; only genuinely new cards get the dealing animation.
 */

import { cardFaceSVG, cardBackSVG, cardKey } from './cards.js';
import { chipStackEl, formatChips } from './chips.js';

const LAYOUT = {
  landscape: { rx: 45, ry: 41, betR: 0.60 },
  portrait: { rx: 37, ry: 45, betR: 0.58 },
};

const STREET_LABEL = {
  preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버',
  showdown: '쇼다운', complete: '핸드 종료',
};

let refs = null;
let onSit = () => {};
let onAddBot = () => {};
let onKick = () => {};

// Decoration that lives between snapshots: what each seat last did, who won.
const decor = {
  handId: null,
  street: null,
  actions: new Map(),     // seat -> { text, kind }
  winners: new Map(),     // seat -> amount
  winningKeys: new Map(), // seat -> Set of card keys
  handNames: new Map(),   // seat -> string
};

let timerKey = null;

export function initRender(elements, handlers) {
  refs = elements;
  onSit = handlers.onSit;
  onAddBot = handlers.onAddBot;
  onKick = handlers.onKick;
}

export function resetDecor() {
  decor.actions.clear();
  decor.winners.clear();
  decor.winningKeys.clear();
  decor.handNames.clear();
}

/* ---------------------------- geometry ---------------------------- */

function profile() {
  const r = refs.table.getBoundingClientRect();
  return r.height > r.width ? LAYOUT.portrait : LAYOUT.landscape;
}

function displayIndex(seat, snapshot) {
  const hero = snapshot.you?.seat ?? 0;
  const n = snapshot.config.maxSeats;
  return ((seat - hero) % n + n) % n;
}

export function seatPercent(seat, snapshot) {
  const { rx, ry } = profile();
  const n = snapshot.config.maxSeats;
  const theta = ((90 + displayIndex(seat, snapshot) * (360 / n)) * Math.PI) / 180;
  return { x: 50 + rx * Math.cos(theta), y: 50 + ry * Math.sin(theta) };
}

export function betPercent(seat, snapshot) {
  const { rx, ry, betR } = profile();
  const n = snapshot.config.maxSeats;
  const theta = ((90 + displayIndex(seat, snapshot) * (360 / n)) * Math.PI) / 180;
  return { x: 50 + rx * betR * Math.cos(theta), y: 50 + ry * betR * Math.sin(theta) };
}

/* ----------------------------- events ----------------------------- */

/** Fold the event stream into the decoration state before repainting. */
export function noteEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'handStart':
        decor.handId = e.handId;
        decor.street = 'preflop';
        resetDecor();
        break;
      case 'community':
        decor.street = e.street;
        decor.actions.clear();
        break;
      case 'action':
        decor.actions.set(e.seat, actionTag(e));
        break;
      case 'postBlind':
        decor.actions.set(e.seat, { text: e.kind === 'sb' ? 'SB' : 'BB', kind: 'check' });
        break;
      case 'showdown':
        decor.handNames.set(e.seat, e.name);
        break;
      case 'rebuy':
        decor.actions.set(e.seat, {
          text: e.remaining === null ? '리바이' : `리바이 · ${e.remaining}회 남음`,
          kind: 'rebuy',
        });
        break;
      case 'knockOut':
        decor.actions.set(e.seat, { text: '탈락', kind: 'out' });
        break;
      case 'awardPot': {
        decor.winners.set(e.seat, (decor.winners.get(e.seat) ?? 0) + e.amount);
        if (e.winningCards?.length) {
          decor.winningKeys.set(e.seat, new Set(e.winningCards.map(cardKey)));
        }
        if (e.handName) decor.handNames.set(e.seat, e.handName);
        break;
      }
      default:
        break;
    }
  }
}

function actionTag(e) {
  if (e.action === 'fold') return { text: '폴드', kind: 'fold' };
  if (e.action === 'check') return { text: '체크', kind: 'check' };
  if (e.allIn) return { text: '올인', kind: 'allin' };
  if (e.action === 'call') return { text: `콜 ${formatChips(e.amount)}`, kind: 'call' };
  const verb = e.isBet ? '벳' : '레이즈';
  return { text: `${verb} ${formatChips(e.amount)}`, kind: 'raise' };
}

/* ----------------------------- painting ---------------------------- */

export function paint(snapshot) {
  const table = refs.table.getBoundingClientRect();
  refs.table.style.setProperty('--u', `${table.width / 100}px`);

  paintSeats(snapshot, table);
  paintBets(snapshot);
  paintBoard(snapshot);
  paintPot(snapshot);
  paintStatus(snapshot);
  paintTimer(snapshot);
  markShowdown(snapshot);
}

function paintSeats(snapshot, tableRect) {
  const wanted = new Set();

  for (let seat = 0; seat < snapshot.config.maxSeats; seat++) {
    const data = snapshot.seats[seat];
    const pos = seatPercent(seat, snapshot);
    const key = `seat-${seat}`;
    wanted.add(key);

    let el = refs.seats.querySelector(`[data-key="${key}"]`);
    if (!el) {
      el = document.createElement('div');
      el.dataset.key = key;
      refs.seats.appendChild(el);
    }
    el.style.setProperty('--x', pos.x.toFixed(2));
    el.style.setProperty('--y', pos.y.toFixed(2));

    if (!data) {
      renderEmptySeat(el, seat, snapshot);
    } else {
      renderOccupiedSeat(el, data, snapshot, tableRect, pos);
    }
  }

  for (const el of [...refs.seats.children]) {
    if (!wanted.has(el.dataset.key)) el.remove();
  }
}

function renderEmptySeat(el, seat, snapshot) {
  if (el.dataset.mode !== 'empty') {
    el.dataset.mode = 'empty';
    el.className = 'seat empty';
    el.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'seat-empty';
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (btn.dataset.act === 'sit') onSit(seat);
      else if (btn.dataset.act === 'bot') onAddBot(seat);
    });
    el.appendChild(btn);
  }

  // Sitting down comes first; once you are seated an empty seat is somewhere
  // to drop a bot, which is what the host actually wants to do with it.
  const btn = el.firstElementChild;
  const canSit = !snapshot.you?.seated;
  const canBot = !canSit && !!snapshot.you?.isHost;

  btn.dataset.act = canSit ? 'sit' : canBot ? 'bot' : '';
  btn.textContent = canSit ? '여기 앉기' : canBot ? '+ 봇 추가' : '빈 자리';
  btn.classList.toggle('bot-slot', canBot);
  btn.disabled = !canSit && !canBot;
}

function renderOccupiedSeat(el, data, snapshot, tableRect, pos) {
  if (el.dataset.mode !== 'filled') {
    el.dataset.mode = 'filled';
    el.innerHTML = `
      <div class="seat-cards"></div>
      <div class="seat-plate">
        <div class="seat-name"></div>
        <div class="seat-stack"></div>
        <div class="seat-state"></div>
        <div class="timer-bar" hidden></div>
      </div>`;
    const kick = document.createElement('button');
    kick.className = 'kick-seat';
    kick.type = 'button';
    kick.textContent = '×';
    kick.title = '이 자리 비우기';
    kick.addEventListener('click', () => onKick(data.seat));
    el.appendChild(kick);
  }

  const acting = snapshot.hand && !snapshot.hand.complete && snapshot.hand.currentSeat === data.seat;
  el.className = [
    'seat',
    data.isMe ? 'me' : '',
    data.isBot ? 'bot' : '',
    data.folded ? 'folded' : '',
    data.sittingOut ? 'sitting-out' : '',
    data.connected ? '' : 'disconnected',
    acting ? 'acting' : '',
  ].filter(Boolean).join(' ');

  el.querySelector('.seat-name').textContent = data.name;
  el.querySelector('.seat-stack').textContent =
    data.stack > 0 ? formatChips(data.stack) : (data.inHand ? 'ALL IN' : '—');
  el.querySelector('.seat-state').textContent = seatState(data);

  // The host can clear any seat — a bot, or a friend who stopped answering.
  const kick = el.querySelector('.kick-seat');
  kick.classList.toggle('available', !!snapshot.you?.isHost && !data.isMe);

  paintSeatCards(el.querySelector('.seat-cards'), data, snapshot, tableRect, pos);
  paintSeatTag(el, data);
  paintDealerButton(el, data);
  paintHandName(el, data, snapshot);
}

function seatState(data) {
  if (!data.connected) return '연결 끊김';
  if (data.sittingOut) return '자리 비움';
  if (data.waiting) return '다음 핸드 대기';
  return '';
}

function paintSeatCards(box, data, snapshot, tableRect, pos) {
  const count = data.cardCount;
  const keys = [];
  for (let i = 0; i < count; i++) {
    const card = data.cards?.[i] ?? null;
    keys.push(`${i}:${card ? cardKey(card) : 'back'}`);
  }
  if (box.dataset.keys === keys.join(',')) return;

  const hadCards = (box.dataset.keys ?? '') !== '';
  box.dataset.keys = keys.join(',');
  box.innerHTML = '';

  // Cards travel from the middle of the table out to the seat.
  const dx = ((50 - pos.x) / 100) * tableRect.width;
  const dy = ((50 - pos.y) / 100) * tableRect.height;

  keys.forEach((key, i) => {
    const card = data.cards?.[i] ?? null;
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = card ? cardFaceSVG(card) : cardBackSVG();
    if (!hadCards) {
      el.classList.add('enter');
      el.style.setProperty('--from-x', `${dx}px`);
      el.style.setProperty('--from-y', `${dy}px`);
      el.style.setProperty('--from-rot', `${i % 2 ? 14 : -14}deg`);
      el.style.animationDelay = `${i * 80}ms`;
    } else {
      el.classList.add('flip');   // cards turned face up mid-hand
    }
    box.appendChild(el);
  });
}

function paintSeatTag(el, data) {
  const win = decor.winners.get(data.seat);
  const tag = win ? { text: `+${formatChips(win)}`, kind: 'win' } : decor.actions.get(data.seat);
  let node = el.querySelector('.seat-tag');

  if (!tag) { node?.remove(); return; }
  const signature = `${tag.kind}|${tag.text}`;
  if (node && node.dataset.sig === signature) return;

  node?.remove();
  node = document.createElement('div');
  node.className = `seat-tag ${tag.kind}`;
  node.dataset.sig = signature;
  node.textContent = tag.text;
  el.appendChild(node);
}

function paintDealerButton(el, data) {
  let btn = el.querySelector('.dealer-button');
  if (data.isDealer && data.inHand) {
    if (!btn) {
      btn = document.createElement('div');
      btn.className = 'dealer-button';
      btn.textContent = 'D';
      el.appendChild(btn);
    }
  } else {
    btn?.remove();
  }
}

function paintHandName(el, data, snapshot) {
  const name = snapshot.hand?.complete ? decor.handNames.get(data.seat) : null;
  let node = el.querySelector('.hand-name');
  if (!name || data.folded) { node?.remove(); return; }
  if (!node) {
    node = document.createElement('div');
    node.className = 'hand-name';
    el.appendChild(node);   // on the seat, not the plate: the plate clips overflow
  }
  node.textContent = name;
}

function paintBets(snapshot) {
  const wanted = new Set();
  for (const data of snapshot.seats) {
    if (!data || !data.committed) continue;
    const key = `bet-${data.seat}`;
    wanted.add(key);
    const pos = betPercent(data.seat, snapshot);

    let el = refs.bets.querySelector(`[data-key="${key}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'bet';
      el.dataset.key = key;
      refs.bets.appendChild(el);
    }
    el.style.setProperty('--x', pos.x.toFixed(2));
    el.style.setProperty('--y', pos.y.toFixed(2));
    if (el.dataset.amount !== String(data.committed)) {
      el.dataset.amount = String(data.committed);
      el.innerHTML = '';
      el.appendChild(chipStackEl(data.committed));
    }
  }
  for (const el of [...refs.bets.children]) {
    if (!wanted.has(el.dataset.key)) el.remove();
  }
}

function paintBoard(snapshot) {
  const board = snapshot.hand?.board ?? [];
  const keys = board.map(cardKey).join(',');
  if (refs.board.dataset.keys === keys) return;

  const previous = (refs.board.dataset.keys ?? '').split(',').filter(Boolean);
  refs.board.dataset.keys = keys;
  refs.board.innerHTML = '';

  board.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = cardFaceSVG(card);
    if (i >= previous.length) {
      el.classList.add('flip');
      el.style.animationDelay = `${(i - previous.length) * 110}ms`;
    }
    refs.board.appendChild(el);
  });
}

/**
 * At the end of a hand, light up the five cards that actually won and fade
 * everything else. Runs on every paint, because the board itself does not
 * change when the hand completes.
 */
function markShowdown(snapshot) {
  const done = !!snapshot.hand?.complete && decor.winningKeys.size > 0;
  const winning = new Set();
  if (done) for (const set of decor.winningKeys.values()) for (const key of set) winning.add(key);

  const mark = (el, card) => {
    el.classList.toggle('win', done && winning.has(cardKey(card)));
    el.classList.toggle('dim', done && !winning.has(cardKey(card)));
  };

  const board = snapshot.hand?.board ?? [];
  [...refs.board.children].forEach((el, i) => { if (board[i]) mark(el, board[i]); });

  for (const seatData of snapshot.seats) {
    if (!seatData?.cards) continue;
    const box = refs.seats.querySelector(`[data-key="seat-${seatData.seat}"] .seat-cards`);
    if (!box) continue;
    [...box.children].forEach((el, i) => { if (seatData.cards[i]) mark(el, seatData.cards[i]); });
  }
}

function paintPot(snapshot) {
  const total = snapshot.hand?.complete ? 0 : (snapshot.hand?.potTotal ?? 0);
  if (!snapshot.hand || total <= 0) { refs.pot.innerHTML = ''; refs.pot.dataset.amount = '0'; return; }
  if (refs.pot.dataset.amount === String(total)) return;

  refs.pot.dataset.amount = String(total);
  refs.pot.innerHTML = '';
  const stack = chipStackEl(snapshot.hand.potCollected || total, { label: false });
  const label = document.createElement('span');
  label.className = 'pot-label';
  label.textContent = 'POT';
  const value = document.createElement('span');
  value.className = 'pot-value';
  value.textContent = formatChips(total);
  refs.pot.append(stack, label, value);
}

function paintStatus(snapshot) {
  refs.status.textContent = statusText(snapshot);
}

function statusText(snapshot) {
  if (snapshot.phase === 'countdown') return '곧 시작합니다…';
  if (snapshot.phase === 'idle') {
    const seated = snapshot.seats.filter(Boolean).length;
    return seated < 2 ? '플레이어를 기다리는 중 — 친구를 부르거나 봇을 추가하세요' : '대기 중';
  }
  if (snapshot.hand?.complete) {
    const names = [...decor.winners.keys()]
      .map((s) => snapshot.seats[s]?.name)
      .filter(Boolean);
    if (names.length) return `${names.join(', ')} 승리`;
    return '핸드 종료';
  }
  return STREET_LABEL[snapshot.hand?.street] ?? '';
}

function paintTimer(snapshot) {
  const seat = snapshot.hand?.complete ? null : snapshot.hand?.currentSeat;
  const key = `${seat}:${snapshot.deadline ?? 0}`;

  for (const el of refs.seats.querySelectorAll('.timer-bar')) el.hidden = true;
  if (seat === null || seat === undefined || !snapshot.deadline) { timerKey = key; return; }

  const el = refs.seats.querySelector(`[data-key="seat-${seat}"] .timer-bar`);
  if (!el) return;
  el.hidden = false;

  if (timerKey === key) return;
  timerKey = key;

  const totalMs = snapshot.config.turnSeconds * 1000;
  const remaining = Math.max(0, snapshot.deadline - Date.now());
  el.classList.toggle('low', remaining < totalMs * 0.35);
  el.style.transition = 'none';
  el.style.transform = `scaleX(${Math.min(1, remaining / totalMs)})`;
  void el.offsetWidth;
  el.style.transition = `transform ${remaining}ms linear`;
  el.style.transform = 'scaleX(0)';
}
