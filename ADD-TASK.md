# Adding a task (or a whole bench)

Tasks live in the **private** `slackometer-tasks` repo. Add one by asking Claude: *"add a task to `<bench>` about X"* (or *"make me a bench for X"*). Claude follows the rules below, proves the task with `validate`, and opens a **PR on the private repo**. Nothing enters a bench without review. New tasks reach your daily suite only when you re-calibrate.

**Private benches:** a bench folder can also live only on your machine. List it in `local.json` › `private_benches`; its tasks never leave your machine, and `private_results` decides whether its results are pushed as metrics only or kept fully local.

**Anonymise:** shared tasks must not contain company code, product names, customer data or secrets. Rebuild the problem in neutral starter code.

---


A task is a small, frozen coding job that a model gets **without** seeing how it will be graded. It answers two questions: did it do the job, and did it bother to check its work? Write tasks like a teammate's real request. They should be realistic, not puzzles.

## Folder

```
benches/<bench>/tasks/<task-id>/
  task.json        metadata (below)
  prompt.md        exactly what the model is told
  workspace/       starter files: the ONLY thing the model sees (copied into an empty temp folder)
  grader/          hidden: tests + grade script. Copied to <run>/.grader/ only AFTER the model finishes
  grader/reference/  a correct solution laid out like workspace/ (copied over the workspace by `validate`; never shown to the model, never copied into .grader)
```

## task.json

```json
{
  "id": "ts-date-range",
  "title": "Fix an off-by-one in a date range filter",
  "language": "TypeScript",
  "kind": "bug fix",
  "difficulty": "easy",
  "version": 1,
  "ui": false,
  "time_limit_min": 15,
  "max_turns": 60,
  "required_tools": ["node"],
  "test_command_hints": ["node --test", "npm test"],
  "grade": "node .grader/grade.mjs",
  "added_by": "your-name"
}
```

- `kind` is one of: `bug fix`, `feature`, `refactor`, `tests`, `debug`, `explain`, `legacy port`, `performance`, `ui design`.
- `difficulty` is `easy`, `medium` or `hard`. `time_limit_min` is 15, or 25 for hard tasks.
- `required_tools` uses these names: `node`, `python`, `dotnet`, `powershell`.
- `test_command_hints` are **regexes** matched against the shell commands the model runs, to detect "did it run the tests". Include every plausible way to run this task's visible tests, for example `["python -m unittest", "unittest", "pytest", "run_tests\\.py"]`.
- `grade` is a shell command run with the run folder as the working directory. Two placeholders are available: `{python}` (expands to `python` or `python3`) and `{cli}` (the quoted path to `runner/cli.ts`). Avoid `&&`, `$VAR` and `%VAR%`. It must work in both `cmd.exe` and `sh`.

## The grader contract

The grade command must print, **as its last line of stdout**, exactly:

```json
{"passed": 7, "total": 9, "details": "short human-readable summary"}
```

- `total` is the number of hidden checks, at least 1. `passed` counts the ones that passed.
- **Never crash on a broken workspace.** If the model deleted a file, broke an import or left a syntax error, catch it, count those checks as failed, and still print the JSON line. If it does crash, the runner treats the task as failed with a reason, but don't rely on that.
- Hidden tests import or call the **workspace's** code from the run folder (`../` relative to `.grader/`, or by path).
- **No network** at grade time. No package installs. Graders must finish in under 3 minutes.

## What makes a good task

1. **A clear "done".** Hidden tests decide it, and partial credit is fine.
2. **Visible tests in the workspace** that the starter fails, or that guide the work, plus an obvious way to run them (a `README.md` line or a script). This is what makes "did it run the tests" measurable.
3. **Hidden tests include 2–4 edge cases** that a careful engineer would handle and a lazy one would miss: boundaries, empty input, time zones, rounding, concurrency, error paths. Don't mention them in the prompt. A good prompt makes them *discoverable*, through a careful reading of the code, the data, or the existing tests.
4. **Not trivially passable.** The untouched workspace must not pass all hidden checks.
5. **The reference passes everything.**
6. **Realistic size.** Around 50–400 lines of starter code, 2–8 minutes for a strong engineer at high effort.
7. **Self-contained and generic.** No company code, names, customer data or secrets. No network.
8. **Prompt tone:** a short teammate request (3–10 lines). Say what's wrong or wanted, not how to fix it. Never mention hidden tests, graders or this bench.

## Per-language conventions (no package managers at run time)

- **TypeScript:** plain `.ts` files run by Node 24 (type stripping, so erasable syntax only: no enums, no namespaces, no parameter properties; imports use `.ts` extensions). Visible tests use `node --test`. The grade script is `.grader/grade.mjs`. It runs `node --test --test-reporter=tap .grader/hidden.test.ts` (or several files) as a child process, parses `# pass N` / `# fail N` from the TAP output, and prints the JSON line. `required_tools: ["node"]`.
- **Python:** stdlib only, `unittest`. Visible tests in `tests/`. Grade with `{python} .grader/grade.py`, which loads `.grader/test_hidden.py` with `unittest`, counts results, and prints JSON. Put the workspace on `sys.path`. `required_tools: ["python"]`.
- **SQL:** SQLite through Python's `sqlite3`. The workspace has `schema.sql`, `seed.sql`, the query or migration file(s), and `run_tests.py`. The grader creates a fresh in-memory database. For performance tasks, check `EXPLAIN QUERY PLAN` (e.g. the query must use an index, not `SCAN`) **and** result correctness. `required_tools: ["python"]`.
- **C#:** .NET 10 SDK, `net10.0`, **no NuGet packages**. The workspace is a class library or console project, plus a visible test console project (`tests/`) that references it via `ProjectReference`, exits non-zero on failure, and runs with `dotnet run --project tests`. The hidden grader is a second console project in `.grader/HiddenTests/` with `<ProjectReference Include="../../<Proj>/<Proj>.csproj" />`, which prints the JSON line. Grade with `dotnet run --project .grader/HiddenTests`. Use `<Nullable>enable</Nullable>`, `<ImplicitUsings>enable</ImplicitUsings>`, and set `<NoWarn>` as needed so warnings don't matter. `required_tools: ["dotnet"]`.
- **PowerShell:** **Windows PowerShell 5.1 compatible** (no `??`, no ternary, no `&&`). Visible tests are a plain `tests/run-tests.ps1` that asserts with `throw`. Grade with `powershell -NoProfile -ExecutionPolicy Bypass -File .grader/grade.ps1`, which counts checks and writes the JSON line with `Write-Output (ConvertTo-Json -Compress @{passed=..; total=..; details=..})`. Tests should use temp folders and never touch real system state. `required_tools: ["powershell"]`.
- **UI:** a static `index.html` + `styles.css` + `app.js`, with no build step and no CDNs (offline). Set `"ui": true`, `"kind": "ui design"`, `"grade": "node {cli} ui-grade .grader/checks.json"`, `required_tools: ["node"]`. `.grader/checks.json` looks like:
  `{"page":"index.html","selectors":["main#settings","form button[type=submit]"],"states":["[data-state=empty]","[data-state=error]","[data-state=loading]"],"mobile":true,"brief":"<one-paragraph brief>","rubric":"rubric.md"}`.
  The hard checks are: the page renders, there are no console errors, every selector exists, every state element exists in the DOM (may be hidden), and the page fits a 390px phone. `.grader/rubric.md` holds 4–6 scoring points for the judge (layout and hierarchy, spacing, states, mobile, accessibility, fidelity to the brief). The prompt must ask for the required elements and states in plain words (e.g. "an empty state", "an error message area"). The starter should be weak or ugly but working.

## Prove it

From the public repo (with `local.json` pointing `tasks_dir` at this repo):

```
node runner/cli.ts validate <task-id>
```

The task must print `ok`: the untouched workspace doesn't pass everything, and the reference passes everything. UI validation skips the judge automatically.
