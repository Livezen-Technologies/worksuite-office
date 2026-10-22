// The Sinhala input method as a state machine with no DOM: the plugin feeds it what the editor reports
// (the text typed since the input context was last cleared, the navigation keys the editor hands to an
// open input helper, the context being cleared) and carries out the actions it returns.
//
// Like Google Input Tools: Latin letters go into the document as typed and are the composition; the
// candidate window lists the Sinhala renderings and completions. Space, Enter or punctuation writes the
// highlighted candidate, 1-9 writes that one, Up/Down/Tab/PageUp/PageDown/Home/End move the highlight,
// Esc keeps the Latin. Backspace edits the composition where the editor can tell the word before the
// cursor (documents); elsewhere it ends the composition and leaves the Latin.

import { Candidate, Learner, Lexicon, candidates } from "./suggest";

export type ImeAction =
  | { type: "show"; latin: string; items: Candidate[]; selected: number }
  | { type: "hide"; clear?: boolean }
  /** Delete `replace` (characters before the cursor) and type `text`. */
  | { type: "input"; text: string; replace: string }
  /** Ask the editor for the word before the cursor and call resync() with it. */
  | { type: "resync" }
  | { type: "learned" };

export interface ImeOptions {
  lexicon?: Lexicon | null;
  learner?: Learner | null;
  /** Can the host tell the word before the cursor (documents)? Then Backspace edits the composition. */
  canResync?: boolean;
  words?: number;
  completions?: number;
}

const COMMIT = /^[ .,;:!?)\]}"'෴-]$/;
const KEY = { tab: 9, enter: 13, esc: 27, pageUp: 33, pageDown: 34, end: 35, home: 36, up: 38, down: 40 };

export class SinhalaIme {
  latin = "";
  items: Candidate[] = [];
  selected = 0;
  private base = "";
  private visible = false;

  constructor(private readonly options: ImeOptions = {}) {}

  get isVisible(): boolean { return this.visible; }

  private show(): ImeAction[] {
    this.items = candidates(this.latin, {
      lexicon: this.options.lexicon, learner: this.options.learner,
      words: this.options.words, completions: this.options.completions,
    });
    if (!this.items.length) return this.reset();
    if (this.selected >= this.items.length) this.selected = 0;
    this.visible = true;
    return [{ type: "show", latin: this.latin, items: this.items, selected: this.selected }];
  }

  private reset(clear?: boolean): ImeAction[] {
    const was = this.visible;
    this.latin = "";
    this.base = "";
    this.items = [];
    this.selected = 0;
    this.visible = false;
    return was || clear ? [{ type: "hide", clear }] : [];
  }

  private commit(index: number, typedAfter: string): ImeAction[] {
    const item = this.items[index];
    const latin = this.latin;
    const actions: ImeAction[] = [];
    if (item) {
      actions.push({ type: "input", text: item.text + typedAfter.replace(/^\d$/, ""), replace: latin + typedAfter });
      if (this.options.learner) {
        this.options.learner.record(latin, item.text);
        actions.push({ type: "learned" });
      }
    }
    return this.reset().concat(actions);
  }

  /** The editor's onInputHelperInput: `text` is what was typed since the context was cleared. */
  input(text: string): ImeAction[] {
    const m = /([A-Za-z]+)([^A-Za-z]?)$/.exec(text || "");
    if (!m) return this.reset();
    // the letters typed since a resync continue the word before the cursor
    const continues = this.base && m.index === 0;
    const latin = (continues ? this.base : "") + m[1];
    const after = m[2];
    if (!after) {
      if (latin !== this.latin) this.selected = 0;
      this.latin = latin;
      return this.show();
    }
    if (this.visible && this.latin === latin) {
      if (/^[1-9]$/.test(after)) {
        const n = Number(after) - 1;
        if (n < this.items.length) return this.commit(n, after);
      } else if (COMMIT.test(after)) {
        return this.commit(this.selected, after);
      }
    }
    return this.reset();
  }

  /** A navigation key the editor handed over while the window is open (keyCode). */
  key(keyCode: number): ImeAction[] {
    if (!this.visible) return [];
    const n = this.items.length;
    switch (keyCode) {
      case KEY.enter: return this.commit(this.selected, "");
      case KEY.esc: return this.reset(true);
      case KEY.up: this.selected = (this.selected + n - 1) % n; break;
      case KEY.down: case KEY.tab: this.selected = (this.selected + 1) % n; break;
      case KEY.pageUp: this.selected = Math.max(0, this.selected - 5); break;
      case KEY.pageDown: this.selected = Math.min(n - 1, this.selected + 5); break;
      case KEY.home: this.selected = 0; break;
      case KEY.end: this.selected = n - 1; break;
      default: return [];
    }
    return [{ type: "show", latin: this.latin, items: this.items, selected: this.selected }];
  }

  /** A click on a candidate. */
  pick(index: number): ImeAction[] {
    return this.visible && index >= 0 && index < this.items.length ? this.commit(index, "") : [];
  }

  /** The editor cleared its input context (Backspace, arrows, a click, or our own input). */
  cleared(): ImeAction[] {
    if (!this.visible || !this.latin) { this.base = ""; return []; }
    if (this.options.canResync) {
      this.base = this.latin;
      return [{ type: "resync" }];
    }
    return this.reset();
  }

  /** The word before the cursor, after cleared() asked for it. */
  resync(wordBefore: string): ImeAction[] {
    const was = this.base;
    const word = typeof wordBefore === "string" ? wordBefore : "";
    // only a shorter start of the composition: Backspace. Anything else ends it.
    if (was && /^[A-Za-z]+$/.test(word) && word.length < was.length && was.startsWith(word)) {
      this.base = word;
      this.latin = word;
      this.selected = 0;
      return this.show();
    }
    return this.reset();
  }

  /** Mode off, or the document lost the cursor. */
  stop(): ImeAction[] {
    return this.reset(true);
  }
}
