// Drafts for WorkSuite Project and WorkSuite Diagram (#88, docs/project-diagram/roadmap.md, stage 4): a plan
// or a diagram from a description, written by the local model in the formats the editors already read: an
// outline (project/core/outline.js) or a table (diagram/core/fromtable.js). The editors parse, link, schedule
// and lay out the result themselves, so a model only has to write plain lines, which small models do well.
import { ApiError } from "../errors";

export const DRAFT_KINDS = ["plan", "org", "flow"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

const PROMPT: Record<DraftKind, string> = {
  plan: [
    "You write project plan outlines. Reply with the outline only: one task per line, no other text.",
    "Group tasks under phases: a phase on its own line, its tasks under it indented by two spaces.",
    "End each task line with a duration in working days or weeks, like 3d or 2w. End a line with the word milestone for a milestone.",
    "Where the request names people or roles, end the task line with @Name.",
    "Use between 6 and 40 lines. No numbering, no bullets, no markdown, no explanations.",
  ].join(" "),
  org: [
    "You write organisation charts as tables. Reply with the table only, tab-separated, no other text.",
    "The first line is exactly: Name<TAB>Role<TAB>Reports to. Then one line per position.",
    "The top position has an empty Reports to. Every other Reports to is a Name from an earlier line.",
    "Where no names are given, use the role as the Name. Use between 3 and 40 lines. No markdown.",
  ].join(" "),
  flow: [
    "You write flowcharts as tables. Reply with the table only, tab-separated, no other text.",
    "The first line is exactly: From<TAB>To<TAB>Label. Then one line per arrow between two steps.",
    "Steps are short (2 to 6 words). A decision step ends with a question mark and has one line per answer, with the answer as the Label.",
    "Start from a first step like Start or the triggering event and end at a final step. Use between 3 and 40 lines. No markdown.",
  ].join(" "),
};

export const DRAFT_SYSTEM = PROMPT;
const HEADER: Record<Exclude<DraftKind, "plan">, string> = { org: "Name\tRole\tReports to", flow: "From\tTo\tLabel" };

/** The model's reply made safe for the editors: fences and chatter removed, lines checked and limited. */
export function cleanDraft(kind: DraftKind, reply: string): string {
  let t = String(reply).replace(/\r\n?/g, "\n");
  const fence = /```[a-z]*\n([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1];
  const lines = t.split("\n").map((l) => l.replace(/\*\*|__|`/g, "").replace(/\s+$/, "")).filter((l) => l.trim());
  const out: string[] = [];
  if (kind === "plan") {
    for (const l of lines) {
      if (/^(here is|here's|sure|this plan|note:|outline:)/i.test(l.trim()) || /:$/.test(l.trim()) && !/^\s/.test(l) && out.length === 0 && /plan|outline/i.test(l)) continue;
      out.push(l.replace(/^(\s*)#+\s*/, "$1").replace(/^(\s*)\d+[.)]\s+/, "$1").replace(/^(\s*)[-*•]\s+/, "$1").slice(0, 200));
    }
  } else {
    for (const raw of lines) {
      if (/^\s*\|?\s*:?-{3,}/.test(raw)) continue; // a markdown table rule
      let l = raw.trim();
      if (l.includes("|") && !l.includes("\t")) l = l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("\t"); // markdown table row
      else if (!l.includes("\t") && l.includes(",")) l = l.split(",").map((c) => c.trim()).join("\t");
      if (!l.includes("\t")) continue; // prose
      out.push(l.split("\t").slice(0, 3).map((c) => c.slice(0, 120)).join("\t"));
    }
    const head = out[0]?.toLowerCase() || "";
    const hasHeader = kind === "org" ? /reports to|manager/.test(head) : /^from\t/.test(head);
    if (!hasHeader) out.unshift(HEADER[kind]);
    else out[0] = HEADER[kind];
  }
  const max = kind === "plan" ? 200 : 201;
  if (out.length > max) out.length = max;
  if (out.length < (kind === "plan" ? 2 : 3)) throw new ApiError("internal", "The model did not write a usable draft; try describing it in more detail");
  return out.join("\n") + "\n";
}

/** The messages for one draft request. */
export function draftMessages(kind: DraftKind, prompt: string, langName?: string) {
  const sys = PROMPT[kind] + (langName ? ` Write the names in ${langName}.` : "");
  return [{ role: "system" as const, content: sys }, { role: "user" as const, content: prompt.slice(0, 4000) }];
}
