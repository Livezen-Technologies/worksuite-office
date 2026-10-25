/*
 * Microphone audio to what WS /v1/speech/stream takes: 16 kHz mono s16le, in frames of 20-100 ms.
 * Used inside the AudioWorklet (scripts/pcm-worklet.js, which the build makes from this file) and by
 * tests; nothing here touches the DOM.
 *
 * Resampler: when downsampling, each output sample is a triangle-weighted mean of the input around it
 * (a low-pass enough for speech and cheap enough for the audio thread); when upsampling, linear
 * interpolation. State carries across chunks, so any chunk size gives the same output.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WsAiAudio = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function Resampler(inRate, outRate, frameMs) {
    if (!(inRate > 0)) throw new Error("input rate");
    this.inRate = inRate;
    this.outRate = outRate || 16000;
    this.ratio = inRate / this.outRate;
    this.frameSize = Math.round(this.outRate * (frameMs || 40) / 1000);
    this.buf = new Float32Array(0);
    this.pos = 0; // position of the next output sample, in input samples from buf[0]
    this.out = new Int16Array(this.frameSize);
    this.outLen = 0;
  }

  function toS16(v) {
    if (v > 1) v = 1; else if (v < -1) v = -1;
    return v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }

  Resampler.prototype._emit = function (v, frames) {
    this.out[this.outLen++] = toS16(v);
    if (this.outLen === this.frameSize) {
      frames.push(this.out);
      this.out = new Int16Array(this.frameSize);
      this.outLen = 0;
    }
  };

  /* input: Float32Array (one channel, -1..1); returns complete Int16Array frames */
  Resampler.prototype.push = function (input) {
    var frames = [];
    var merged = new Float32Array(this.buf.length + input.length);
    merged.set(this.buf, 0);
    merged.set(input, this.buf.length);
    var buf = merged;
    var r = this.ratio;
    if (r > 1) {
      // a triangular window two output samples wide: the mean of what each output sample covers, and
      // much less of what 16 kHz cannot hold than a plain box
      var half = r;
      while (this.pos + half <= buf.length) {
        var i0 = Math.max(0, Math.floor(this.pos - half)), i1 = Math.min(buf.length, Math.ceil(this.pos + half));
        var sum = 0, w = 0;
        for (var i = i0; i < i1; i++) {
          var ww = 1 - Math.abs(i + 0.5 - this.pos) / half;
          if (ww > 0) { sum += buf[i] * ww; w += ww; }
        }
        this._emit(w > 0 ? sum / w : 0, frames);
        this.pos += r;
      }
      var drop = Math.max(0, Math.floor(this.pos - half) - 1);
      this.buf = buf.slice(drop);
      this.pos -= drop;
    } else {
      while (this.pos + 1 < buf.length || (r === 1 && this.pos < buf.length)) {
        var k = Math.floor(this.pos), t = this.pos - k;
        var v = t === 0 || k + 1 >= buf.length ? buf[k] : buf[k] * (1 - t) + buf[k + 1] * t;
        this._emit(v, frames);
        this.pos += r;
      }
      var d = Math.floor(this.pos);
      this.buf = buf.slice(d);
      this.pos -= d;
    }
    return frames;
  };

  /* what is left as a last, shorter frame (or null) */
  Resampler.prototype.flush = function () {
    if (!this.outLen) return null;
    var last = this.out.slice(0, this.outLen);
    this.out = new Int16Array(this.frameSize);
    this.outLen = 0;
    return last;
  };

  function rms(samples) {
    if (!samples || !samples.length) return 0;
    var s = 0;
    var scale = samples instanceof Int16Array ? 1 / 32768 : 1;
    for (var i = 0; i < samples.length; i++) { var v = samples[i] * scale; s += v * v; }
    return Math.sqrt(s / samples.length);
  }

  /* 0..1 for a level meter: -60 dBFS..0 dBFS */
  function meterLevel(value) {
    if (!(value > 0)) return 0;
    var db = 20 * Math.log10(value);
    return Math.max(0, Math.min(1, (db + 60) / 60));
  }

  /* Int16Array chunks -> a mono 16-bit PCM WAV file (ArrayBuffer) */
  function encodeWav(chunks, rate) {
    var n = 0;
    chunks.forEach(function (c) { n += c.length; });
    var buf = new ArrayBuffer(44 + n * 2);
    var dv = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
    str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, "data"); dv.setUint32(40, n * 2, true);
    var o = 44;
    chunks.forEach(function (c) { for (var i = 0; i < c.length; i++, o += 2) dv.setInt16(o, c[i], true); });
    return buf;
  }

  /* the format and the PCM bytes of a WAV file */
  function readWav(buffer) {
    var dv = new DataView(buffer);
    var tag = function (o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); };
    if (buffer.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
    var o = 12, fmt = null, data = null;
    while (o + 8 <= buffer.byteLength) {
      var id = tag(o), size = dv.getUint32(o + 4, true);
      if (id === "fmt ") fmt = { format: dv.getUint16(o + 8, true), channels: dv.getUint16(o + 10, true), rate: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true) };
      else if (id === "data") data = new Uint8Array(buffer, o + 8, Math.min(size, buffer.byteLength - o - 8));
      o += 8 + size + (size & 1);
    }
    if (!fmt || !data) throw new Error("WAV without fmt or data");
    return { fmt: fmt, data: data };
  }

  /* WAV files of one format -> one WAV file (Export audio of read aloud) */
  function concatWav(buffers) {
    if (!buffers.length) throw new Error("nothing to join");
    var parts = buffers.map(readWav);
    var f = parts[0].fmt;
    parts.forEach(function (p) {
      if (p.fmt.rate !== f.rate || p.fmt.channels !== f.channels || p.fmt.bits !== f.bits) throw new Error("WAV formats differ");
    });
    var n = 0;
    parts.forEach(function (p) { n += p.data.length; });
    var out = new ArrayBuffer(44 + n);
    var dv = new DataView(out);
    function str(o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
    var block = f.channels * f.bits / 8;
    str(0, "RIFF"); dv.setUint32(4, 36 + n, true); str(8, "WAVE");
    str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, f.format, true); dv.setUint16(22, f.channels, true);
    dv.setUint32(24, f.rate, true); dv.setUint32(28, f.rate * block, true); dv.setUint16(32, block, true); dv.setUint16(34, f.bits, true);
    str(36, "data"); dv.setUint32(40, n, true);
    var bytes = new Uint8Array(out), o = 44;
    parts.forEach(function (p) { bytes.set(p.data, o); o += p.data.length; });
    return out;
  }

  /*
   * Real-time factor watch: the service is too slow when finals lag the audio sent by more than
   * `maxLagSec` and the lag keeps growing (W3: switch to record then transcribe).
   */
  function LagWatch(maxLagSec) {
    this.max = maxLagSec || 8;
    this.sent = 0;
    this.heard = 0;
    this.peak = 0;
  }
  LagWatch.prototype.audio = function (samples, rate) { this.sent += samples / rate; };
  LagWatch.prototype.final = function (end) { if (end > this.heard) this.heard = end; };
  LagWatch.prototype.tooSlow = function () {
    var lag = this.sent - this.heard;
    var growing = lag > this.peak;
    if (growing) this.peak = lag;
    return lag > this.max && growing;
  };

  return { Resampler: Resampler, toS16: toS16, rms: rms, meterLevel: meterLevel, encodeWav: encodeWav,
    readWav: readWav, concatWav: concatWav, LagWatch: LagWatch };
});
