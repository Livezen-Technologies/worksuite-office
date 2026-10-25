// The Smart Typing engine as the plugin builds it: the bundled data (sha256-checked) and SCOWL.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import S from "../../core/dist/src/index.js";
import { buildWordList } from "../../scripts/wordlist.mjs";
import { buildSmartData } from "../../scripts/smartdata.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const data = {
  ...buildSmartData(),
  englishWords: readFileSync(join(root, "wordlist", "english", "scowl-20.txt"), "utf8").split("\n").filter(Boolean),
  sinhalaWords: buildWordList()
};
export function engine(settings = {}, personal, learner) {
  const e = new S.SmartEngine(data, personal || new S.Personal(), learner || new S.Learner());
  e.configure(settings);
  return e;
}
export const shared = engine();
export const texts = (r) => r.items.map((i) => i.text);
