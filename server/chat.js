/**
 * Table chat. Messages are stored as the player typed them and escaped at
 * render time — never the other way round, so a name or a message can never
 * become markup on someone else's screen.
 */

export const MAX_MESSAGES = 100;
export const MAX_LENGTH = 200;
const MIN_INTERVAL_MS = 900;

export class ChatLog {
  constructor({ max = MAX_MESSAGES } = {}) {
    this.max = max;
    this.messages = [];
    this.lastPostAt = new Map();
    this.seq = 0;
  }

  /** @returns {{ok: true, message: object} | {ok: false, reason: string, code: string}} */
  post(player, rawText, now = Date.now()) {
    const text = clean(rawText);
    if (!text) return { ok: false, reason: 'Cannot send an empty message', code: 'chatEmpty' };

    const last = this.lastPostAt.get(player.id) ?? 0;
    if (now - last < MIN_INTERVAL_MS) return { ok: false, reason: 'Slow down a little', code: 'chatTooFast' };
    this.lastPostAt.set(player.id, now);

    return { ok: true, message: this.append({ name: player.name, text, at: now, system: false }) };
  }

  /**
   * A notice from the table. `text` is the English fallback; `key` and
   * `params` let each client word it in the viewer's own language.
   */
  system(text, { key = null, params = null } = {}, now = Date.now()) {
    const body = clean(text);
    if (!body) return null;
    const entry = { name: null, text: body, at: now, system: true };
    if (key) entry.key = key;
    if (params) entry.params = params;
    return this.append(entry);
  }

  append(message) {
    const entry = { id: ++this.seq, ...message };
    this.messages.push(entry);
    if (this.messages.length > this.max) {
      this.messages.splice(0, this.messages.length - this.max);
    }
    return entry;
  }

  recent() {
    return this.messages;
  }

  forget(playerId) {
    this.lastPostAt.delete(playerId);
  }

  clear() {
    this.messages = [];
    this.lastPostAt.clear();
    this.seq = 0;
  }
}

function clean(text) {
  return String(text ?? '')
    // Control characters become a space: deleting them outright would glue
    // "hello\nHost: ..." into one word and lose the separation entirely.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    // Invisible marks are dropped. \u200d (zero-width joiner) is deliberately
    // left in — it holds emoji sequences together.
    .replace(/[\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LENGTH);
}
