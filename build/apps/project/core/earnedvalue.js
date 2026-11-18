/*
 * WorkSuite Project: earned value (roadmap stage 5). Pure ES module, no DOM.
 *
 * Measured at the status date against a baseline that holds costs (saved from 10.1.56 on):
 *   BAC  budget at completion   the task's baselined cost
 *   PV   planned value (BCWS)   BAC × the share of its baselined working days passed by the status date
 *   EV   earned value (BCWP)    BAC × % complete
 *   AC   actual cost (ACWP)     the task's current cost × % complete (WorkSuite does not record actual spend yet)
 *   SV = EV − PV, CV = EV − AC, SPI = EV / PV, CPI = EV / AC, EAC = BAC / CPI, VAC = BAC − EAC
 * An SPI or CPI under 1 is behind schedule or over budget. Summaries and inactive tasks are left out of the rows;
 * the totals add up the tasks.
 */
import { toDay } from "./project.js";
import { ownCost } from "./costs.js";

const money = (n) => Math.round(n * 100) / 100;
const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);

/** The share of a baselined task's working days passed by the end of the status date (0..1). */
function plannedShare(base, statusDate, isWork) {
  const s = toDay(base.start), f = toDay(base.finish), now = toDay(statusDate);
  if (now < s) return 0;
  if (now >= f) return 1;
  let done = 0, all = 0;
  for (let d = s; d <= f; d++) if (!isWork || isWork(d)) { all++; if (d <= now) done++; }
  return all ? done / all : 1;
}

function figures(bac, pv, ev, ac) {
  const cpi = ratio(ev, ac), eac = cpi ? money(bac / cpi) : money(bac);
  return { bac: money(bac), pv: money(pv), ev: money(ev), ac: money(ac), sv: money(ev - pv), cv: money(ev - ac), spi: ratio(ev, pv), cpi, eac, vac: money(bac - eac) };
}

/**
 * Earned value at the status date: { rows: [{ id, name, ...figures }], total: figures } or { error } when the
 * project has no status date, no baseline, or a baseline saved without costs.
 */
export function earnedValue(doc, { statusDate = doc.statusDate, baseline = "Baseline", isWork = null } = {}) {
  if (!statusDate) return { error: "Set a status date (Project › Status date) to measure earned value." };
  const b = (doc.baselines || []).find((x) => x.name === baseline);
  if (!b) return { error: "Save a baseline (Project › Set Baseline) to measure earned value against." };
  if (!Object.values(b.tasks).some((t) => t.cost !== undefined)) return { error: "This baseline was saved before costs were kept. Set the baseline again to include them." };
  const rows = [];
  let tb = 0, tp = 0, te = 0, ta = 0;
  doc.tasks.forEach((t, i) => {
    const summary = i + 1 < doc.tasks.length && doc.tasks[i + 1].level > t.level;
    const base = b.tasks[t.id];
    if (summary || t.inactive || !base || !(base.cost > 0)) return;
    const bac = base.cost, pv = bac * plannedShare(base, statusDate, isWork), ev = bac * (t.progress / 100), ac = ownCost(doc, t) * (t.progress / 100);
    rows.push({ id: t.id, name: t.name, ...figures(bac, pv, ev, ac) });
    tb += bac; tp += pv; te += ev; ta += ac;
  });
  return { rows, total: figures(tb, tp, te, ta), statusDate, baseline: b.name };
}

