# Research scripts (warpdom experiments)

Corpus-level experiments comparing warpdom with jsdom (and happy-dom) on
the projects in `corpus/corpus.json`, built on `scripts/trace-corpus.mjs`.
Results and their interpretation are in warpdom's `docs/research/`.

Run from anywhere; the shell scripts `cd` to this repository. Settings
(environment variables, see `lib.sh`): `REPOS_DIR` (checkouts, default
`~/Projects`), `WARPDOM_DIR` (default `../warpdom`), `NODE_VERSION` for
`nvm exec` (default 22.23.3), `ENV_DIR` (harness output, default
`.corpus-env`), `WORK_DIR` (scratch state). Every survey and timing run
writes its environment (commits of all corpus checkouts, warpdom and this
repo; Node; OS; CPU; memory; load) with `record-env.mjs`.

Corpus runs are heavy: one at a time, 2 workers, on an otherwise idle
machine.

## Held-out set

`corpus/held-out.json` lists projects warpdom was never tuned on (its
compatibility work was driven by `corpus/corpus.json`, so parity there
overstates parity on unseen suites). Keep it separate: do not fix warpdom
against these projects, or they stop being held out. Every script here
takes the corpus file from `CORPUS` (default `corpus/corpus.json`):

    CORPUS=corpus/held-out.json ENV_DIR=.corpus-env/heldout scripts/research/survey-warpdom.sh naive-ui
    ENV_DIR=.corpus-env/heldout node scripts/research/diffgroups.cjs naive-ui

Its pins are in `corpus/held-out-pins.json` (`write-pins.mjs --corpus
corpus/held-out.json`; `checkout-pinned.mjs --corpus ...` reads them), and
the timing workflow has a `corpus` input to time them on GitHub Actions.

| Script | What it does |
| --- | --- |
| `survey-warpdom.sh <project...>` | Runs each project on warpdom (isolated) and counts tests whose status differs from the jsdom baseline |
| `diffgroups.cjs <project>` | Groups one project's differences from the last survey by error message |
| `timing-vitest.sh <csv> <rounds> <project...>` | Vitest timing rounds: jsdom/warpdom alternating, default pool and vmThreads |
| `timing-jest.sh <csv> <rounds> <project...>` | Jest timing rounds: jsdom/warpdom alternating |
| `timing-report.cjs <csv> [--packages <csv>]` | Medians and speedups of a timing CSV as a Markdown table; the A/A controls' paired ratios; per package times (jsdom/warpdom, warm-up and timed) |
| `configs.sh` | Configuration names of `timing-rounds.sh` (`parse_config`), WARPDOM_ABLATE per configuration (`with_ablate`), per-package times from harness output (`package_times`); `test-configs.cjs` checks it |
| `ablation-isolation.sh <csv> <rounds> <project...>` | Strong baselines and the ablation of learned isolation (Vitest): jsdom default/shared/vmThreads, warpdom default/vmThreads/shared-fresh/shared-reset/learned, happy-dom shared; warm-up, rotated order, re-learning every round, G2 counts, per-test archive |
| `learned.sh <csv> <rounds> <project...>` | `ablation-isolation.sh` with jsdom-default, warpdom-default and warpdom-learned (the shipped `warpdom vitest run` where Vitest >= 3.2, else its emulation) |
| `ablation-report.cjs <csv> [--learning <jsonl>] [--pertest <dir>]` | Ablation summary: speedups with intervals, differing tests/files, false passes, the best correct jsdom configuration, learning stability and break-even |
| `statuses.cjs` | Per-test status maps and counting (one key definition for every script; tests and files counted separately); `test-statuses.cjs` is its check (in `npm test`) |
| `learning.cjs` | Learning and learned-run records (JSON lines) for `ablation-isolation.sh` |
| `capture-reporter.mjs` | Vitest reporter that records every Vitest run `warpdom vitest run` starts (`trace-corpus.mjs --fast-cli`) |
| `fastmode.sh <csv> <rounds> <project...>` | Fast mode with a plain safety net (superseded by learned.sh) |
| `headtohead.sh <csv> [rounds]` | jsdom, happy-dom, warpdom x isolated, no-isolate, fast (uses `fresh/`) |
| `prof-top-dom.cjs <dir>` | Top warpdom functions in a run's CPU profiles (`trace-corpus.mjs --profile`) |
| `prof-top.cjs <dir>` | Top functions in one CPU profile |
| `record-env.mjs --out <file>` | Environment record (also called by the scripts above) |
| `css-parity/*.mjs` | warpdom's CSS behavior against jsdom versions (black box): value validation, shorthands, zero lengths |

Typical order: jsdom baselines come with the first survey; then
`survey-warpdom.sh` (correctness), `diffgroups.cjs` for any differences,
`timing-*.sh` + `timing-report.cjs` (speed), `trace-corpus.mjs --profile`
+ `scripts/profile-share.mjs` + `prof-top-dom.cjs` (where time goes).

## Timing on GitHub Actions

`.github/workflows/timing.yml` (run it by hand: Actions, "timing", "Run
workflow") times each corpus project in its own job on a GitHub-hosted
Linux runner, at the commit pinned in `corpus/pins.json`, with jsdom and
warpdom alternating in the default pool (2 workers), after one untimed
warm-up run per configuration, 5 rounds by default with the configuration
order rotated each round. Every run's per-test statuses are uploaded
(`pertest/<round>/<project>/<config>.json`). The `mode` input selects
`timing-rounds.sh`, `learned.sh` (fastmode) or `ablation-isolation.sh`.
A final job combines the per-project CSVs and puts the table
(`timing-report.cjs`) on the run's summary page and in the `timing-report`
artifact, with each runner's environment JSON.

- `corpus/pins.json` comes from `node scripts/research/write-pins.mjs`
  (`--corpus corpus/held-out.json` writes `corpus/held-out-pins.json`)
  (the commits of the local checkouts the published numbers were measured
  on); re-run it when the corpus checkouts move.
- `checkout-pinned.mjs` clones a project at its pinned commit where the
  harness looks for it.
- The workflow reads the private warpdom repository with a read-only deploy
  key: the public half is a deploy key of sonukapoor/warpdom, the private
  half the repository secret `WARPDOM_DEPLOY_KEY` (set up 2026-10-12).
- Hosted runners are shared virtual machines: absolute times vary more than
  on a quiet dedicated machine. jsdom and warpdom alternate on the same
  runner, so the ratio per project is the number to compare.

Monorepos run one package at a time; `timing-rounds.sh` records each
package's runner time per round and configuration in
`<csv>.packages.csv`, and the report job adds a per-package table
(handsontable's packages, for example).

A/A controls (mode timing, `configs` input): `warpdom-default-aa` is
`warpdom-default` under a second name, so the paired ratio of two
identical configurations shows the noise floor; `warpdom-ablate-unset` is
`warpdom-default` with `WARPDOM_ABLATE` set to the empty string (every
other configuration runs with it unset), for the switch's cost when no
ablation is chosen. The report has a table of both paired ratios.

By default each round runs jsdom, warpdom and happy-dom (`configs`
input), so the report also has a three-way table: the speed of each DOM
and how many tests differ from jsdom on warpdom and on happy-dom, with
medians over the suites whose jsdom rounds are valid. A jsdom round that
differs from the jsdom baseline means the run was broken (for example a
package that did not run); the report flags it and leaves the suite out
of the medians.
