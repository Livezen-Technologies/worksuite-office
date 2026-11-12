# Sinhala voice typing: speech recognition evaluation

WorkSuite Office ships Sinhala voice typing with the app (`build/v10/speech.sh`,
`ai-service/src/bundled.ts`). This is how its speech model was chosen and measured. The local
service only offers Sinhala speech to text when the model's measured word error rate (WER) on Sinhala
is at most 0.25 (`ai-service/src/manifest.ts`, `GATES.sttWer`). That gate was not changed.

## Data

Real recordings of native Sinhala speakers with reviewed reference transcripts:

| Set | Source | Licence | Used for |
| --- | --- | --- | --- |
| OpenSLR 30 test: 60 recordings, 12 speakers | Google, "Sinhala TTS" (openslr.org/30) | CC BY-SA 4.0 | the held-out test, run once on the chosen model |
| OpenSLR 30 dev: 60 other recordings | the same, no overlap with the test | CC BY-SA 4.0 | choosing among models and settings |
| OpenSLR 52: 60 recordings | Google, "Large Sinhala ASR" (openslr.org/52) | CC BY-SA 4.0 | a second check |
| Banking: 60 recordings | IshanSuga/sinhala-bank-speech | MIT | an out-of-domain check |

The recordings are not in this repository; `eval_stt.py` downloads nothing. Recording ids were drawn at
random with fixed seeds.

## Method

`eval_stt.py` transcribes each recording with whisper.cpp (v1.8.2) and compares with the reference
after Unicode NFC, without punctuation, zero-width spaces and non-joiners. WER and CER are Levenshtein
distances over words and characters. Decoding as the service runs it: greedy (`-bs 1 -bo 1`), no
timestamps, Whisper's window sized to the utterance (`AC_DYNAMIC=1`, as `audioCtxFor` in
`ai-service/src/engines/clients.ts`). The models were measured as shipped: ggml, quantised to q5_1
(190 MB). Machine: 4 CPU cores, no GPU.

Candidates were openly licensed Whisper Small models fine-tuned for Sinhala. Stock Whisper does not
know Sinhala well enough: Whisper Base scored WER 1.19.

## Results

Development set (greedy, 30 s window), to choose:

| Model (Apache-2.0) | WER | CER |
| --- | --- | --- |
| seniruk/whisper-small-si | **0.225** | 0.035 |
| SinhaSpeech/whisper-small-sinhala-run11 | 0.290 | 0.047 |
| SinhaSpeech/whisper-small-sinhala-run13 | 0.294 | 0.045 |
| SinhaSpeech/whisper-small-sinhala-run12-best | 0.301 | 0.047 |
| janiduchamika/whisper-small-sinhala-general-185k | 0.307 | 0.055 |

Lingalingeswaran/whisper-small-sinhala scored WER 0.067 on OpenSLR 52 but 0.459 on OpenSLR 30: it had
learned OpenSLR 52 itself, and was set aside.

The chosen model, seniruk/whisper-small-si at revision fbd37479362cfd32fd99709a8757bb8bad2bd5ed, as
shipped (greedy, window sized to the utterance):

| Set | WER | CER | Real-time factor |
| --- | --- | --- | --- |
| **OpenSLR 30 held-out test (the gate)** | **0.231** | **0.039** | 0.66 |
| OpenSLR 30 dev | 0.262 | 0.040 | 0.72 |
| OpenSLR 52 | 0.259 | 0.046 | 0.50 |
| Banking (out of domain) | 0.295 | 0.070 | 0.62 |

With a full 30 s window the held-out test was WER 0.213, CER 0.052, at a real-time factor of 1.63: the
sized window is 2.5 times faster, with fewer character errors and slightly more word errors.

## Limits

- The model's training data (seniruk/sinscribe-sinhala-stt) is private, so it cannot be ruled out that
  some of the test recordings were in it. The checks on OpenSLR 52 and on the banking set (another
  source and domain) are the guard against that.
- On read speech the model meets the gate. On other speech it does worse: the banking set is at WER
  0.295. One wrong vowel sign makes a whole Sinhala word count as wrong, so CER (4 to 7 %) says more
  about what people will correct.
- Typical differences: words written together or apart (ගම් වැසියන් / ගම්වැසියන්), colloquial forms
  (අපට / අපිට), aspiration (සුබ / සුභ).
- On a 4-core computer recognition runs at about 0.5 to 0.7 of real time; the dock records and writes
  the text when you stop where live dictation would fall behind.
- Memory while recognising: whisper-server about 510 MB, worksuite-ai about 120 MB.

## In the installed app

On Linux (Ubuntu 24.04, Xvfb, a new user with no WorkSuite settings), with real Sinhala recordings as
the microphone (Chromium's `--use-file-for-fake-audio-capture`): Sinhala Tools › Voice typing started
the service and the shipped model with nothing installed, recognised the three sentences in order,
wrote them at the cursor in Noto Sans Sinhala, and the text survived keyboard edits, saving as DOCX,
closing and reopening the app, and a PDF export (Noto Sans Sinhala embedded). After a restart a second
dictation worked with no setup.
