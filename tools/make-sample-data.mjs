// Generates realistic SAMPLE data for the results page so the UI can be built
// and reviewed before the real runner exists. Output: site/data/runs.js
// (a plain script that sets window.SLACKOMETER_DATA, so the page also works
// when opened straight from disk, with no server and no fetch()).
//
//   node tools/make-sample-data.mjs
//
// Everything here is fake. The real runner will write the same shape.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- deterministic random ---------------------------------------------------
let seed = 20261103;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const jitter = (x, pct) => Math.max(0, x * (1 + gauss() * pct));
const chance = (p) => rand() < p;
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

// ---- catalogue --------------------------------------------------------------
const benches = [
  { id: "core", name: "Core", owner: "anon", description: "Generic everyday dev work across languages, plus UI/UX." },
  { id: "ops-powershell", name: "PowerShell ops", owner: "anon", description: "Deployment and admin scripting tasks." },
];

const tasks = [
  // core
  ["ts-date-bug", "core", "Fix an off-by-one in a date range filter", "TypeScript", "bug fix", "easy"],
  ["ts-paging-api", "core", "Add cursor paging to a REST endpoint", "TypeScript", "feature", "medium"],
  ["ts-cache-race", "core", "Find a race in a request cache", "TypeScript", "debug", "hard"],
  ["cs-csv-import", "core", "Harden a CSV importer against bad rows", "C#", "bug fix", "medium"],
  ["cs-refactor-service", "core", "Split a 600-line service without changing behaviour", "C#", "refactor", "hard"],
  ["cs-legacy-port", "core", "Port a VBScript routine to C#", "C#", "legacy port", "medium"],
  ["py-parser-tests", "core", "Write tests for an untested parser", "Python", "tests", "easy"],
  ["py-etl-dupes", "core", "Debug duplicate rows from a vague report", "Python", "debug", "medium"],
  ["py-explain-repo", "core", "Answer questions about a messy codebase", "Python", "explain", "medium"],
  ["ps-log-rotate", "core", "Fix a log rotation script that deletes too much", "PowerShell", "bug fix", "easy"],
  ["sql-slow-report", "core", "Speed up a slow reporting query", "SQL", "performance", "hard"],
  ["sql-migration", "core", "Write a safe column migration", "SQL", "feature", "medium"],
  ["ui-settings-screen", "core", "Build a settings screen from a brief", "UI", "ui design", "medium"],
  ["ui-ugly-form", "core", "Improve an ugly signup form", "UI", "ui design", "easy"],
  ["ui-mobile-table", "core", "Make a data table work on mobile", "UI", "ui design", "hard"],
  ["ts-feature-flag", "core", "Add a feature flag with a kill switch", "TypeScript", "feature", "easy"],
  // ops-powershell
  ["ps-pdq-package", "ops-powershell", "Write a silent-install deploy script", "PowerShell", "feature", "medium"],
  ["ps-registry-audit", "ops-powershell", "Audit and report registry drift", "PowerShell", "feature", "medium"],
  ["ps-service-watch", "ops-powershell", "Restart a hung service safely", "PowerShell", "bug fix", "easy"],
  ["ps-share-perms", "ops-powershell", "Fix share permissions without lockout", "PowerShell", "bug fix", "hard"],
  ["ps-event-digest", "ops-powershell", "Summarise event logs into a digest", "PowerShell", "feature", "easy"],
].map(([id, bench, title, language, kind, difficulty]) => ({
  id, bench, title, language, kind, difficulty, version: 1,
  ui: kind === "ui design", added_by: bench === "core" ? "anon" : "anon",
}));

const contenders = [
  { id: "claude-code/claude-opus-5", tool: "claude-code", model: "claude-opus-5", label: "Opus 5", efforts: ["medium", "high", "xhigh"], retired: true },
  { id: "claude-code/claude-opus-5-5", tool: "claude-code", model: "claude-opus-5-5", label: "Opus 5.5", efforts: ["medium", "high", "xhigh"], retired: false },
];

const machines = [
  { id: "rig-1", person: "anon", os: "windows" },
  { id: "alex-macbook", person: "alex", os: "macos" },
];

// Locked suites (what calibration picked to fit the budget).
const suites = [
  { contender: "claude-code/claude-opus-5", machine: "rig-1", version: 1, calibrated_at: "2026-07-05",
    tasks: ["ts-date-bug", "ts-paging-api", "cs-csv-import", "cs-legacy-port", "py-parser-tests", "py-etl-dupes", "ps-log-rotate", "sql-migration", "ui-ugly-form", "ui-settings-screen"] },
  { contender: "claude-code/claude-opus-5-5", machine: "rig-1", version: 2, calibrated_at: "2026-09-01",
    tasks: ["ts-date-bug", "ts-paging-api", "ts-cache-race", "cs-csv-import", "cs-legacy-port", "py-parser-tests", "py-etl-dupes", "py-explain-repo", "ps-log-rotate", "sql-slow-report", "sql-migration", "ui-ugly-form", "ui-settings-screen", "ps-pdq-package", "ps-service-watch", "ps-event-digest"] },
  { contender: "claude-code/claude-opus-5-5", machine: "alex-macbook", version: 1, calibrated_at: "2026-10-04",
    tasks: ["ts-date-bug", "ts-paging-api", "ts-feature-flag", "cs-csv-import", "py-parser-tests", "py-etl-dupes", "sql-migration", "ui-ugly-form", "ui-mobile-table", "ts-cache-race"] },
];

// ---- calendar ----------------------------------------------------------------
const days = [];
for (let d = new Date("2026-07-06T00:00:00Z"); d <= new Date("2026-11-02T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
  const dow = d.getUTCDay();
  if (dow === 1 || dow === 3) days.push(d.toISOString().slice(0, 10));
}

const ccVersionFor = (date) => date < "2026-08-12" ? "2.1.204" : date < "2026-09-23" ? "2.1.251" : date < "2026-10-26" ? "2.1.288" : "2.1.316";

const events = [
  { date: "2026-08-12", type: "cc_version", label: "Claude Code 2.1.251" },
  { date: "2026-09-01", type: "model", label: "Opus 5.5 calibrated" },
  { date: "2026-09-23", type: "cc_version", label: "Claude Code 2.1.288" },
  { date: "2026-10-26", type: "cc_version", label: "Claude Code 2.1.316" },
];

// ---- behaviour model ---------------------------------------------------------
const diffMult = { easy: 0.6, medium: 1, hard: 1.7 };
const passBase = { easy: 0.9, medium: 0.74, hard: 0.52 };
const lvl = {
  medium: { pass: -0.1, out: 9000, tools: 12, files: 3.2, runTests: 0.72, verify: 0.5, min: 2.6, judge: 3.3 },
  high:   { pass: 0,    out: 16000, tools: 20, files: 5.1, runTests: 0.93, verify: 0.8, min: 4.1, judge: 3.8 },
  xhigh:  { pass: 0.06, out: 27000, tools: 31, files: 7.6, runTests: 0.97, verify: 0.9, min: 6.8, judge: 4.1 },
};
const modelAdj = { "claude-code/claude-opus-5": { pass: -0.06, out: 1.12 }, "claude-code/claude-opus-5-5": { pass: 0, out: 1 } };

// The story the sample tells: from 2026-10-26 (Claude Code 2.1.316) "high"
// quietly starts slacking: fewer tokens, skips tests, claims done more often.
const slack = (date, contender, effort, machine) => {
  if (contender !== "claude-code/claude-opus-5-5" || date < "2026-10-26") return null;
  if (effort === "high") return machine === "rig-1" ? { out: 0.6, tools: 0.65, runTests: 0.42, verify: 0.3, pass: -0.13 } : { out: 0.68, tools: 0.72, runTests: 0.5, verify: 0.4, pass: -0.1 };
  if (effort === "xhigh") return { out: 0.93, tools: 0.95, runTests: 0.95, verify: 0.9, pass: -0.02 };
  return null;
};

const runs = [];
const runDays = [];
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

for (const date of days) {
  for (const machine of machines) {
    const contender = date < "2026-09-01" ? "claude-code/claude-opus-5" : "claude-code/claude-opus-5-5";
    const suite = suites.find((s) => s.contender === contender && s.machine === machine.id);
    if (!suite || date < suite.calibrated_at) continue;
    const c = contenders.find((x) => x.id === contender);

    // one incomplete day for realism (PC was off overnight)
    const incomplete = machine.id === "rig-1" && date === "2026-10-14";
    let dayCost = 0;

    for (const effort of c.efforts) {
      for (const taskId of suite.tasks) {
        const t = tasks.find((x) => x.id === taskId);
        const L = lvl[effort], M = modelAdj[contender], s = slack(date, contender, effort, machine.id) || {};
        const dm = diffMult[t.difficulty];
        const pPass = Math.min(0.98, Math.max(0.05, passBase[t.difficulty] + L.pass + M.pass + (s.pass || 0)));
        const pass = chance(pPass);
        const testsTotal = t.ui ? 0 : 6 + Math.floor(dm * 4);
        const testsPassed = t.ui ? 0 : pass ? testsTotal : Math.floor(testsTotal * (0.35 + rand() * 0.5));
        const outTok = Math.round(jitter(L.out * dm * M.out * (s.out || 1), 0.18));
        const inTok = Math.round(jitter(14000 + outTok * 0.6, 0.2));
        const cacheRead = Math.round(jitter(outTok * 7, 0.25));
        const cacheWrite = Math.round(jitter(outTok * 1.2, 0.25));
        const cost = r2(inTok * 5e-6 + cacheRead * 0.5e-6 + cacheWrite * 6.25e-6 + outTok * 25e-6);
        const ranTests = t.ui ? chance(0.9 * (s.runTests || 1)) : chance(L.runTests * (s.runTests || 1));
        const verified = ranTests && chance(L.verify * (s.verify || 1));
        const claimed = pass ? chance(0.97) : chance(effort === "medium" ? 0.55 : 0.35 + (s.pass ? 0.45 : 0));
        if (incomplete && effort === "xhigh" && runs.length % 3 === 0) continue; // never finished
        dayCost += cost;
        runs.push({
          date, machine: machine.id, contender, effort, task: t.id, bench: t.bench, task_version: t.version,
          suite_version: suite.version, cc_version: ccVersionFor(date),
          end: "finished", pass, score: t.ui ? r1(Math.min(5, Math.max(1, (pass ? L.judge + 0.4 : L.judge - 0.9) + gauss() * 0.4))) : r2(testsTotal ? testsPassed / testsTotal : 0),
          tests_passed: testsPassed, tests_total: testsTotal,
          ui_checks: t.ui ? { builds: true, renders: pass || chance(0.7), console_errors: pass ? 0 : Math.floor(rand() * 3), states_present: pass ? 3 : Math.floor(rand() * 3) } : null,
          output_tokens: outTok, input_tokens: inTok, cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite,
          cost_usd: cost, tool_calls: Math.round(jitter(L.tools * dm * (s.tools || 1), 0.2)),
          files_read: Math.max(1, Math.round(jitter(L.files * dm * (s.tools || 1), 0.25))),
          ran_tests: ranTests, verified_after_last_edit: verified,
          minutes: r1(jitter(L.min * dm * (s.out ? 0.75 : 1), 0.2)),
          claimed_done: claimed,
          claim_text: claimed ? pick(["All tests pass and the fix is complete.", "Done: implemented and verified.", "Fixed. Everything builds cleanly.", "Complete. Tests are green."]) : pick(["Partially done; edge cases may remain.", "I couldn't verify the build, please check.", "Implemented the main path; tests not run."]),
          digest: pass ? "Read the relevant modules, made a focused change, ran the tests, and re-ran them after the last edit." : ranTests ? "Made a change and ran the tests once; missed an edge case the hidden tests check." : "Edited the obvious spot and stopped without running anything.",
        });
      }
    }
    // rate: 1% of weekly ≈ $18.50 of API-equivalent cost on this account
    runDays.push({
      date, machine: machine.id, contender, suite_version: suite.version, cc_version: ccVersionFor(date),
      status: incomplete ? "incomplete" : "complete", incomplete_reason: incomplete ? "PC was off overnight; suite not finished by 23:59" : null,
      cost_usd: r2(dayCost), usage_pct_of_weekly: r2(dayCost / 18.5), budget_pct: 2, ceiling_pct: 3,
    });
  }
}

// Compact "columnar" form for the page: one header row + value rows, with
// repeated strings interned. The page expands it back into objects on load.
// (Per-run JSON files in results/ stay verbose; only the page index is compact.)
const strings = [];
const intern = (s) => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
const cols = Object.keys(runs[0]);
const internCols = new Set(["date", "machine", "contender", "effort", "task", "bench", "cc_version", "end", "claim_text", "digest"]);
const rows = runs.map((r) => cols.map((c) => {
  const v = r[c];
  if (internCols.has(c)) return intern(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v && typeof v === "object") return [v.builds ? 1 : 0, v.renders ? 1 : 0, v.console_errors, v.states_present];
  return v;
}));

const data = {
  sample: true,
  generated_at: "2026-11-03T03:58:00Z",
  benches, tasks, contenders, machines, suites, events, run_days: runDays,
  runs_compact: { cols, intern: [...internCols], strings, rows },
  paused: null,
  usage_rate: { pct_per_usd: r2(1 / 18.5), source: "calibration 2026-09-01, refined over 18 clean run days" },
};

const out = join(root, "web", "public", "data", "runs.js");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, "// Generated by tools/make-sample-data.mjs. SAMPLE DATA, not real results.\nwindow.SLACKOMETER_DATA = " + JSON.stringify(data) + ";\n");
console.log(`wrote ${out}: ${runs.length} runs over ${runDays.length} machine-days`);
