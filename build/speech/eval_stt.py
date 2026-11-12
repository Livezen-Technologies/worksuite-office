#!/usr/bin/env python3
"""Sinhala speech-to-text evaluation: word and character error rates against reference transcripts.
   [AC_DYNAMIC=1] eval_stt.py <whisper-cli> <model> <audio dir of <id>.flac> <tsv: id<TAB>speaker<TAB>text> [whisper args]
As the service decodes: pass -bs 1 -bo 1 (greedy) and AC_DYNAMIC=1 (the window sized to each utterance).
Text is compared after NFC, without punctuation, zero-width spaces and non-joiners; WER and CER are
Levenshtein distances over words and over characters (spaces left out). See EVALUATION.md."""
import os, re, subprocess, sys, time, unicodedata, json

cli, model, audio, tsv = sys.argv[1:5]
extra = sys.argv[5:]
ref = {}
for line in open(tsv, encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if len(p) >= 3: ref[p[0]] = p[2]

def norm(t):
    t = unicodedata.normalize("NFC", t)
    t = re.sub(r"[​‌﻿]", "", t)          # zero-width space/non-joiner, BOM
    t = re.sub(r"[^\w\s඀-෿‍]", " ", t)     # punctuation
    return " ".join(t.split())

def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]

we = wn = ce = cn = 0
total_audio = total_time = 0.0
rows = []
files = sorted(f for f in os.listdir(audio) if f.endswith(".flac"))
for f in files:
    uid = f[:-5]
    wav = os.path.join(audio, uid + ".wav")
    if not os.path.exists(wav):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", os.path.join(audio, f), "-ar", "16000", "-ac", "1", wav], check=True)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav], capture_output=True, text=True).stdout)
    t0 = time.time()
    ac = []
    if os.environ.get("AC_DYNAMIC"):  # as the service sends it: the window sized to the audio
        import math
        ac = ["-ac", str(min(1500, math.ceil(dur / 30 * 1500) + 64))] if dur < 30 else []
    try:
        out = subprocess.run([cli, "-m", model, "-f", wav, "-l", "si", "-nt", "-np", "-t", str(os.cpu_count())] + extra + ac,
                             capture_output=True, text=True, errors="replace", timeout=60).stdout
    except subprocess.TimeoutExpired:
        out = ""  # counted as a full miss
    class R: stdout = out
    r = R
    total_time += time.time() - t0; total_audio += dur
    hyp, rf = norm(r.stdout), norm(ref.get(uid, ""))
    w = lev(rf.split(), hyp.split()); c = lev(list(rf.replace(" ", "")), list(hyp.replace(" ", "")))
    we += w; wn += len(rf.split()); ce += c; cn += len(rf.replace(" ", ""))
    rows.append({"id": uid, "ref": rf, "hyp": hyp, "wer": round(w / max(1, len(rf.split())), 3)})
print(json.dumps(rows[:8], ensure_ascii=False, indent=1))
print(f"\nMODEL {os.path.basename(model)}  utterances {len(files)}  audio {total_audio:.0f}s  "
      f"WER {we / wn:.3f}  CER {ce / cn:.3f}  real-time factor {total_time / total_audio:.2f}")
json.dump({"model": os.path.basename(model), "wer": we / wn, "cer": ce / cn, "rtf": total_time / total_audio,
           "n": len(files), "rows": rows}, open(f"result-{os.path.basename(model)}.json", "w"), ensure_ascii=False, indent=1)
