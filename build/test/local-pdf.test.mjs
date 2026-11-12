// build/editors/.../controller/LocalPdf.js: the PDF Editor's PDF Tools reach worksuite-ai with XMLHttpRequest.
// In the editors' frame window.fetch is a GET-only loader that reports 200 on file: pages, and through it
// every job went out as an unauthenticated GET and the editor waited for ever ("Please, wait...").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "editors", "apps", "pdfeditor", "main", "app", "controller", "LocalPdf.js"), "utf8");

// A fake service behind a fake XMLHttpRequest; requests are recorded.
function load(service) {
  const requests = [];
  class XHR {
    open(method, url) { this.method = method; this.url = url; this.headers = {}; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) {
      const req = { method: this.method, url: this.url, headers: this.headers, body };
      requests.push(req);
      setTimeout(() => {
        const r = service(req);
        if (r === "unreachable") return this.onerror();
        this.status = r.status;
        if (this.responseType === "arraybuffer") this.response = r.buffer; else this.responseText = JSON.stringify(r.json || {});
        this.onload();
      }, 0);
    }
  }
  const win = {
    XMLHttpRequest: XHR, setTimeout, clearTimeout, JSON, Promise,
    // the editors' loader: GET only, 200 on file: pages whatever happens
    fetch: () => Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) }),
    AscDesktopEditor: { execCommand(cmd, param) {
      const { req } = JSON.parse(param);
      setTimeout(() => win.on_native_message(cmd, JSON.stringify({ req, ok: true, port: 4321, token: "tkn" })), 0);
    } },
  };
  let mod;
  const ctx = vm.createContext({ window: win, XMLHttpRequest: XHR, setTimeout, clearTimeout, FormData: class FormData {}, define: (deps, f) => { mod = f(); } });
  win.window = win;
  vm.runInContext(src.replace(/window\.AscDesktopEditor/g, "window.AscDesktopEditor"), ctx);
  return { mod, requests, win };
}

test("a PDF job goes to the service as an authenticated POST with its body, and resolves with the result", async () => {
  let polls = 0;
  const { mod, requests } = load((r) => {
    if (r.method === "POST" && r.url.endsWith("/v1/pdf/protect")) return { status: 202, json: { jobId: "j1" } };
    if (r.method === "GET" && r.url.endsWith("/v1/jobs/j1")) return { status: 200, json: ++polls < 2 ? { state: "running", progress: 0.5 } : { state: "done", result: { file: "/x (protected).pdf" } } };
    return { status: 404, json: {} };
  });
  const result = await mod.run("protect", { path: "/x.pdf", userPassword: "a" });
  assert.equal(result.file, "/x (protected).pdf");
  const post = requests.find((r) => r.method === "POST");
  assert.equal(post.url, "http://127.0.0.1:4321/v1/pdf/protect");
  assert.equal(post.headers.Authorization, "Bearer tkn");
  assert.deepEqual(JSON.parse(post.body), { path: "/x.pdf", userPassword: "a" });
});

test("an error from the service is an error (it used to read as success), with its code and message", async () => {
  const { mod } = load(() => ({ status: 400, json: { error: { code: "bad_request", message: "The password is not right" } } }));
  await assert.rejects(mod.run("unprotect", { path: "/x.pdf" }), (e) => e.code === "bad_request" && /password/.test(e.message));
});

test("no job id, or a job the service does not know, ends the wait instead of polling for ever", async () => {
  const a = load((r) => (r.method === "POST" ? { status: 202, json: {} } : { status: 200, json: {} }));
  await assert.rejects(a.mod.run("stamp", { path: "/x.pdf" }), (e) => e.code === "internal");
  const b = load((r) => (r.method === "POST" ? { status: 202, json: { jobId: "gone" } } : { status: 200, json: {} }));
  await assert.rejects(b.mod.run("stamp", { path: "/x.pdf" }), (e) => /lost the job/.test(e.message));
});

test("an unreachable service is service_unavailable", async () => {
  const { mod } = load(() => "unreachable");
  await assert.rejects(mod.run("merge", { paths: [] }), (e) => e.code === "service_unavailable");
});
