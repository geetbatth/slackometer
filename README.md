# Slackometer

**Is the robot still trying?** Slackometer is a small, personal regression bench for coding models. Twice a week it runs a fixed, locked suite of realistic coding tasks through Claude Code at several effort levels. Each run is graded with hidden tests, and the bench records how hard the model tried: tokens, tool calls, files read, whether it ran the tests, whether it re-checked after its last edit, and whether it said "done" when it wasn't.

Each machine is compared with its own recent normal, so a quiet drop in effort (or a quiet improvement) stands out.

**Results site:** https://geetbatth.github.io/slackometer/

## How it's laid out

| Repo | Visibility | What's in it |
|---|---|---|
| `slackometer` (this one) | public | the runner (`runner/`), the results site (`web/` → `site/`), committed results (`results/`), setup docs |
| `slackometer-tasks` | **private** | the benches: task prompts, starter code, **hidden graders** and reference solutions |

The graders are private on purpose. Frozen tasks with public answers could end up in a future model's training data and be passed from memory. **Never paste task prompts, graders or reference solutions into issues, PRs or chats here.** Results only carry task titles and metadata.

## Using it

- **Set up a machine:** open this repo in Claude Code and say *"set this up"*. It follows [SETUP.md](SETUP.md).
- **First calibration** (one-off, overnight): [CALIBRATE.md](CALIBRATE.md).
- **Add a task or a whole bench:** [ADD-TASK.md](ADD-TASK.md).
- **Commands:** `node runner/cli.ts` lists them all. The schedule runs `node runner/cli.ts run`.

## How it stays polite to your subscription

- Each run day may use **2%** of your weekly Claude limit (hard ceiling **3%**). Two run days a week (Mon and Wed, 03:00) is about 4% of your week.
- The bench reads your real usage (the same numbers Claude Code's `/usage` shows) and **won't start a run at 90% or above**. If it can't read your usage, it doesn't run, so it can't spill into paid extra usage.
- Costs shown on the site are **API-equivalent** dollars, not money charged on a subscription.

## Development

```
node --test "runner/**/*.test.ts"     # runner tests (Node 24, no npm install needed)
cd web && npm install && npm run dev   # results site (React + Tailwind + shadcn/ui)
cd web && npx vite build               # builds the single-file site into ../site
node tools/serve.mjs                   # serve site/ locally
```

The robot art was made by the team for this project.
