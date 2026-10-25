// Screenshots of the built plugin's windows (dock, review panel, read-aloud bar) with a mocked worksuite-ai
// service and a stand-in for the editor's plugin API (../v1/plugins.js). Not a unit test: run with
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test/screenshots.mjs [out dir]
// after `npm run build:plugin`. Chromium's fake microphone feeds the dock; the speech WebSocket is mocked.
import http from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { root } from "./unit/helpers.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(join(process.execPath, "..", "..", "lib", "node_modules", "playwright")); }
const outDir = process.argv[2] || process.cwd();
mkdirSync(outDir, { recursive: true });
const dist = join(root, "plugin", "dist");
if (!existsSync(join(dist, "config.json"))) throw new Error("build the plugin first (npm run build:plugin)");

// the editor's plugin API, as much as the windows use
const PLUGINS_JS = `
window.Asc = window.Asc || {};
(function () {
  var handlers = {};
  var plugin = window.Asc.plugin = {
    info: { editorType: "word", theme: { type: window.__theme || "light", name: "theme-" + (window.__theme || "light") } },
    tr: function (t) { return t; },
    attachEvent: function (n, fn) { (handlers[n] = handlers[n] || []).push(fn); },
    sendToPlugin: function (n, d) { (window.__sent = window.__sent || []).push([n, d]); },
    executeMethod: function () {},
    onThemeChangedBase: function (t) {
      var dark = t.type === "dark";
      var v = dark ? { "--background-normal": "#333", "--background-toolbar": "#404040", "--text-normal": "rgba(255,255,255,.8)", "--text-secondary": "rgba(255,255,255,.6)", "--text-tertiary": "rgba(255,255,255,.4)", "--border-regular-control": "#666", "--highlight-button-hover": "#555", "--background-accent-button": "#ddd", "--text-inverse": "#333" }
                   : { "--background-normal": "#fff", "--background-toolbar": "#f7f7f7", "--text-normal": "rgba(0,0,0,.8)", "--text-secondary": "rgba(0,0,0,.6)", "--text-tertiary": "rgba(0,0,0,.4)", "--border-regular-control": "#c0c0c0", "--highlight-button-hover": "#e0e0e0", "--background-accent-button": "#446995", "--text-inverse": "#fff" };
      for (var k in v) document.documentElement.style.setProperty(k, v[k]);
    }
  };
  window.__emit = function (n, d) { (handlers[n] || []).forEach(function (fn) { fn(d); }); };
  window.addEventListener("load", function () { plugin.init && plugin.init(); });
})();`;
const PLUGINS_CSS = `.form-control{border:1px solid var(--border-regular-control);border-radius:2px;background:var(--background-normal);color:var(--text-normal);height:22px;font:inherit;padding:0 4px;box-sizing:border-box}
.btn-text-default{border:1px solid var(--border-regular-control);border-radius:2px;background:var(--background-normal);color:var(--text-normal);font:inherit;height:24px;padding:0 10px}`;

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/v1/plugins.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(PLUGINS_JS); }
  if (url === "/v1/plugins-ui.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(""); }
  if (url === "/v1/plugins.css") { res.writeHead(200, { "content-type": "text/css" }); return res.end(PLUGINS_CSS); }
  const file = normalize(join(dist, url.replace(/^\/ws-ai\//, "/")));
  if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/ws-ai/`;

// the mocked service (port 47615, as discovery's dev fallback)
const SERVICE = "http://127.0.0.1:47615/v1";
const info = { apiVersion: "1.3", serviceVersion: "0.1.0", capabilities: ["speech.stt", "text.check", "text.transform", "translate", "tts", "assistant"], profile: "standard" };
function wav(seconds) {
  const n = Math.round(16000 * seconds), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(3000 * Math.sin(2 * Math.PI * 220 * i / 16000)), 44 + i * 2);
  return b;
}
async function mockService(page) {
  await page.route(SERVICE + "/**", (route) => {
    const u = new URL(route.request().url());
    const json = (d) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(d) });
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (u.pathname === "/v1/info") return json(info);
    if (u.pathname === "/v1/tts/voices") return json([{ id: "en_US-amy-medium", lang: "en", quality: "medium", modelId: "piper-en" }, { id: "en_GB-alan-low", lang: "en", quality: "low", modelId: "piper-en" }]);
    if (u.pathname === "/v1/tts/synthesize") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "audio/wav" }, body: wav(1.5) });
    if (u.pathname === "/v1/models") return json([]);
    return route.fulfill({ status: 404, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ error: { code: "internal", message: "mock: " + u.pathname } }) });
  });
}
const endpoint = { base: SERVICE, token: "mock", port: 47615 };

const browser = await pw.chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
async function open(file, size, theme) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 2 });
  await page.addInitScript((t) => { window.__theme = t; try { localStorage.setItem("worksuite-ai-voice-consent", "1"); } catch (e) {} }, theme);
  await page.addInitScript(() => {
    // the speech stream: partial, then final, then a new partial
    window.WebSocket = class {
      constructor(url, protocols) { window.__ws = { url, protocols }; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); this.script(); }, 50); }
      send() {}
      close() { this.readyState = 3; }
      script() {
        const say = (m, ms) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(m) }), ms);
        if (window.__wsError) return say({ type: "error", code: window.__wsError }, 50);
        say({ type: "partial", segmentId: 1, text: "Thank you all for" }, 100);
        say({ type: "final", segmentId: 1, text: "Thank you all for joining the quarterly review.", lang: "en", start: 0, end: 3.2, confidence: 0.93 }, 250);
        say({ type: "partial", segmentId: 2, text: "Let's start with the sales" }, 400);
      }
    };
  });
  page.on("console", (m) => process.env.DEBUG && console.log("console:", m.text()));
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await mockService(page);
  await page.goto(base + file);
  await page.evaluate((t) => window.Asc.plugin.onThemeChangedBase({ type: t }), theme);
  if (theme === "dark") await page.evaluate(() => document.documentElement.classList.add("ws-dark"));
  return page;
}
const shots = [];
async function shot(page, name) { const p = join(outDir, `ai-plugin-${name}.png`); await page.screenshot({ path: p }); shots.push(p); }

// W3 dock: listening, final text and a greyed partial
for (const theme of ["light", "dark"]) {
  const dock = await open("dock.html", [380, 124], theme);
  await dock.evaluate((ep) => { window.__emit("onState", { lang: "auto", installModel: "whisper-small-q5" }); window.__emit("onService", { endpoint: ep, info: { apiVersion: "1.3", capabilities: ["speech.stt"] }, settings: {} }); }, endpoint);
  await dock.waitForFunction(() => document.getElementById("partial").textContent.includes("sales"), null, { timeout: 15000 });
  await dock.waitForTimeout(400);
  await shot(dock, "dock" + (theme === "dark" ? "-dark" : ""));
  const ws = await dock.evaluate(() => window.__ws);
  if (!/\/v1\/speech\/stream\?lang=auto&punctuate=true$/.test(ws.url) || ws.protocols[1] !== "bearer.mock") throw new Error("speech stream " + JSON.stringify(ws));
  await dock.close();
}

// W3 dock: no speech model -> Install Whisper small
{
  const dock = await open("dock.html", [380, 124], "light");
  await dock.evaluate((ep) => { window.__wsError = "model_not_installed"; window.__emit("onState", { lang: "auto", installModel: "whisper-small-q5" }); window.__emit("onService", { endpoint: ep, info: { capabilities: [] }, settings: {} }); }, endpoint);
  await dock.waitForFunction(() => !document.getElementById("install").hidden, null, { timeout: 15000 });
  await shot(dock, "dock-install");
  await dock.close();
}

// W6 review panel: Improve, three changes, one already accepted (Undo on)
const original = "Our team have made good progress this quarter, we has closed 42 deals and the pipeline look healthy for next quarter.";
const edits = [
  { id: "e1", start: original.indexOf("have"), end: original.indexOf("have") + 4, replacement: "has", original: "have", reason: "Subject–verb agreement: “team” is singular." },
  { id: "e2", start: original.indexOf(", we"), end: original.indexOf(", we") + 4, replacement: "; we", original: ", we", reason: "Two independent clauses: use a semicolon." },
  { id: "e3", start: original.indexOf("has closed"), end: original.indexOf("has closed") + 3, replacement: "have", original: "has", reason: "“we” takes “have”." },
  { id: "e4", start: original.indexOf("look "), end: original.indexOf("look ") + 4, replacement: "looks", original: "look", reason: "Subject–verb agreement." }
];
for (const theme of ["light", "dark"]) {
  const review = await open("review.html", [380, 560], theme);
  await review.evaluate(([o, e]) => window.__emit("onReview", { cmd: "grammar", title: "Correct grammar", original: o, edits: e, canUndo: true, track: true, status: "ready", options: {} }), [original, edits]);
  await shot(review, "review" + (theme === "dark" ? "-dark" : ""));
  await review.close();
}

// W8 read-aloud bar, playing the second sentence
{
  const reader = await open("reader.html", [560, 96], "light");
  const text = "The quarterly review starts at ten. Sales closed 42 deals, up from 31. Next, the product roadmap.";
  await reader.evaluate(([t, ep]) => {
    window.__emit("onState", { text: t, sentences: [{ start: 0, end: 36, text: "The quarterly review starts at ten." }, { start: 36, end: 71, text: "Sales closed 42 deals, up from 31." }, { start: 71, end: 97, text: "Next, the product roadmap." }] });
    window.__emit("onService", { endpoint: ep, info: { capabilities: ["tts"] }, settings: { rate: 1.25, volume: 0.8 } });
  }, [text, endpoint]);
  await reader.waitForFunction(() => document.getElementById("voice").options.length > 0, null, { timeout: 10000 });
  await reader.evaluate(() => { window.WsAiReader._test.show(1); window.WsAiReader._test.setPlaying(true); });
  await reader.waitForTimeout(400);
  await shot(reader, "reader");
  await reader.close();
}

await browser.close();
server.close();
console.log(shots.join("\n"));
