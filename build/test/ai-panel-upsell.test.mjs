// build/ai-panel/ws-ai-panel.js runs inside the AI agent panel's iframe. The AI assistant is a Pro
// feature; the local service answers chat with HTTP 402 when unlicensed. This checks the overlay wraps
// fetch/XHR and shows the Upgrade prompt only for a 402 from the local /v1/openai endpoint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "ai-panel", "ws-ai-panel.js"), "utf8");

function load(baseFetch) {
  const appended = [];
  const el = () => ({
    className: "", style: {}, children: [], hidden: false,
    classList: { add() {}, remove() {} },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, setAttribute() {},
  });
  const document = {
    createElement: el,
    documentElement: { classList: { add() {} } },
    body: { appendChild: (c) => appended.push(c) },
    addEventListener() {},
  };
  class XHR {
    open(method, url) { this.__url = url; }
    addEventListener(type, fn) { if (type === "load") this._load = fn; }
    send() {}
    fire(status) { this.status = status; this._load && this._load(); }
  }
  const win = {
    fetch: baseFetch, addEventListener() {}, parent: {},
    RendererProcessVariable: { lang: "en" }, XMLHttpRequest: XHR,
  };
  win.window = win;
  const ctx = {
    window: win, document, navigator: { language: "en" }, XMLHttpRequest: XHR,
    setTimeout, clearTimeout, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { win, appended, XHR, overlayCount: () => appended.filter((e) => e.className === "ws-ai-upsell").length };
}

test("a 402 from the local /v1/openai endpoint shows the upsell once", async () => {
  const { win, overlayCount } = load(() => Promise.resolve({ status: 402 }));
  await win.fetch("http://127.0.0.1:4321/v1/openai/chat/completions");
  assert.equal(overlayCount(), 1);
  await win.fetch("http://127.0.0.1:4321/v1/openai/chat/completions"); // reused, not duplicated
  assert.equal(overlayCount(), 1);
});

test("a successful chat shows nothing", async () => {
  const { win, overlayCount } = load(() => Promise.resolve({ status: 200 }));
  await win.fetch("http://127.0.0.1:4321/v1/openai/chat/completions");
  assert.equal(overlayCount(), 0);
});

test("a 402 from some other host is left to the panel", async () => {
  const { win, overlayCount } = load(() => Promise.resolve({ status: 402 }));
  await win.fetch("https://api.example.com/v1/chat/completions");
  assert.equal(overlayCount(), 0);
});

test("the fetch wrapper returns the original response untouched", async () => {
  const res = { status: 402, body: "x" };
  const { win } = load(() => Promise.resolve(res));
  assert.equal(await win.fetch("http://127.0.0.1:4321/v1/openai/chat/completions"), res);
});

test("XHR is wrapped too: a 402 load to /v1/openai shows the upsell", () => {
  const { win, overlayCount, XHR } = load(() => Promise.resolve({ status: 200 }));
  const x = new win.XMLHttpRequest();
  x.open("POST", "http://127.0.0.1:4321/v1/openai/chat/completions");
  x.send();
  x.fire(402);
  assert.equal(overlayCount(), 1);
  const ok = new win.XMLHttpRequest();
  ok.open("POST", "http://127.0.0.1:4321/v1/openai/chat/completions");
  ok.send();
  ok.fire(200);
  assert.equal(overlayCount(), 1);
  assert.ok(XHR);
});
