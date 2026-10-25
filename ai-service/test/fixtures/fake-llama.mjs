// A stand-in for llama.cpp's llama-server: /health and /v1/chat/completions (stream and not).
import { createServer } from "node:http";
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
function answer(messages) {
  const sys = messages.find((m) => m.role === "system")?.content || "";
  const user = messages.filter((m) => m.role === "user").pop()?.content || "";
  if (process.env.FAKE_LLAMA_REPLY) return process.env.FAKE_LLAMA_REPLY;
  if (/proofreader/.test(sys)) {
    const i = user.indexOf("dont");
    // offsets deliberately off by 3: the service must relocate by "original"
    return JSON.stringify({ edits: i < 0 ? [] : [{ start: i + 3, end: i + 7, original: "dont", replacement: "don't", kind: "grammar", message: "apostrophe" },
      { start: 0, end: 2, original: "zz", replacement: "x", kind: "grammar", message: "not in text" }] });
  }
  if (/^Translate/.test(sys)) return "translated: " + user;
  if (/continue the user's text/.test(sys)) return " and more";
  if (/Identify the language/.test(sys)) return '{"lang":"de","confidence":0.8}';
  if (/Summarize/.test(sys)) return "A summary.";
  if (/Improve the text/.test(sys)) return user.replace("teh", "the").replace("bad", "good");
  return "Hello from the local model.";
}
createServer((req, res) => {
  if (req.url === "/health") { res.end('{"status":"ok"}'); return; }
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const body = JSON.parse(b);
      const text = answer(body.messages);
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const w of text.split(/(?<= )/)) res.write(`data: ${JSON.stringify({ model: "gguf", choices: [{ delta: { content: w } }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      } else {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: "x", object: "chat.completion", model: "gguf", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
      }
    });
    return;
  }
  res.statusCode = 404; res.end();
}).listen(port, "127.0.0.1");
