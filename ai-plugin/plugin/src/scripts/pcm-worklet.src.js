/*
 * The microphone's AudioWorklet: resamples to 16 kHz s16le in 40 ms frames on the audio thread and posts
 * each frame (transferred) with its level. The build puts lib/resampler.js in front of this file to make
 * scripts/pcm-worklet.js (a worklet cannot load scripts).
 */
/* global WsAiAudio, sampleRate, registerProcessor, AudioWorkletProcessor */
class WsAiPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.r = new globalThis.WsAiAudio.Resampler(sampleRate, 16000, 40);
    this.on = true;
    this.port.onmessage = (e) => {
      if (e.data === "pause") this.on = false;
      else if (e.data === "resume") this.on = true;
      else if (e.data === "flush") {
        const last = this.r.flush();
        this.port.postMessage({ flush: true, pcm: last ? last.buffer : null, level: 0 });
      }
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && this.on) {
      for (const f of this.r.push(ch)) this.port.postMessage({ pcm: f.buffer, level: globalThis.WsAiAudio.rms(f) }, [f.buffer]);
    }
    return true;
  }
}
registerProcessor("ws-ai-pcm", WsAiPcmProcessor);
