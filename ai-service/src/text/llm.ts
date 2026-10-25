// Helpers for asking the local LLM for structured output, and checking it before anything reaches a client.
export const LANG_NAME: Record<string, string> = { si: "Sinhala", en: "English", ta: "Tamil" };

/** The first JSON object in a model's reply (models wrap JSON in prose or ``` fences). */
export function extractJson(s: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  if (start < 0) throw new Error("no JSON object");
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object");
}

/** Strips what models add around a rewritten text: quotes, "Here is…" lead-ins, fences. */
export function cleanRewrite(s: string, original: string): string {
  let t = s.trim().replace(/^```[a-z]*\n?|```$/g, "").trim();
  t = t.replace(/^(here is|here's|sure[,!]?|rewritten( text)?:|result:)[^\n]*\n+/i, "").trim();
  if (/^["“].*["”]$/s.test(t) && !/^["“]/.test(original.trim())) t = t.slice(1, -1).trim();
  // keep the original's leading/trailing whitespace so the diff does not touch it
  const lead = /^\s*/.exec(original)![0];
  const trail = /\s*$/.exec(original)![0];
  return lead + t + trail;
}
