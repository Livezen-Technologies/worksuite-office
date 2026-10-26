# Smart Typing Engine (Sinhala Tools)

Sinhala and English autocomplete, next-word prediction, spelling correction and suggestions in the
WorkSuite editors. It ships in the Sinhala Tools plugin (`sinhala/plugin`) and the shared engine
`@worksuite/sinhala-core` (`sinhala/core`).

Suggestions never switch off just because Sinhala input is off. With Sinhala input off they are English.

| Mode (ribbon: Input mode) | Typed | Suggestions |
| --- | --- | --- |
| English (Sinhala input off) | `comp` | company, complete, computer |
| Sinhala Unicode / Sinhala legacy font (Sinhala input on) | `kanna` | කන්න, කන්නට, කන්නේ |
| Any mode, Sinhala typed with the system keyboard | `ලිය` | ලියන්න, ලියනවා, ලියවිල්ල |
| Smart Mixed | `meeting eka` | English per word, Singlish where the rules below say so: `meeting` stays, `eka` → එක |

Changing the mode closes the popup and asks again at once for the text before the caret, so the
suggestions switch language straight away.

## 1. Implementation architecture

### 1.1 Components

| Component | File | Runs in | Role |
| --- | --- | --- | --- |
| English lexicon | `core/src/english.ts` | worker | Ranked English words, prefix completion, spelling correction (misspelling table, then Damerau–Levenshtein ≤ 1, or ≤ 2 for 6+ letters), case rules (`applyCase`). |
| Detector | `core/src/lang.ts` | worker | Decides per token whether it is English, Singlish or Sinhala Unicode (rules R1–R12, §2). |
| Pairs and personal store | `core/src/bigrams.ts` | worker and frame | `Bigrams`: bundled next-word pairs. `Personal`: the user's words, pairs, language overrides and custom dictionary, as JSON. |
| Engine and ranker | `core/src/engine.ts` | worker (frame fallback) | `SmartEngine.suggest({before, mode, manual})` builds the ranked list: English, Singlish (`candidates()` from `suggest.ts`, re-ranked), Sinhala Unicode, mixed interleave, next words. Also holds the LRU cache, `merge()` for AI words and `learn()`. |
| Key state machine | `core/src/typing.ts` `SmartTyping` | frame | Turns editor events into actions (`query`, `show`, `hide`, `input`, `pass`, `resync`, `finished`, `kept`). Owns the selection and the stale-answer rule. |
| AI scheduler | `core/src/typing.ts` `AiScheduler` | frame | Debounce and cancel rules for the local AI (§1.5). |
| Plugin glue | `plugin/src/scripts/ime.js` | plugin frame | Editor events in, editor commands out. Renders the popup, holds settings and storage, and owns the worker. |
| Worker | `plugin/src/scripts/smart-worker.js` | Web Worker | Loads `sinhala-core.js`, the word lists and `smart-data.js`, then answers `{type:"query", seq}` with `{type:"result", seq, result}`. |
| Settings window | `plugin/src/suggest.html`, `scripts/suggest.js` | modal plugin window | Sinhala Tools › Suggestions › Settings. |
| Ribbon | `plugin/src/scripts/plugin.js`, `plugin/icons/registry.mjs` | plugin frame | The Suggestions split button, with English and Sinhala toggles and Settings…. The Smart Mixed mode in the Input mode menu. |
| Data | `sinhala/wordlist/smart/*`, `scripts/smartdata.mjs` | build | sha256-pinned data, bundled by the build as `scripts/smart-data.js`. |

### 1.2 Data flow: from keystroke to commit

```
keystroke ─▶ editor input context ─▶ onInputHelperInput {text}            (ime.js)
   │                                    │  spreadsheet and text starts with "=" or "+"? stop
   │                                    ▼
   │                         SmartTyping.input(text)
   │              word ended (space or punctuation)?  ── yes ─▶ Singlish composition: input (write the word)
   │                                    │                         English: hide, then "finished" (learn the word)
   │                                    ▼ no
   │                     {type:"query", seq, before, mode}
   │                                    ▼  (optional `delay` setting)
   │              worker.postMessage(query)  — or localEngine().suggest() when there is no worker
   │                                    ▼
   │       SmartEngine.suggest: token = last \S+ run → detectToken (R1–R12, context = previous 3 tokens)
   │            ├─ en       → English completions + corrections + case + grammar (+ Sinhala loan/ambiguous alternates in Smart Mixed)
   │            ├─ singlish → Singlish candidates re-ranked (+ English alternates when ambiguous)
   │            ├─ si       → Sinhala completions + normalisation + one-edit alternatives
   │            └─ boundary + manual → next-word pairs (bundled + personal)
   │                                    ▼ ranker: score sort, dedupe, cut to maxItems (5–7)
   │              {type:"result", seq, result} ─▶ SmartTyping.deliver(seq, result)
   │                                    │  seq is not the latest? dropped (stale)
   │                                    ▼
   │                   show ─▶ render popup ─▶ ShowInputHelper(guid, w, h, false)
   │                                    ▼
   │                   AiScheduler.schedule(key)  (only with AI on and an endpoint)
   ▼
Tab / Enter / ↑↓ / Esc ─▶ onKeyDown (the editor hands these keys to a shown helper)
                                        ▼
                              SmartTyping.key(code) ─▶ input {text, replace, item}
                                        ▼
         documents: callCommand(typeCommand): MoveCursorLeft(n, select) → SetFontFamily(Sinhala font) → EnterText
         slides and cells: InputText(text, replace)
                                        ▼
                         learn(): Personal + Learner (frame and worker) → localStorage
```

### 1.3 Ranking

Every item has a score. The list is the items sorted by score, with duplicates removed and cut to
`maxItems`.

- **English completion:** `10 − 2·log10(rank+1)`, plus 0.3 for business words. Rank is the position in
  `en-frequent.txt`, then `en-business.txt`, then SCOWL (shorter words first). Then come the boosts:
  personal word count × 0.6 (at most 10 counted), a bundled pair with the previous word ×1.5 (strength
  3 − 0.25·position, so "am goin" → *going*), and a personal pair count × 1.2 (at most 5).
- **Corrections** apply only when the token is not a word and not the start of one. A table hit scores 14.
  A distance-d match scores `12 − 2d`, plus base/10, plus the boosts.
- **Case fixes** score 16 and **grammar fixes** score 13. Both sit above completions because they fix
  what was already typed.
- **Singlish:** item 1 is always the best rendering (the colloquial spelling, then the user's pick, then
  known words). The rest are sorted by `candidates()` score, −4 for renderings that are not in the Sinhala
  word list, plus the Sinhala pair boost. This puts known completions (කන්නට, කන්නේ) above rule-only
  variants (ඛන්න).
- **Sinhala Unicode:** a normalisation fix scores 20. Completions score `8 − 1.25·log10(rank+1)` plus
  the boosts. One-edit alternatives are offered only when nothing completes.
- **Smart Mixed:** when a token is ambiguous (§2.6), or is an English word with a Sinhala loan spelling,
  the other language's best item goes to position 2. The rest follow after the primary's top four.
- **AI words** (`merge`) go after the first two items. They never rank above a fix, and only words in
  the right script are taken.

### 1.4 Threading, memory and caching

- The engine is built once per frame, in the worker when `new Worker("scripts/smart-worker.js")` works.
  Otherwise, or on a worker error, it runs in the plugin frame (`localEngine()`). Queries the worker had
  not answered are then answered locally.
- **Memory is bounded.** About 10.9k English and 25k Sinhala words are indexed once: a sorted array,
  one rank map, and buckets by first letter for corrections. The LRU cache holds at most 400 answers.
  Personal data is capped at 5,000 entries per table, and the oldest are dropped first.
- **Cancellation.** Only the latest query's callback is kept. `SmartTyping.deliver()` drops every answer
  whose `seq` is not the latest, so a slow answer never shows a stale list. AI requests are aborted
  (`AbortController`).
- **Cache key:** mode, manual flag and the last 60 characters before the caret. It is cleared on settings
  changes and on learning.
- **Latency:** `test/unit/smart-typing.test.mjs` runs 188 uncached lookups across English, Singlish,
  Sinhala and mixed. On the CI container p50 is about 0.2 ms, p95 about 1.4 ms and the maximum about
  4 ms. The test asserts p95 < 50 ms. A cached lookup takes under 1 ms (asserted). Building the engine
  takes about 50 ms.

### 1.5 The local AI path

Optional and off by default (Settings: *Local AI suggestions*). It needs the desktop bridge's
`window.WSAiEndpoint = {baseUrl, token}`; see `ai-plugin/plugin/src/lib/discovery.js` and
`docs/local-ai/spec.md`.

- **Debounce.** A request goes out only after `AI_DELAY` = 250 ms without a keystroke
  (`AiScheduler.schedule`), never per keystroke, and only when local results are shown.
- **Cancel.** The next keystroke, Esc, an accept or a mode change calls `AiScheduler.cancel()`. That
  clears the timer and aborts the request in flight.
- **Timeout.** An answer after `AI_TIMEOUT` = 1500 ms is aborted. Typing never waits, because local
  results are already shown.
- **Stale answers.** An answer is used only if its key (seq and token) is still current. It is merged
  with `merge()` and shown with `SmartTyping.update()`, which keeps the highlight on the same word. That
  way the list updates without interrupting typing.
- **Contract.** `POST {baseUrl}/v1/text/complete` with `{text, caret, lang:"en"|"si"|"mixed", mode:"word", singlish, max:5}`.
  The answer `{words:[{text, source, score}]}` is filtered by script.
- **Offline.** Everything else is local. Once the plugin is installed, no network is needed.

### 1.6 Storage

All of this is in the plugin's existing settings storage, its own `localStorage`. It is never sent anywhere.

| Key | Content |
| --- | --- |
| `worksuite-sinhala-typing` | mode, lastSinhala, fonts, and the Suggestions settings: english, sinhala, autocomplete, nextWord, spelling, grammar, ghost, personal, mixed, maxItems (5–7), delay (0–1000 ms), acceptKey (`tab`/`enter`/`both`), output (`unicode`/`legacy`), ai |
| `worksuite-sinhala-personal` | `Personal`: words, pairs, per-token language overrides, custom dictionary |
| `worksuite-sinhala-input-learned` | `Learner`: Singlish picks (input → Sinhala word) |

### 1.7 Editor APIs used

Only the plugin and editor APIs are used: no DOM access into the editor.

| Editor | Reading | Writing | Notes |
| --- | --- | --- | --- |
| Documents (paragraphs, text boxes, tables) | `onInputHelperInput`, `onInputHelperClear`, `onKeyDown`, `onClick`; `GetCurrentWord("before")` (Backspace resync); `GetCurrentSentence("before")` (Ctrl/Cmd+Space) | One `callCommand(typeCommand)`: `MoveCursorLeft(n, true)` selects the typed letters, `GetRangeBySelect().SetFontFamily(font)` (Sinhala only), then `EnterText(word)`. That is one undo step, and the caret ends in the word's run. Enter that the popup held back: `callCommand(() => Api.GetDocument().InsertParagraphBreak())`. | Typing over the selection keeps size, colour, bold and italic. English accepts set no font. Legacy mode encodes with `toLegacy()` first and warns once for characters the map lacks. |
| Presentations (slide text, notes) | the same input-helper events | `InputText(word, typed)` | Works wherever the editor gives the input helper a text target, which includes notes. No font can be set (the slide's own font is kept). |
| Spreadsheets (text cells) | the same | `InputText(word, typed)` | Nothing is suggested while the cell text starts with `=` or `+` (a formula). |

`typeCommand` is the existing single-undo pattern: one `callCommand` that selects, sets the font and
then writes. It uses `EnterText` rather than `ReplaceTextSmart` because `EnterText` leaves the caret at
the end of the new word, in its run. That is what keeps the next keystrokes in the Sinhala font.
`ReplaceTextSmart` stays the pattern for replacing whole selections (convert).

### 1.8 The popup

- **Placement.** The popup is this plugin's frame, shown by `ShowInputHelper(guid, w, h, false)` without
  taking the keyboard. The editor places it at the caret. It goes below the caret, or above when the
  bottom has no room, and is shifted left at the right edge. Its bounds are the editor area
  (`getTargetOnBodyCoords`), so it does not cover the ribbon or the side panels.
- **Size.** Width is 200–320 px (270 while composing Singlish). Height is a 24 px header, 26 px per
  item and a 20 px footer, with 5–7 items.
- **Content.** The header shows the typed word, plus ghost text: the rest of the best completion, in the
  muted colour while nothing is selected. Each item has a number, the word (Sinhala in Noto Sans Sinhala)
  and a tag (Fix, Aa, Grammar, Next, සිං, AI). The selected item is highlighted. The first item has an
  accent bar, because Tab takes it.
- **Theme.** Colours are the editor theme's tokens, set in `onThemeChanged`, with WorkSuite light and
  dark fallbacks (`resources/ime.css`).
- **Mouse.** Hover highlights an item. A click (mousedown) accepts it.
- **When it hides.** On Esc, on an accept, on a word end, when the input context is cleared (caret moved
  by keys or click, or Backspace outside a document composition), on a document click (`onClick`) and on
  a mode change.

### 1.9 Keys (the `SmartTyping` state machine)

The states are idle, pending (a query is out), and open. *Composing* means a Singlish token with Sinhala
items: the Latin letters are a composition, and item 1 is selected from the start.

| Key | Open, composing (Singlish) | Open, not composing (English, Sinhala Unicode, next word) | Closed |
| --- | --- | --- | --- |
| letters | new query | new query | new query |
| Space | writes the selected word + space (`acceptSpace`), else keeps the Latin (`kept`) | closes. The word stays as typed and is learned (`finished`). | — |
| punctuation | writes the selected word + the mark | closes | — |
| 1–9 | writes that item (the digit is not typed) | closes (the digit is typed) | — |
| ↑ / ↓ | move the highlight (wrapping), and mark the selection active | the same; the first ↓ selects item 1 | editor |
| PgUp/PgDn/Home/End | move by 5 / to the ends | the same | editor |
| Tab | writes the selected item | writes the selected item, or item 1 (`acceptKey` tab or both); with `enter` it is handed back | editor |
| Enter | writes the selected word | writes **only** a selection the user made. Otherwise it closes and hands Enter back (`pass`): a paragraph break in documents. With `acceptKey` enter or both, it writes item 1. | editor |
| Esc | closes and keeps the Latin. In Smart Mixed this counts as "English" for this token (R6). | closes | editor |
| Ctrl/Cmd+Space | — | — | opens now. Documents read the sentence before the caret; after a space it lists next words. |
| Ctrl+Shift+Y / Ctrl+Alt+Shift+Y | Sinhala input on/off, next mode | the same | the same |

Editor shortcuts are never caught. While the popup is closed, the plugin only acts on Ctrl/Cmd+Space and
Ctrl+Shift+Y. While it is open, the editor hands over only Tab, Enter, Esc, arrows, PgUp/PgDn and
Home/End.

**No duplicate characters.** `replace` is exactly the characters typed in the input context: the token,
plus the space or mark that ended it. The editor clears its context after the plugin writes.

**IME composition.** The editor reports the composed text through `onInputHelperInput` like any other
text. A context that changes in the middle simply starts a new query, and the commit always replaces
what the context holds.

## 2. Mixed-language detection rules

`detectToken(token, mode, context)` in `core/src/lang.ts`. A *token* is the last run of non-space
characters before the caret, with leading `( " ' [ {` removed. The rules are evaluated **in this order**.
The first one that applies decides.

### 2.1 Script ranges

- **Sinhala:** U+0D80–U+0DFF (the Sinhala block), together with ZWJ U+200D and ZWNJ U+200C inside a word.
- **Latin letters:** `[A-Za-z]`. Apostrophes and hyphens are part of English words in completion.
- **Anything else:** digits, punctuation and symbols.

### 2.2 Rules table

| # | Rule | Condition (precise) | Result | Modes |
| --- | --- | --- | --- | --- |
| R1 | Sinhala script | any character in U+0D80–U+0DFF | `si` (Sinhala Unicode completion) | all |
| R2 | Protected | URL `^([a-z][a-z0-9+.-]*://\|www\.)`, e-mail `x@y.z`, any digit, file name `^[\w-]+\.[A-Za-z][A-Za-z0-9]{0,4}$` | `en`, no suggestions (left as typed) | all |
| R4 | Not letters | not `^[A-Za-z]+$` after R1–R2 | `other`, no suggestions | all |
| R5 | Mode | mode `english` → `en`; mode `unicode` or `legacy` → `singlish` | as stated | English, Sinhala on |
| R12 | One letter | length < 2 (`a`, `I`) | `en` | Smart Mixed |
| R3 | Acronym and name | `^[A-Z]{2,}$`, or `^[A-Z][a-z]+$` when not at the start of a sentence (start of the input context, or after `. ! ?`) | `en` | Smart Mixed |
| R6 | User override | `Personal.lang[token]`: the language confirmed more often (an accepted Sinhala item = si; an accepted English item, or Esc / Space-keeps-Latin on a Singlish list = en). Equal counts mean no override. | that language | Smart Mixed |
| R7 | Code-switch marker | token (lower case) is in the marker list (`mixed.txt` kind `marker`, plus `MARKERS`): eka, ekak, ekata, eke, ekka, kiyala, kiyla, nam, da, ne, neh, nethnam, nathnam, wage, wge, gena, gana, hinda, nisa, thamai, tamai, tikak, godak, hari | `singlish`, even after English words | Smart Mixed |
| R8 | Colloquial | token is a colloquial Singlish spelling (`COLLOQUIAL`: mama, oya, kohomada …) and e < 1 | `singlish` | Smart Mixed |
| R9 | Scores | d = s − e (rounded to 0.01). d ≥ +0.2 → `singlish`; d ≤ −0.2 → `en` | as stated | Smart Mixed |
| R10 | Context | \|d\| < 0.2. lean = Σ wᵢ·vᵢ / Σ wᵢ over the previous 3 tokens, nearest first, w = 1, 0.6, 0.3, v = +1 for singlish/si and −1 for en (`other` is skipped). lean ≥ 0.3 → `singlish`; lean ≤ −0.3 → `en` | as stated | Smart Mixed |
| R11 | Tie | otherwise | `en`. Typing English is never turned into Sinhala on a guess. | Smart Mixed |

Rule numbers are stable IDs. The evaluation order is the order of the rows. Every rule has a test in
`sinhala/test/unit/lang.test.mjs`.

### 2.3 English score e (0..1)

| e | When |
| --- | --- |
| 1.0 | in the user's custom dictionary, in `en-frequent.txt`, or in `en-business.txt` |
| 0.8 | in SCOWL (sizes 10 and 20) only |
| 0.5 | 3+ letters and the start of a longer known word (`docu`, `comp`) |
| 0.3 | 5+ letters and one edit from a known word (a likely misspelling) |
| 0 | otherwise |

### 2.4 Singlish score s (0..1)

| s | When |
| --- | --- |
| 1.0 | a code-switch marker or a colloquial spelling |
| max(0.75, p) | one of the 3 best renderings is in the Sinhala word list (`kanna` → කන්න) |
| p | otherwise: the phonotactic score below |

The phonotactic score `p` is 0 unless the rules transliterate every letter. It then starts at 0.30 and changes as follows:

- +0.20 for a final vowel `[aeiou]`
- +0.15 for a Singlish ending: `nna nnam nawa wa ta da ge la yi ne kka mu nne`
- +0.10 for a long vowel: `aa ee ii oo uu ae`
- +0.05 for an aspirate: `th dh kh`
- −0.30 for three consonants in a row, with `th/dh/sh/kh/gh/bh/ph/ch` counted as one letter (`str`, `ndl`)
- −0.30 for a letter pattern the scheme does not produce: `q`, `x`, `ck`, a final `tion`/`sion`, `ght`, an initial `wh/wr/kn`, `c` not followed by `h`, a final `y`, `ea/oa/ue/ei/io`

The result is clamped to 0..0.70. Letters alone never reach the 1.0 of a dictionary or marker hit.

### 2.5 Thresholds and constants

`THRESHOLD = 0.2`, `CONTEXT_WINDOW = 3`, `CONTEXT_WEIGHTS = [1, 0.6, 0.3]`, `CONTEXT_MIN = 0.3`. All are
exported from `lang.ts` and asserted in the tests.

### 2.6 Words in both languages, and learning

A token is **ambiguous** when e ≥ 0.5 and s ≥ 0.5. The winning language's list comes first, and the other
language's best item is placed **second** (§1.3), so either is one ↓ away.

- **game:** e = 0.8 (SCOWL), s = 0.5 (final vowel), d = −0.3, so R9 makes it English. It is ambiguous,
  so the list is *games*, **ගමෙ**, ගමේ.
- **tea:** e = 0.8, s = 0.20 (`ea`), so R9 makes it English. It is not ambiguous, so the list is English only.
- **mama:** e = 0 (not in the bundled English lists), and it is colloquial, so R8 makes it Singlish:
  **මම**. A user who types English "mama" presses Esc once or twice. R6 then keeps it English for them.
- **api:** e = 1 (a technical word), s = 1 (colloquial අපි), d = 0, a tie. With no context, R11 makes it
  English (*api* as typed, අපි second). After `mama oya`, R10 (lean +1) makes it **අපි** first.

**Learning.** Accepting an item calls `Personal.word` (word and pair counts), `Personal.confirm` (the
token's language, for R6) and `Learner.record` (the Singlish pick). Space after a typed word records it
as *finished* (word and pair). All of it can be cleared in Settings (*Forget what was learned*), and none
of it is used when *Learn my words* is off.

### 2.7 Worked examples (Smart Mixed)

| Text before the caret | Token | e | s | Rule | Language | Top suggestions |
| --- | --- | --- | --- | --- | --- | --- |
| `meeting` | meeting | 1.0 | 0.75 (මීටිං is a Sinhala word) | R9 | en (ambiguous) | meetings, මීටිං (loan), මීටින්ග් |
| `meeting eka` | eka | 0 | 1.0 | R7 | singlish | එක, එක්ක, එකක් … |
| `kanna` | kanna | 0 | 0.75 | R9 | singlish | කන්න, කන්නට, කන්නේ |
| `docu` | docu | 0.5 | 0.20 | R9 | en | document, documents, documentation |
| `send to Kamal` | Kamal | – | – | R3 | en | (names are left alone) |
| `see report.docx` | report.docx | – | – | R2 | en | none |
| `PDF` | PDF | – | – | R3 | en | none (an acronym) |
| `the game` | game | 0.8 | 0.5 | R9 | en (ambiguous) | games, ගමෙ, ගමේ |
| `tea` | tea | 0.8 | 0.20 | R9 | en | team, tear, teach |
| `api` | api | 1.0 | 1.0 | R11 | en (ambiguous) | api (as typed), අපි, අපිම |
| `mama oya api` | api | 1.0 | 1.0 | R10 (lean 1.0) | singlish | අපි … |
| `ලිය` | ලිය | – | – | R1 | si | ලියන්න, ලියනවා, ලියවිල්ල |

And outside Smart Mixed: `comp` with Sinhala off is R5 English (company, complete, computer). `kanna`
with Sinhala on is R5 Singlish (කන්න, කන්නට, කන්නේ). `https://x.lk` is R2 in every mode.

## 3. English engine details

- **Completion** works from 2 letters, with the 40 best candidates scored and the top 5–7 shown. Custom
  and learned words take part.
- **Spelling** covers `recieve` → receive and `teh` → the (table), and `becuase` → because (a swap,
  distance 1). It applies only when the token is not a word and not the start of one, so nothing
  interrupts a word mid-typing. Space never auto-corrects. A fix is offered, never forced.
- **Capitalisation:** `i` → I; days, months and names (`monday` → Monday); ALL CAPS stays all caps; a
  typed capital is kept; a capital after `. ! ?`. *may* and *march* are capitalised only as sentence starts.
- **Light grammar:** `a` before a vowel sound → `an` (`a appl` → *an application*, but *a user*); a
  repeated word (`the the` → the); `could/should/would/must/might of` → *… have*. A fix replaces only text
  that is still in the input context.
- **Next word:** bundled pairs (`en-bigrams.txt`, `si-bigrams.txt`, including mixed pairs such as
  meeting → එක) plus the user's pairs. They are listed after a space only when asked with Ctrl/Cmd+Space,
  because an open popup holds Enter. They always boost the next word's completion (*I am goin* → going).
- **Vocabulary:** business and technical words (`en-business.txt`) and the custom dictionary (Settings ›
  My dictionary).

## 4. Sinhala engine details

- **Transliteration:** the existing scheme (`translit.ts`), its variants and the colloquial spellings, plus
  the markers' spellings (`mixed.txt`).
- **Unicode completion:** prefix search over the merged Sinhala list (`sources.json`). The new
  `si-forms.txt` adds frequent inflections (කන්නට, කන්නේ, ලියවිල්ල …).
- **Normalisation:** `normalize()` fixes (ේ + ා → ෝ, the joiner order) are offered first, as *Fix*.
- **Spelling and alternative spellings:** words one edit away, offered only when nothing completes
  (කණ්න → කන්න; ණ/න, ළ/ල, ශ/ෂ/ස).
- **Light grammar:** Sinhala grammar hints are limited to normalisation and validation issues. Nothing
  heavier is attempted locally; the local AI's `/v1/text/check` is the place for more.
- **Personal vocabulary and frequency, next word:** as for English, with the Learner's picks ranked first.
- **Mixed vocabulary:** English loanwords' Sinhala spellings (`mixed.txt` kind `loan`: meeting → මීටිං,
  office → ඔෆිස් …) are offered in Smart Mixed.
- **Legacy fonts:** the engine always works in Unicode. On write, legacy mode encodes the chosen word with
  the font's map (`toLegacy`) and sets the legacy font. English words are never encoded. Smart Mixed
  writes Sinhala in the Unicode font, because a legacy font cannot hold the English words around it. The
  *Sinhala is written in* setting chooses which Sinhala-on mode Ctrl+Shift+Y turns on.

## 5. Settings (Sinhala Tools › Suggestions › Settings)

| Setting | Key | Default |
| --- | --- | --- |
| English suggestions | `english` | on |
| Sinhala suggestions | `sinhala` | on |
| Complete the word being typed | `autocomplete` | on |
| Predict the next word | `nextWord` | on |
| Spelling corrections | `spelling` | on |
| Grammar and capital letters | `grammar` | on |
| Ghost text | `ghost` | on |
| Learn my words (personal dictionary) | `personal` | on |
| Mixed Sinhala and English typing | `mixed` | on |
| Local AI suggestions | `ai` | off |
| Words in the list | `maxItems` | 7 (5–7) |
| Delay before showing | `delay` | 0 ms (0, 100, 250, 500) |
| Accept with | `acceptKey` | Tab (Tab, Enter, Tab or Enter) |
| Sinhala is written in | `output` | a Unicode font (or a legacy font) |
| My dictionary | `Personal.custom` | empty |

The Suggestions ribbon button still turns the popup on and off. Its menu also has quick English and
Sinhala toggles.

## 6. Data and licences

| File | Content | Licence | Pinned in |
| --- | --- | --- | --- |
| `wordlist/english/scowl-20.txt` | SCOWL sizes 10 and 20 (existing) | SCOWL copyright | existing |
| `wordlist/smart/en-frequent.txt` | about 790 common English words, most frequent first | AGPL-3.0-only (written for WorkSuite) | `wordlist/smart/sources.json` |
| `wordlist/smart/en-business.txt` | about 200 business and technical words | AGPL-3.0-only | the same |
| `wordlist/smart/en-misspellings.txt` | about 110 misspelling → correction pairs | AGPL-3.0-only | the same |
| `wordlist/smart/en-bigrams.txt` | about 90 English pairs | AGPL-3.0-only | the same |
| `wordlist/smart/si-bigrams.txt` | about 30 Sinhala and mixed pairs | AGPL-3.0-only | the same |
| `wordlist/smart/mixed.txt` | 24 code-switch markers, 16 loanwords | AGPL-3.0-only | the same |
| `wordlist/smart/si-forms.txt` | about 30 Sinhala inflections | AGPL-3.0-only | `wordlist/sources.json` |

`scripts/smartdata.mjs` refuses a file whose sha256 does not match. The build writes
`scripts/smart-data.js` and lists the sources in `licenses/word-lists.json`.

**Bundle.** The plugin goes from 1,155,474 to 1,257,406 bytes uncompressed (+102 KB, +8.8%) and from
388 KB to 414 KB as a gzip tarball. The pieces are `sinhala-core.js` (+50 KB of engine code),
`smart-data.js` (16 KB, 6 KB gzip), `smart-worker.js` (2 KB), and the settings window.

## 7. Limits

- **Enter in presentations and spreadsheets.** While the popup is open, the editor gives Enter to the
  plugin. Documents get it back as `InsertParagraphBreak`. The slide and cell APIs have no "Enter at the
  caret", so there Enter with nothing selected only closes the popup, and a second Enter does the rest.
  Next-word lists open only by hand for the same reason.
- **Fonts in presentations and spreadsheets.** `InputText` cannot set a font, so the Sinhala word takes
  the run's font there (as before).
- **Inline ghost text.** No plugin API draws into the document without inserting text. The ghost text is
  therefore shown in the popup header, next to the typed letters, and not inline in the text.
- **Focus.** There is no plugin event for focus leaving the editor. The popup hides on the next context
  clear or click, and the editor hides input helpers itself when it loses focus.
- **Undo.** Each accept in documents is one `callCommand`, so one undo step. In slides and cells,
  `InputText` emulates Backspace and then typing, so the editor may record more than one step.
- **Workers.** A plugin loaded from `file://` may not be allowed to start a worker. The engine then runs
  in the plugin frame, which is still well under 50 ms per lookup.

## 8. Tests

- `test/unit/lang.test.mjs`: every rule R1–R12, the scores, the constants, and the both-languages ranking.
- `test/unit/smart.test.mjs`: the golden cases (every example in this document), spelling, case, grammar,
  next words, modes and settings, personal and custom words, Sinhala Unicode, legacy round trips, the AI
  merge, the cache, and the data pins.
- `test/unit/smart-typing.test.mjs`: the key state machine (every row of §1.9), stale answers, mode
  switching, `AiScheduler`, the latency benchmark (p95 < 50 ms) and the build time.
- `test/unit/typing.test.mjs`: the plugin end to end in a model document (one command per accept,
  formatting kept, Enter handed back, cell formulas, Ctrl/Cmd+Space, the settings window and its
  persistence, learning). `test/unit/plugin.test.mjs`: the build, translations and the worker.
