// worksuite-ai: the HTTP + WebSocket server of API v1 (docs/local-ai/spec.md, "Local service API contracts").
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { freeBytes } from "./download";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { VERSION as SINHALA_CORE_VERSION } from "@worksuite/sinhala-core";
import { ApiError, toApiError } from "./errors";
import { bool, Ctx, num, oneOf, RAW, readJson, Router, sendJson, STATUS, str, text, withStatus } from "./http";
import { originAllowed, tokenFrom, tokenMatches } from "./auth";
import { EventBus } from "./events";
import { JobManager } from "./jobs";
import { RequestRegistry } from "./requests";
import { Diagnostics } from "./diagnostics";
import { detectHardware, Hardware, Runner } from "./hardware";
import { normalizePolicy, Policy, PolicyReader, systemPolicyReader } from "./policy";
import { layout, Layout } from "./paths";
import { SettingsStore } from "./settings";
import { trustedKeys } from "./signing";
import { Catalog, Fetcher } from "./catalog";
import { EngineRegistry } from "./engines/registry";
import { ModelStore } from "./models";
import { Runtime } from "./runtime";
import { Dictionaries } from "./text/dictionaries";
import { TextService, TRANSFORM_OPS } from "./text/service";
import { passesSiGrammar, passesSiStt } from "./manifest";
import { parseMultipart } from "./multipart";
import { SpeechStream } from "./speech/stream";
import { chooseModel, runTranscription } from "./speech/transcribe";
import { mediaOf, pcmToWav, wavHeader } from "./audio";
import { encode, resolveVoice, synthesize, voices } from "./tts";
import { legacyDecode, legacyEncode, legacyFonts, segmentWords, sinhalaNormalize, sinhalaTransliterate, sinhalaValidate } from "./sinhala/routes";
import { Priority } from "./scheduler";

export const API_VERSION = "1.3";
export const SERVICE_VERSION = "1.0.0";

export interface ServiceOptions {
  dataDir: string;
  token?: string;
  env?: NodeJS.ProcessEnv;
  fetcher?: Fetcher;
  hardwareRunner?: Runner;
  policyReader?: PolicyReader;
  /** exit after this long with nothing to do (30 min); 0 disables */
  idleExitMs?: number;
  onIdle?: () => void;
  /** extra allowed Origin values (tests) */
  extraOrigins?: string[];
}

export class Service {
  readonly token: string;
  readonly events = new EventBus();
  readonly jobs: JobManager;
  readonly requests = new RequestRegistry();
  readonly diag = new Diagnostics();
  readonly settings: SettingsStore;
  readonly catalog: Catalog;
  readonly engines: EngineRegistry;
  readonly models: ModelStore;
  readonly runtime: Runtime;
  readonly dict: Dictionaries;
  readonly text: TextService;
  hardware: Hardware | null = null;
  policy: Policy = normalizePolicy(null);
  server: Server | null = null;
  // subprotocols: "ws-ai.v1, bearer.<token>" -> echo ws-ai.v1 (browsers need one of theirs echoed)
  private wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has("ws-ai.v1") ? "ws-ai.v1" : [...protocols][0] ?? false) });
  private router = new Router();
  private paths: Layout;
  private env: NodeJS.ProcessEnv;
  private lastActivity = Date.now();
  private sockets = 0;
  private timers: NodeJS.Timeout[] = [];
  private policyReader: PolicyReader;
  readonly startedAt = Date.now();

  constructor(private o: ServiceOptions) {
    this.env = o.env || process.env;
    this.token = o.token || randomBytes(32).toString("base64url");
    this.jobs = new JobManager(this.events);
    this.settings = new SettingsStore(join(o.dataDir, "settings.json"));
    this.paths = layout(o.dataDir, this.storagePath());
    for (const d of [o.dataDir, this.paths.cacheDir, this.paths.dictionariesDir]) mkdirSync(d, { recursive: true, mode: 0o700 });
    this.policyReader = o.policyReader || systemPolicyReader(this.env);
    const keys = () => trustedKeys(this.env);
    this.catalog = new Catalog(this.paths.cacheDir, keys, this.env.WS_AI_CATALOG_URL, o.fetcher, this.env);
    this.engines = new EngineRegistry(this.paths.enginesDir, this.catalog, keys, () => this.hardware, () => this.policy, this.env, o.fetcher);
    this.models = new ModelStore({
      modelsDir: () => layout(o.dataDir, this.storagePath()).modelsDir,
      cacheDir: this.paths.cacheDir, catalog: this.catalog, jobs: this.jobs, events: this.events, settings: this.settings,
      policy: () => this.policy, keys, engines: this.engines, isLoaded: (id) => this.runtime.pool.isLoaded(id), unload: (id) => this.runtime.pool.unload(id),
      hardware: () => this.hardware, fetcher: o.fetcher, env: this.env,
    });
    this.runtime = new Runtime(this.models, this.engines, this.jobs, this.events, () => this.policy);
    this.dict = new Dictionaries(this.paths.dictionariesDir, o.fetcher);
    this.text = new TextService(this.dict, this.models, this.runtime, () => this.policy, this.diag, this.env);
    this.routes();
  }

  /** The models folder's parent: the organisation's aiStoragePath, else the person's choice. */
  storagePath(): string | null { return this.policy?.storagePath || this.settings.data.storagePath; }

  // ---- lifecycle ------------------------------------------------------------------------------------
  async init(): Promise<void> {
    await this.reloadPolicy(false);
    this.hardware = await detectHardware(this.o.hardwareRunner).catch(() => null);
  }

  async reloadPolicy(emit = true): Promise<void> {
    const next = await this.policyReader().catch(() => this.policy);
    const changed = JSON.stringify(next) !== JSON.stringify(this.policy);
    this.policy = next;
    if (next.catalogUrl) this.catalog.setUrl(next.catalogUrl);
    if (changed) {
      if (this.models) this.models.scan();
      if (emit) this.events.emit("policy", next);
      // models no longer approved are unloaded at once
      for (const l of this.runtime.pool.list()) if (!this.models.policyAllows(l.id)) this.runtime.pool.unload(l.id);
      void this.dict.refreshOrg(next.orgDictionaryUrl);
    }
  }

  async listen(port = 0): Promise<number> {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.server.on("upgrade", (req, socket, head) => this.upgrade(req, socket as import("node:net").Socket, head));
    await new Promise<void>((r) => this.server!.listen(port, "127.0.0.1", () => r()));
    this.runtime.pool.startSweeper();
    this.timers.push(setInterval(() => void this.reloadPolicy(), 60000));
    this.timers.push(setInterval(() => void this.dict.refreshOrg(this.policy.orgDictionaryUrl), 6 * 3600 * 1000));
    const idle = this.o.idleExitMs ?? 30 * 60 * 1000;
    if (idle > 0) this.timers.push(setInterval(() => this.checkIdle(idle), Math.min(60000, idle / 2)));
    for (const t of this.timers) t.unref();
    void this.catalog.refresh();
    return (this.server.address() as { port: number }).port;
  }

  private checkIdle(idleMs: number): void {
    if (this.sockets > 0 || this.jobs.runningCount > 0 || this.requests.size > 0) return;
    if (Date.now() - this.lastActivity >= idleMs) this.o.onIdle?.();
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.runtime.pool.stopSweeper();
    this.runtime.pool.unloadAll();
    for (const c of this.wss.clients) c.terminate();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server?.closeAllConnections?.();
  }

  // ---- HTTP -----------------------------------------------------------------------------------------
  private cors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (origin && originAllowed(origin, this.o.extraOrigins)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "authorization, content-type, x-request-id");
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("access-control-expose-headers", "x-request-id");
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const t0 = performance.now();
    this.lastActivity = Date.now();
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let route = url.pathname;
    let status = 200;
    let code: string | undefined;
    const ac = new AbortController();
    const requestId = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined;
    const unregister = this.requests.register(requestId, ac);
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    try {
      this.cors(req, res);
      if (!originAllowed(req.headers.origin, this.o.extraOrigins)) throw new ApiError("unauthorized", "Origin not allowed", undefined, 403);
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
      if (!tokenMatches(tokenFrom(req, url), this.token)) throw new ApiError("unauthorized", "Missing or wrong token");
      const m = this.router.match(req.method || "GET", url.pathname);
      if (m === "method") throw new ApiError("bad_request", "Method not allowed", undefined, 405);
      if (!m) throw new ApiError("not_found", "No such endpoint");
      route = url.pathname.replace(/\/[^/]+/g, (seg) => (Object.values(m.params).includes(decodeURIComponent(seg.slice(1))) ? "/:id" : seg));
      let bodyP: Promise<unknown> | null = null;
      const ctx: Ctx = {
        req, res, params: m.params, query: url.searchParams, signal: ac.signal, requestId,
        body: <T,>() => (bodyP ||= readJson<T>(req)) as Promise<T>,
      };
      const result = await m.handler(ctx);
      if (result === RAW) { status = res.statusCode; return; }
      if (result && typeof result === "object" && STATUS in (result as object)) {
        const r = result as { [STATUS]: number; body: unknown };
        status = r[STATUS];
        sendJson(res, status, r.body);
      } else sendJson(res, 200, result ?? { ok: true });
    } catch (e) {
      const err = toApiError(e);
      status = err.status;
      code = err.code;
      if (!res.headersSent) sendJson(res, err.status, err.toJSON());
      else res.end();
    } finally {
      unregister();
      this.diag.record(`${req.method} ${route}`, status, performance.now() - t0, code);
    }
  }

  // ---- WebSockets -------------------------------------------------------------------------------------
  private upgrade(req: IncomingMessage, socket: import("node:net").Socket, head: Buffer): void {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const refuse = (status: number, msg: string) => { socket.write(`HTTP/1.1 ${status} ${msg}\r\nconnection: close\r\n\r\n`); socket.destroy(); };
    if (!originAllowed(req.headers.origin, this.o.extraOrigins)) return refuse(403, "Forbidden");
    if (!tokenMatches(tokenFrom(req, url), this.token)) return refuse(401, "Unauthorized");
    if (url.pathname !== "/v1/events" && url.pathname !== "/v1/speech/stream") return refuse(404, "Not Found");
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.sockets++;
      this.lastActivity = Date.now();
      ws.on("message", () => { this.lastActivity = Date.now(); });
      ws.on("close", () => { this.sockets--; this.lastActivity = Date.now(); });
      if (url.pathname === "/v1/events") this.eventsSocket(ws);
      else this.speechSocket(ws, url);
    });
  }

  private eventsSocket(ws: WebSocket): void {
    ws.send(JSON.stringify({ type: "hello", data: { apiVersion: API_VERSION, serviceVersion: SERVICE_VERSION } }));
    const off = this.events.on((e) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e)); });
    ws.on("close", off);
  }

  private speechSocket(ws: WebSocket, url: URL): void {
    const lang = url.searchParams.get("lang") || "auto";
    if (!["auto", "si", "en"].includes(lang)) { ws.send(JSON.stringify({ type: "error", code: "bad_request" })); ws.send(JSON.stringify({ type: "closed" })); ws.close(1000); return; }
    const keep = this.settings.data.privacy.keepRecordings;
    const s = new SpeechStream(ws, { lang, model: url.searchParams.get("model"), punctuate: url.searchParams.get("punctuate") !== "false" }, this.models, this.runtime, () => this.policy,
      keep ? (pcm) => { try { mkdirSync(this.paths.recordingsDir, { recursive: true, mode: 0o700 }); writeFileSync(join(this.paths.recordingsDir, `dictation-${Date.now()}.wav`), pcmToWav(pcm), { mode: 0o600 }); } catch { /* best effort */ } } : null);
    ws.on("close", () => s.abort());
    void s.start();
  }

  // ---- capabilities ----------------------------------------------------------------------------------
  capabilities(): string[] {
    const p = this.policy.features;
    const caps: string[] = [];
    const stt = this.models.tryResolve("stt");
    if (p.stt && stt) caps.push("speech.stt");
    if (p.stt && stt && passesSiStt(stt.manifest)) caps.push("speech.stt.si");
    if (p.stt && this.models.tryResolve("diarization")) caps.push("speech.diarization");
    if (p.suggestions) caps.push("text.complete");
    if (p.correction) caps.push("text.check");
    const corr = this.models.tryResolve("correction");
    if (p.correction && corr) caps.push("text.transform", "text.grammar");
    if (p.correction && corr && passesSiGrammar(corr.manifest)) caps.push("text.grammar.si");
    if (p.translate && this.models.tryResolve("translation")) caps.push("translate");
    const voicesNow = p.tts ? voices(this.models) : [];
    if (voicesNow.length) caps.push("tts");
    if (voicesNow.some((v) => v.lang === "si")) caps.push("tts.si");
    if (p.assistant && this.models.tryResolve("assistant")) caps.push("assistant");
    caps.push("sinhala");
    return caps;
  }

  private feature(f: keyof Policy["features"]): void {
    if (!this.policy.features[f]) throw new ApiError("forbidden_by_policy", `${f} is turned off by your organization`, { feature: f });
  }

  // ---- routes ----------------------------------------------------------------------------------------
  private routes(): void {
    const r = this.router;

    // service and hardware
    r.get("/v1/info", () => ({ apiVersion: API_VERSION, serviceVersion: SERVICE_VERSION, capabilities: this.capabilities(), profile: this.hardware?.recommendedProfile || "lite" }));
    r.get("/v1/hardware", async (c) => {
      if (!this.hardware || c.query.get("refresh") === "1") this.hardware = await detectHardware(this.o.hardwareRunner);
      return this.hardware;
    });
    r.get("/v1/health", () => ({
      ok: true,
      loadedModels: this.runtime.pool.list().map((l) => ({ id: l.id, task: l.task, memMB: l.memMB })),
      queueDepth: this.runtime.scheduler.depth,
    }));

    // catalog and models
    r.get("/v1/catalog", async (c) => {
      if (c.query.get("refresh") === "1") await this.catalog.refresh();
      return this.catalog.list(this.hardware, this.policy, c.query.get("task"), c.query.get("lang"));
    });
    r.get("/v1/engines", () => ({ engines: this.engines.summary(), installed: this.engines.installed().map((e) => ({ engine: e.engine, version: e.version, backend: e.backend })) }));
    r.get("/v1/models", (c) => this.models.list(c.query.get("task")));
    r.post("/v1/models/import", async (c) => {
      const { files } = await parseMultipart(c.req, join(this.paths.cacheDir, "uploads"), 64 * 1024 ** 3);
      const f = files.find((x) => x.field === "file") || files[0];
      if (!f) throw new ApiError("bad_request", 'Send the .wsmodel as the "file" part');
      return withStatus(202, { jobId: this.models.importFile(f.path).id });
    });
    r.post("/v1/models/:id/install", async (c) => {
      const b = await c.body<{ version?: string }>();
      const j = this.models.install(c.params.id, b.version ? str(b.version, "version") : undefined);
      return withStatus(202, { jobId: j.id });
    });
    r.post("/v1/models/:id/pause", (c) => this.models.pauseInstall(c.params.id));
    r.post("/v1/models/:id/resume", (c) => {
      const j = this.models.resumeInstall(c.params.id);
      return withStatus(202, { jobId: j.id, ...j });
    });
    r.post("/v1/models/:id/cancel", (c) => this.models.cancelInstall(c.params.id));
    r.delete("/v1/models/:id", (c) => this.models.uninstall(c.params.id));
    r.post("/v1/models/:id/activate", async (c) => {
      const l = await this.runtime.activate(c.params.id);
      return { id: l.id, state: "active", memMB: l.memMB };
    });
    r.post("/v1/models/:id/deactivate", (c) => {
      if (!this.models.get(c.params.id)) throw new ApiError("model_not_installed", `Model ${c.params.id} is not installed`);
      this.runtime.deactivate(c.params.id);
      return { id: c.params.id, state: "installed" };
    });
    r.get("/v1/models/:id/export", async (c) => {
      const m = this.models.get(c.params.id);
      if (!m) throw new ApiError("model_not_installed", `Model ${c.params.id} is not installed`);
      c.res.writeHead(200, { "content-type": "application/vnd.worksuite.wsmodel", "content-disposition": `attachment; filename="${m.manifest.id}-${m.manifest.version}.wsmodel"` });
      await this.models.exportTo(c.params.id, c.res, c.signal);
      return RAW;
    });
    r.get("/v1/defaults", () => this.settings.data.defaults);
    r.put("/v1/defaults", async (c) => this.models.setDefaults(await c.body()));
    r.get("/v1/storage", () => {
      const dir = layout(this.o.dataDir, this.storagePath()).modelsDir;
      if (this.policy.storagePath) return { path: dir, usedMB: Math.round(this.models.all().reduce((s, m) => s + m.sizeBytes, 0) / 1048576), freeMB: Math.floor(freeBytes(dir) / 1048576), managed: true };
      const used = this.models.all().reduce((s, m) => s + m.sizeBytes, 0);
      const freeMB = Math.floor(freeBytes(dir) / 1048576);
      return { path: dir, usedMB: Math.round(used / 1048576), freeMB };
    });
    r.post("/v1/storage/move", async (c) => {
      if (this.policy.storagePath) throw new ApiError("forbidden_by_policy", "The storage folder is managed by your organization");
      const b = await c.body<{ path?: string }>();
      return withStatus(202, { jobId: this.models.move(str(b.path, "path")).id });
    });

    // jobs and requests
    r.get("/v1/jobs", () => this.jobs.list());
    r.get("/v1/jobs/:id", (c) => this.jobs.get(c.params.id));
    r.delete("/v1/jobs/:id", (c) => {
      const j = this.jobs.get(c.params.id);
      // cancelling an install also drops its partial download
      if (j.type === "install" && j.modelId && ["queued", "running", "paused"].includes(j.state)) return this.models.cancelInstall(j.modelId);
      return this.jobs.cancel(c.params.id);
    });
    r.get("/v1/jobs/:id/file", (c) => {
      const j = this.jobs.get(c.params.id);
      const res = j.result as { file?: string; contentType?: string } | undefined;
      if (j.state !== "done" || !res?.file || !existsSync(res.file)) throw new ApiError("not_found", "This job has no file");
      c.res.writeHead(200, { "content-type": res.contentType || "application/octet-stream", "content-length": statSync(res.file).size });
      createReadStream(res.file).pipe(c.res);
      return RAW;
    });
    r.delete("/v1/requests/:id", (c) => ({ id: c.params.id, cancelled: this.requests.cancel(c.params.id) }));

    // speech
    r.post("/v1/speech/transcribe", async (c) => {
      this.feature("stt");
      const { files, fields } = await parseMultipart(c.req, join(this.paths.cacheDir, "uploads"), 8 * 1024 ** 3);
      const f = files.find((x) => x.field === "file") || files[0];
      if (!f) throw new ApiError("bad_request", 'Send the audio as the "file" part');
      try {
        let opts: Record<string, unknown> = {};
        const json = fields.options || fields.json || fields.params;
        if (json) { try { opts = JSON.parse(json); } catch { throw new ApiError("bad_request", "options is not JSON"); } }
        for (const k of ["lang", "punctuate", "timestamps", "diarize", "model"]) if (fields[k] !== undefined && opts[k] === undefined) opts[k] = ["punctuate", "timestamps", "diarize"].includes(k) ? fields[k] === "true" : fields[k];
        const o = {
          lang: oneOf(opts.lang, "lang", ["auto", "si", "en", "ta"] as const, "auto"),
          punctuate: bool(opts.punctuate, "punctuate", true), timestamps: bool(opts.timestamps, "timestamps", true), diarize: bool(opts.diarize, "diarize", false),
          model: typeof opts.model === "string" ? opts.model : null,
        };
        const head = Buffer.alloc(12);
        try { const fd = openSync(f.path, "r"); readSync(fd, head, 0, 12, 0); closeSync(fd); } catch { /* empty file */ }
        const media = mediaOf(f.filename, f.mime, head);
        if (!media) throw new ApiError("unsupported_media", "Supported: wav, mp3, m4a, mp4");
        const model = chooseModel(this.models, o);
        const keepDir = this.settings.data.privacy.keepRecordings ? this.paths.recordingsDir : null;
        const job = this.jobs.start("transcribe", (j) => runTranscription(j, f.path, media, o, model, { runtime: this.runtime, engines: this.engines, keepDir }), { modelId: model.manifest.id });
        return withStatus(202, { jobId: job.id });
      } catch (e) {
        rmSync(f.path, { force: true });
        throw e;
      }
    });

    // text
    r.post("/v1/text/complete", async (c) => {
      const b = await c.body();
      return this.text.complete({
        text: text(b.text), caret: num(b.caret, "caret", String(b.text ?? "").length, 0), lang: oneOf(b.lang, "lang", ["si", "en", "mixed", "auto"] as const, "auto"),
        mode: oneOf(b.mode, "mode", ["word", "phrase"] as const, "word"), singlish: b.singlish === undefined ? undefined : bool(b.singlish, "singlish", false),
        max: num(b.max, "max", 5, 1, 20),
      }, c.signal);
    });
    r.post("/v1/text/check", async (c) => {
      const b = await c.body();
      const kinds = b.kinds === undefined ? [] : Array.isArray(b.kinds) ? b.kinds.map((k) => oneOf(k, "kinds", ["spelling", "grammar", "punctuation"] as const)) : (() => { throw new ApiError("bad_request", '"kinds" must be a list'); })();
      return this.text.check({ text: text(b.text), lang: oneOf(b.lang, "lang", ["auto", "si", "en", "mixed", "ta"] as const, "auto"), kinds }, c.signal);
    });
    r.post("/v1/text/transform", async (c) => {
      const b = await c.body();
      return this.text.transform({
        text: text(b.text), lang: oneOf(b.lang, "lang", ["auto", "si", "en", "mixed", "ta"] as const, "auto"), op: oneOf(b.op, "op", TRANSFORM_OPS),
        tone: b.tone === undefined ? undefined : str(b.tone, "tone"), targetLength: b.targetLength === undefined ? undefined : num(b.targetLength, "targetLength", 0, 1, 5000),
        context: b.context === undefined ? undefined : text(b.context, "context"), allowCloud: b.allowCloud, model: typeof b.model === "string" ? b.model : undefined,
      }, c.signal);
    });
    r.post("/v1/text/detect-language", async (c) => {
      const b = await c.body();
      return this.text.detect(text(b.text), c.signal);
    });
    r.post("/v1/translate", async (c) => {
      const b = await c.body();
      return this.text.translate({
        text: text(b.text), from: oneOf(b.from, "from", ["auto", "si", "en", "ta"] as const, "auto"), to: oneOf(b.to, "to", ["si", "en", "ta"] as const),
        preserveFormatting: bool(b.preserveFormatting, "preserveFormatting", true), allowCloud: b.allowCloud, model: typeof b.model === "string" ? b.model : undefined,
      }, c.signal);
    });

    // sinhala engine
    r.post("/v1/sinhala/transliterate", async (c) => {
      const b = await c.body();
      return sinhalaTransliterate(text(b.text), oneOf(b.from, "from", ["singlish", "si"] as const, "singlish"), oneOf(b.to, "to", ["si", "singlish"] as const, "si"));
    });
    r.post("/v1/sinhala/normalize", async (c) => sinhalaNormalize(text((await c.body()).text)));
    r.post("/v1/sinhala/validate", async (c) => sinhalaValidate(text((await c.body()).text)));
    r.post("/v1/sinhala/legacy/encode", async (c) => { const b = await c.body(); return legacyEncode(text(b.text), str(b.font ?? "FMAbhaya", "font")); });
    r.post("/v1/sinhala/legacy/decode", async (c) => { const b = await c.body(); return legacyDecode(text(b.text), str(b.font ?? "FMAbhaya", "font")); });
    r.get("/v1/sinhala/legacy/fonts", () => legacyFonts());
    r.post("/v1/sinhala/segment", async (c) => segmentWords(text((await c.body()).text)));

    // dictionaries
    r.get("/v1/dictionaries", () => this.dict.summary());
    r.get("/v1/dictionaries/personal/words", () => ({ words: this.dict.personal.words }));
    r.post("/v1/dictionaries/personal/words", async (c) => {
      const b = await c.body<{ word?: string; words?: string[]; learned?: boolean }>();
      const list = Array.isArray(b.words) ? b.words : b.word ? [b.word] : [];
      if (!list.length) throw new ApiError("bad_request", 'Send "word" or "words"');
      // words learned from accepted suggestions only while learning is on; words the person adds always
      if (b.learned && !this.settings.data.privacy.learning) return { added: [], words: this.dict.personal.words.length, learning: false };
      return { added: this.dict.addPersonal(list), words: this.dict.personal.words.length };
    });
    r.delete("/v1/dictionaries/personal/words", async (c) => {
      const q = c.query.getAll("word");
      const b = q.length ? { words: q } : await c.body<{ word?: string; words?: string[] }>();
      const list = Array.isArray(b.words) ? b.words : (b as { word?: string }).word ? [(b as { word: string }).word] : [];
      return { removed: this.dict.removePersonal(list), words: this.dict.personal.words.length };
    });
    r.post("/v1/dictionaries/personal/learn", async (c) => {
      const b = await c.body();
      if (!this.settings.data.privacy.learning) return { learned: false };
      this.dict.learn(str(b.latin, "latin"), str(b.word, "word"));
      return { learned: true };
    });

    // speech synthesis
    r.get("/v1/tts/voices", () => (this.policy.features.tts ? voices(this.models) : []));
    r.post("/v1/tts/synthesize", async (c) => {
      this.feature("tts");
      const b = await c.body();
      const o = {
        text: text(b.text, "text", 200000), voice: typeof b.voice === "string" ? b.voice : null, rate: num(b.rate, "rate", 1, 0.5, 2),
        format: oneOf(b.format, "format", ["wav", "mp3", "opus"] as const, "wav"), timings: oneOf(b.timings, "timings", ["none", "word", "sentence"] as const, "none"),
      };
      const m = resolveVoice(this.models, o.voice);
      const deps = { runtime: this.runtime, engines: this.engines };
      if (b.export === true) {
        const job = this.jobs.start("tts.export", async (j) => {
          const parts: Buffer[] = [];
          const total = o.text.length || 1;
          const r2 = await synthesize(o, m, deps, (pcm) => { parts.push(pcm); j.progress(Math.min(0.95, parts.reduce((s, p) => s + p.length, 0) / (total * 2 * 1000)), "synthesizing"); }, j.signal);
          const pcm = Buffer.concat(parts);
          const data = o.format === "wav" ? pcmToWav(pcm, r2.sampleRate) : await encode(o.format, pcm, r2.sampleRate, this.engines, j.signal);
          mkdirSync(join(this.paths.cacheDir, "exports"), { recursive: true });
          const file = join(this.paths.cacheDir, "exports", `${j.id}.${o.format === "opus" ? "ogg" : o.format}`);
          writeFileSync(file, data, { mode: 0o600 });
          return { file, contentType: o.format === "wav" ? "audio/wav" : o.format === "mp3" ? "audio/mpeg" : "audio/ogg", url: `/v1/jobs/${j.id}/file`, durationSec: r2.durationSec, timings: r2.timings };
        }, { modelId: m.manifest.id });
        return withStatus(202, { jobId: job.id });
      }
      await this.synthesizeResponse(c, o, m, deps);
      return RAW;
    });

    // assistant (OpenAI-compatible)
    r.get("/v1/openai/models", () => ({
      object: "list",
      data: (this.policy.features.assistant ? this.models.withTask("assistant").filter((m) => this.models.policyAllows(m.manifest.id)) : [])
        .map((m) => ({ id: m.manifest.id, object: "model", created: Math.floor(new Date(m.installedAt).getTime() / 1000), owned_by: "worksuite-local", name: m.manifest.name || m.manifest.id })),
    }));
    r.post("/v1/openai/chat/completions", (c) => this.chat(c));

    // policy, privacy, diagnostics
    r.get("/v1/policy", async (c) => { if (c.query.get("refresh") === "1") await this.reloadPolicy(); return this.policy; });
    r.get("/v1/privacy", () => this.settings.data.privacy);
    r.put("/v1/privacy", async (c) => {
      const b = await c.body();
      const p = this.settings.data.privacy;
      this.settings.data.privacy = { learning: bool(b.learning, "learning", p.learning), keepRecordings: bool(b.keepRecordings, "keepRecordings", p.keepRecordings) };
      this.settings.save();
      this.events.emit("privacy", this.settings.data.privacy);
      return this.settings.data.privacy;
    });
    r.post("/v1/privacy/clear", async (c) => {
      const b = await c.body<{ what?: string[] }>();
      const what = Array.isArray(b.what) && b.what.length ? b.what : ["cache", "recordings", "learned"];
      const cleared: string[] = [];
      for (const w of what) {
        if (w === "cache") { for (const d of ["uploads", "exports"]) rmSync(join(this.paths.cacheDir, d), { recursive: true, force: true }); rmSync(join(this.paths.cacheDir, "catalog.json"), { force: true }); cleared.push(w); }
        else if (w === "recordings") { rmSync(this.paths.recordingsDir, { recursive: true, force: true }); cleared.push(w); }
        else if (w === "learned") { this.dict.clearLearned(); cleared.push(w); }
        else throw new ApiError("bad_request", `Unknown "${w}"; use cache, recordings, learned`);
      }
      return { cleared };
    });
    r.get("/v1/diagnostics", () => ({
      serviceVersion: SERVICE_VERSION, apiVersion: API_VERSION, node: process.version, sinhalaCore: SINHALA_CORE_VERSION,
      platform: `${process.platform}-${process.arch}`, uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      hardware: this.hardware, engines: this.engines.summary(),
      models: this.models.list().map((m) => ({ id: m.id, version: m.version, state: m.state })),
      loaded: this.runtime.pool.list().map((l) => ({ id: l.id, memMB: l.memMB, device: l.device, idleSec: Math.round((Date.now() - l.lastUsed) / 1000) })),
      memoryCapMB: this.runtime.capMB(), queueDepth: this.runtime.scheduler.depth,
      catalog: { origin: this.catalog.state.origin, version: this.catalog.state.doc.version, signature: this.catalog.state.signature, fetchedAt: this.catalog.state.fetchedAt || null },
      policy: { managed: this.policy.managed, source: this.policy.source || null },
      capabilities: this.capabilities(),
      errors: this.diag.errors, timings: this.diag.timings,
      jobs: this.jobs.list().slice(-20).map((j) => ({ id: j.id, type: j.type, state: j.state, modelId: j.modelId, error: j.error?.code })),
    }));
  }

  /** multipart/mixed: the audio part streams sentence by sentence, then a JSON part with the timings. */
  private async synthesizeResponse(c: Ctx, o: Parameters<typeof synthesize>[0], m: ReturnType<typeof resolveVoice>, deps: { runtime: Runtime; engines: EngineRegistry }): Promise<void> {
    const res = c.res;
    const mime = o.format === "wav" ? "audio/wav" : o.format === "mp3" ? "audio/mpeg" : "audio/ogg";
    const boundary = "ws-tts-" + randomBytes(8).toString("hex");
    const multipart = o.timings !== "none";
    let started = false;
    const begin = (rate: number) => {
      if (started) return;
      started = true;
      res.writeHead(200, { "content-type": multipart ? `multipart/mixed; boundary=${boundary}` : mime, "cache-control": "no-store" });
      if (multipart) res.write(`--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`);
      if (o.format === "wav") res.write(wavHeader(0xffffffff, rate));
    };
    const pcmParts: Buffer[] = [];
    const rate = m.manifest.voice?.sampleRate || 22050;
    try {
      const r2 = await synthesize(o, m, deps, (pcm) => {
        if (o.format === "wav") { begin(rate); res.write(pcm); } else pcmParts.push(pcm);
      }, c.signal);
      if (o.format !== "wav") { const data = await encode(o.format, Buffer.concat(pcmParts), r2.sampleRate, this.engines, c.signal); begin(rate); res.write(data); }
      begin(rate);
      if (multipart) res.write(`\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${JSON.stringify({ timings: r2.timings, durationSec: r2.durationSec, sampleRate: r2.sampleRate, voice: m.manifest.id })}\r\n--${boundary}--\r\n`);
      res.end();
    } catch (e) {
      if (!started) throw e;
      if (multipart) res.write(`\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(toApiError(e).toJSON())}\r\n--${boundary}--\r\n`);
      res.end();
    }
  }

  /** OpenAI chat schema in, llama-server out; tools are not part of v1 and are dropped. */
  private async chat(c: Ctx): Promise<typeof RAW | unknown> {
    this.feature("assistant");
    const b = await c.body<Record<string, unknown>>();
    if (!Array.isArray(b.messages) || !b.messages.length) throw new ApiError("bad_request", '"messages" is required');
    if (b.allowCloud === true && !this.policy.cloudAllowed) throw new ApiError("forbidden_by_policy", "Cloud AI is turned off by your organization");
    const totalChars = (b.messages as { content?: unknown }[]).reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length), 0);
    if (totalChars > 400000) throw new ApiError("input_too_long", "The conversation is too long for a local model");
    const modelId = typeof b.model === "string" && b.model && b.model !== "auto" && b.model !== "local" ? b.model.replace(/^local[:/]/, "") : null;
    const body: Record<string, unknown> = { messages: b.messages, stream: b.stream === true };
    for (const k of ["temperature", "max_tokens", "top_p", "stop", "presence_penalty", "frequency_penalty", "seed", "response_format"]) if (b[k] !== undefined) body[k] = b[k];
    const res = c.res;
    await this.runtime.withModel("assistant", modelId, Priority.Interactive, async (l, m) => {
      const up = await fetch(l.baseUrl + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: c.signal });
      if (!up.ok || !up.body) throw new ApiError("internal", `llama-server: HTTP ${up.status}`);
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
        const reader = up.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i + 1);
            buf = buf.slice(i + 1);
            res.write(line.startsWith("data: {") ? line.replace(/"model":"[^"]*"/, `"model":${JSON.stringify(m.manifest.id)}`) : line);
          }
        }
        if (buf) res.write(buf);
        res.end();
      } else {
        const j = (await up.json()) as Record<string, unknown>;
        j.model = m.manifest.id;
        sendJson(res, 200, j);
      }
    }, c.signal);
    return RAW;
  }
}

export const TOKEN_BYTES = 32;
