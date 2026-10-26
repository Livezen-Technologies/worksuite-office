// The Smart Typing key-handling state machine, with no DOM. The plugin feeds it what the editor reports
// (onInputHelperInput's text, the keys the editor hands over while the popup is shown, the context being
// cleared) and carries out the actions it returns. Lookups are asynchronous: input() returns a "query"
// with a sequence number, the plugin runs it (in a worker, or at once) and hands the answer to deliver();
// an answer whose number is not the latest is dropped, so a slow lookup never shows stale words.
//
// States: idle -> pending (query out) -> open (popup shown, selected -1 or an item) -> idle.
//   Singlish composition: the first item is selected from the start; Space/punctuation write it (as
//     configured), 1-9 write that item, Enter writes the selected one.
//   English / Sinhala Unicode completion: nothing is selected until Up/Down; Tab writes the selected item
//     (or the first); Enter writes only an item the user selected, otherwise the popup closes and Enter
//     is handed back ("pass"); Space closes the popup and the word stays as typed.
//   Esc closes. Ctrl/Cmd+Space (open()) asks at once, also for the next word after a space.

import { InputMode } from "./lang";
import { SmartItem, SmartResult } from "./engine";

export type TypingAction =
  | { type: "query"; seq: number; before: string; mode: InputMode; manual: boolean }
  | { type: "show"; token: string; items: SmartItem[]; selected: number; ghost: string; composing: boolean }
  | { type: "hide"; clear?: boolean }
  /** Delete `replace` (characters before the caret) and write `text`; `item` is what was chosen. */
  | { type: "input"; text: string; replace: string; item: SmartItem; token: string }
  /** The key was not used: the editor should get it (Enter: a paragraph break). */
  | { type: "pass"; key: "enter" | "tab" }
  /** Ask the editor for the word before the caret and call resync() with it. */
  | { type: "resync" }
  /** A word was finished by typing (Space after it): learn it. */
  | { type: "finished"; word: string; prev: string | null }
  /** The user kept the Latin of a Singlish list (Esc, or Space with acceptSpace off). */
  | { type: "kept"; token: string };

export interface TypingOptions {
  mode?: InputMode;
  /** Show the popup (default true). Off: Singlish Space/punctuation still write the best match. */
  showWindow?: boolean;
  /** Singlish: Space and punctuation write the selected word (default true). */
  acceptSpace?: boolean;
  /** Which keys accept: "tab" (default), "enter" (Enter also accepts the first item) or "both". */
  acceptKey?: "tab" | "enter" | "both";
  /** The host can tell the word before the caret (documents): Backspace edits a composition. */
  canResync?: boolean;
}

export const KEY = { tab: 9, enter: 13, esc: 27, space: 32, pageUp: 33, pageDown: 34, end: 35, home: 36, up: 38, down: 40 };
const COMMIT = /^[ .,;:!?)\]}"'෴-]$/;
const LAST_WORD = /(\S+)\s*$/;

export class SmartTyping {
  mode: InputMode;
  token = "";
  items: SmartItem[] = [];
  selected = -1;
  /** The user moved the highlight (Up/Down/PageUp/...): Enter may accept. */
  active = false;
  composing = false;
  ghost = "";
  private seq = 0;
  private pendingSeq = 0;

  private visible = false;
  private base = "";

  constructor(private options: TypingOptions = {}) {
    this.mode = options.mode || "english";
  }

  get isVisible(): boolean { return this.visible; }
  get state(): "idle" | "pending" | "open" { return this.visible ? "open" : this.pendingSeq ? "pending" : "idle"; }
  set(options: TypingOptions): void { this.options = { ...this.options, ...options }; if (options.mode) this.mode = options.mode; }

  private reset(clear?: boolean): TypingAction[] {
    const was = this.visible;
    this.visible = false;
    this.items = [];
    this.selected = -1;
    this.active = false;
    this.composing = false;
    this.token = "";
    this.ghost = "";
    this.pendingSeq = 0;
    this.base = "";
    return was || clear ? [{ type: "hide", clear }] : [];
  }

  private query(before: string, manual: boolean): TypingAction[] {

    this.pendingSeq = ++this.seq;
    return [{ type: "query", seq: this.pendingSeq, before, mode: this.mode, manual }];
  }

  /** onInputHelperInput: `text` is what was typed since the editor's input context was last cleared. */
  input(text: string): TypingAction[] {
    const t = (this.base ? this.base : "") + (text || "");
    if (!text) return this.reset();
    const last = t.slice(-1);
    const prevText = t.slice(0, -1);
    // a key that ends the word: Singlish composition writes, everything else closes
    if (/\s/.test(last) || (/[^A-Za-z඀-෿‌‍'-]/.test(last))) {
      if (this.composing && this.items.length && this.token && prevText.endsWith(this.token)) {
        if (/^[1-9]$/.test(last)) {
          const n = Number(last) - 1;
          if (n < this.items.length) return this.accept(n, last, "");
        } else if (COMMIT.test(last)) {
          if (last === " " && this.options.acceptSpace === false) { const token = this.token; return this.reset().concat([{ type: "kept", token }]); }
          return this.accept(this.selected < 0 ? 0 : this.selected, last, "");
        }
      }
      const word = /\s/.test(last) ? LAST_WORD.exec(prevText) : null;
      const out = this.reset();
      if (word) {
        const before = prevText.slice(0, prevText.length - word[1].length);
        const prev = LAST_WORD.exec(before);
        out.push({ type: "finished", word: word[1].replace(/[^\p{L}\p{M}‍'-]+/gu, ""), prev: prev ? prev[1] : null });
      }
      return out;
    }
    this.base = "";
    return this.query(t, false);
  }

  /** Ctrl/Cmd+Space: ask now for `before` (the sentence before the caret), next-word predictions included. */
  open(before: string): TypingAction[] {
    return this.query(before, true);
  }

  /** The lookup for `seq` answered. */
  deliver(seq: number, r: SmartResult): TypingAction[] {
    if (seq !== this.pendingSeq) return []; // a newer keystroke asked since: stale
    this.pendingSeq = 0;
    if (!r.items.length) return this.reset();
    const keep = this.visible && this.token === r.token && this.active ? this.items[this.selected] : null;
    this.token = r.token;
    this.items = r.items;
    this.ghost = r.ghost;
    this.composing = r.phase === "word" && r.items[0].lang === "si" && /^[A-Za-z]+$/.test(r.token) && r.items[0].replace === r.token;
    const at = keep ? this.items.findIndex((i) => i.text === keep.text) : -1;
    this.selected = at >= 0 ? at : this.composing ? 0 : -1;
    if (at < 0) this.active = false;
    if (this.options.showWindow === false) { this.visible = false; return []; }
    this.visible = true;
    return [this.showAction()];
  }

  /** Later words for the same lookup (the local AI): shown without moving the highlight off its word. */
  update(r: SmartResult): TypingAction[] {
    if (!this.visible || this.pendingSeq || r.token !== this.token) return [];
    const keep = this.selected >= 0 ? this.items[this.selected] : null;
    this.items = r.items;
    const at = keep ? this.items.findIndex((i) => i.text === keep.text) : -1;
    this.selected = at >= 0 ? at : this.composing ? 0 : -1;
    return [this.showAction()];
  }

  private showAction(): TypingAction {
    return { type: "show", token: this.token, items: this.items, selected: this.selected, ghost: this.ghost, composing: this.composing };
  }

  private accept(index: number, typedAfter: string, _why: string): TypingAction[] {
    const item = this.items[index];
    const token = this.token;
    if (!item) return this.reset();
    const after = /^\d$/.test(typedAfter) ? "" : typedAfter;
    const out = this.reset();
    out.push({ type: "input", text: item.text + after, replace: item.replace + typedAfter, item, token });
    return out;
  }

  /** A key the editor handed over while the popup is shown. */
  key(keyCode: number): TypingAction[] {
    if (!this.visible) return [];
    const n = this.items.length;
    const ak = this.options.acceptKey || "tab";
    const move = (to: number): TypingAction[] => { this.selected = to; this.active = true; return [this.showAction()]; };
    switch (keyCode) {
      case KEY.up: return move(this.selected <= 0 ? n - 1 : this.selected - 1);
      case KEY.down: return move(this.selected < 0 || this.selected >= n - 1 ? 0 : this.selected + 1);
      case KEY.pageUp: return move(Math.max(0, this.selected - 5));
      case KEY.pageDown: return move(Math.min(n - 1, Math.max(0, this.selected) + 5));
      case KEY.home: return move(0);
      case KEY.end: return move(n - 1);
      case KEY.tab:
        if (ak === "enter") return this.reset().concat([{ type: "pass", key: "tab" }]);
        return this.accept(this.selected < 0 ? 0 : this.selected, "", "tab");
      case KEY.enter:
        if (this.selected >= 0 && (this.active || this.composing)) return this.accept(this.selected, "", "enter");
        if (ak !== "tab") return this.accept(0, "", "enter");
        return this.reset().concat([{ type: "pass", key: "enter" }]);
      case KEY.esc: {
        const kept: TypingAction[] = this.composing ? [{ type: "kept", token: this.token }] : [];
        return this.reset(true).concat(kept);
      }
      default: return [];
    }
  }

  /** A click on an item. */
  pick(index: number): TypingAction[] {
    return this.visible && index >= 0 && index < this.items.length ? this.accept(index, "", "click") : [];
  }

  /** The editor cleared its input context (Backspace, arrows, a click, or our own input). */
  cleared(): TypingAction[] {
    if (this.composing && this.token && this.options.canResync) {
      this.base = this.token;
      return [{ type: "resync" }];
    }
    return this.reset();
  }

  /** The word before the caret after cleared() asked for it: a shorter start of the composition goes on. */
  resync(wordBefore: string): TypingAction[] {
    const was = this.base;
    const word = typeof wordBefore === "string" ? wordBefore : "";
    if (was && /^[A-Za-z]+$/.test(word) && word.length < was.length && was.startsWith(word)) {
      this.base = word;
      return this.query(word, false).map((a) => a);
    }
    return this.reset();
  }

  /** The mode changed, typing stopped, or the selection/focus left the text: close at once. */
  stop(): TypingAction[] { return this.reset(true); }
  setMode(mode: InputMode): TypingAction[] { this.mode = mode; return this.reset(true); }
}

/**
 * The AI request rules: one request per pause in typing (debounced, `delay` ms after the last keystroke),
 * never per keystroke; a new keystroke cancels the timer and any request in flight; an answer is used
 * only if its key is still the current one. Timers are injected so tests run without waiting.
 */
export class AiScheduler {
  private timer: unknown = null;
  private inflight: { key: string; cancel: () => void } | null = null;
  private current = "";
  constructor(private readonly opts: {
    delay: number;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (t: unknown) => void;
    /** Starts the request; returns its cancel function. Calls `done(words)` when it answers. */
    run: (key: string, done: (words: { text: string; score?: number }[]) => void) => () => void;
    /** Called with fresh words for `key` (only while it is still current). */
    use: (key: string, words: { text: string; score?: number }[]) => void;
  }) {}

  /** A keystroke: cancel what is pending. */
  cancel(): void {
    if (this.timer !== null) { this.opts.clearTimer(this.timer); this.timer = null; }
    if (this.inflight) { this.inflight.cancel(); this.inflight = null; }
    this.current = "";
  }

  /** Local results are shown for `key`: ask the AI after the pause. */
  schedule(key: string): void {
    this.cancel();
    this.current = key;
    this.timer = this.opts.setTimer(() => {
      this.timer = null;
      let cancelled = false;
      const cancel = this.opts.run(key, (words) => {
        if (cancelled || this.current !== key) return;
        this.inflight = null;
        this.opts.use(key, words);
      });
      this.inflight = { key, cancel: () => { cancelled = true; cancel(); } };
    }, this.opts.delay);
  }
}
