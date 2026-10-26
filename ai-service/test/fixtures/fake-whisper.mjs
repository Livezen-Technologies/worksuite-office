// A stand-in for whisper.cpp's whisper-server: /health and /inference (verbose_json).
import { createServer } from "node:http";
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const tdrz = args.includes("-tdrz");
createServer((req, res) => {
  if (req.url === "/health") { res.end('{"status":"ok"}'); return; }
  if (req.url === "/inference" && req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      const lang = /name="language"\r\n\r\n([a-z]+)/.exec(body)?.[1] || "auto";
      const dataBytes = Math.max(0, body.length - 600);
      const secs = dataBytes / 32000;
      const text = process.env.FAKE_WHISPER_TEXT || "Hello, world.";
      const detected = lang === "auto" ? (process.env.FAKE_WHISPER_LANG || "en") : lang;
      const segments = tdrz
        ? [{ start: 0, end: secs / 2, text: "First speaker. [SPEAKER_TURN]", avg_logprob: -0.1 }, { start: secs / 2, end: secs, text: "Second speaker.", avg_logprob: -0.2 }]
        : [{ start: 0, end: secs, text, avg_logprob: -0.05 }];
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ text: segments.map((s) => s.text).join(" "), language: detected, segments }));
    });
    return;
  }
  res.statusCode = 404; res.end();
}).listen(port, "127.0.0.1");
