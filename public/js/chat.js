/**
 * Chat rendering. Every message written by a person goes in through
 * `textContent` — never innerHTML — so a name or a message can only ever
 * appear as text on someone else's screen.
 */

const KEEP_ON_SCREEN = 120;

/**
 * Appends whatever is new since the last call.
 * @returns the number of messages added, for the unread badge.
 */
export function renderChat(listEl, messages, myName) {
  const seen = Number(listEl.dataset.lastId ?? 0);
  const fresh = messages.filter((m) => m.id > seen);
  if (fresh.length === 0) return 0;

  // Only follow the conversation if the reader was already at the bottom.
  const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 48;

  for (const message of fresh) listEl.appendChild(messageEl(message, myName));
  listEl.dataset.lastId = String(messages[messages.length - 1].id);

  while (listEl.children.length > KEEP_ON_SCREEN) listEl.firstElementChild.remove();
  if (atBottom) listEl.scrollTop = listEl.scrollHeight;

  return fresh.length;
}

function messageEl(message, myName) {
  const li = document.createElement('li');

  if (message.system) {
    li.className = 'chat-line system';
    li.textContent = message.text;
    return li;
  }

  li.className = `chat-line${message.name === myName ? ' mine' : ''}`;

  const who = document.createElement('span');
  who.className = 'chat-who';
  who.textContent = message.name;

  const body = document.createElement('span');
  body.className = 'chat-text';
  body.textContent = message.text;

  li.append(who, body);
  return li;
}

/** Wire a chat form to a sender, with the empty-message case handled here. */
export function bindChatForm(formEl, inputEl, send) {
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    send(text);
  });
}
