/*
 * WorkSuite Project: task types and effort-driven scheduling (roadmap stage 5). Pure ES module, no DOM.
 *
 * Work (person-hours) = duration (working days) × units (the people's shares, 1 = one person full time) × 8.
 * When one of the three changes, the task's type says which other one gives way, as in professional planners:
 *
 *   changed →      duration                work                     people (units)
 *   fixedUnits     work follows            duration follows         effort driven: duration follows; else work
 *   fixedWork      units follow            duration follows         duration follows (always effort driven)
 *   fixedDuration  work follows            units follow             work follows
 *
 * Work is tracked only while someone is assigned (a task with no people has no work). Durations stay whole
 * working days, rounded up; units are rounded to whole percent.
 */
import { assignmentsOf, ownerText } from "./resources.js";

export const HOURS_PER_DAY = 8;
export const TASK_TYPES = ["fixedUnits", "fixedWork", "fixedDuration"];
export const TYPE_NAMES = { fixedUnits: "Fixed units", fixedWork: "Fixed work", fixedDuration: "Fixed duration" };

/** The people's combined share: 1 = one person full time. */
export const unitsOf = (t) => assignmentsOf(t).reduce((s, a) => s + a.units, 0);

/** A task's work in hours: as stored, else from its duration and people. */
export function workOf(t) {
  if (t.work !== undefined) return t.work;
  return t.duration * unitsOf(t) * HOURS_PER_DAY;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Scales every person's share so the total is `total` (whole percent, at least 1% each). */
function setUnits(t, total) {
  const list = assignmentsOf(t);
  const now = list.reduce((s, a) => s + a.units, 0);
  if (!list.length || !(now > 0) || !(total > 0)) return;
  const f = total / now;
  t.owner = ownerText(list.map((a) => ({ name: a.name, units: Math.max(0.01, Math.round(a.units * f * 100) / 100) })));
}

/**
 * Recalculates `after` (the task with the edit applied) from `before`, for what changed: "duration", "work" or
 * "units". Changes `after` in place and returns it. Milestones keep no work.
 */
export function recalc(before, after, changed) {
  const type = TASK_TYPES.includes(after.type) ? after.type : "fixedUnits";
  const U = unitsOf(after);
  if (after.duration === 0 || !(U > 0)) {
    // no people, or a milestone: nothing to keep in balance, and no work to keep
    if (changed !== "work") delete after.work;
    return after;
  }
  const H = HOURS_PER_DAY;
  const days = (w, u) => Math.max(1, Math.ceil(round2(w / (u * H))));
  if (changed === "duration") {
    if (type === "fixedWork" && unitsOf(before) > 0 && before.duration > 0) {
      const W = workOf(before); // stored, or as it stood before this change
      setUnits(after, W / (after.duration * H));
      after.work = round2(W);
    }
    else after.work = round2(after.duration * U * H);
  } else if (changed === "work") {
    if (type === "fixedDuration") setUnits(after, after.work / (after.duration * H));
    else after.duration = days(after.work, U);
  } else if (changed === "units") {
    const hadPeople = unitsOf(before) > 0;
    const W = hadPeople ? workOf(before) : null;
    if (W !== null && (type === "fixedWork" || (type === "fixedUnits" && after.effortDriven))) {
      after.duration = days(W, U);
      after.work = round2(W);
    } else after.work = round2(after.duration * U * H);
  } else if (after.work === undefined) after.work = round2(after.duration * U * H);
  return after;
}
