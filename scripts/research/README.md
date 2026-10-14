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
| `timing-report.cjs <csv> [--packages <csv>] [--pertest <dir>]` | Medians and speedups of a timing CSV as a Markdown table; the A/A controls' paired ratios; per package times (jsdom/warpdom, warm-up and timed). Differences are counted against the same round's jsdom-default run; with `--pertest`, raw and without the flaky tests (status changes between the suite's jsdom-default runs, `statuses.cjs jsdomRounds`; `timing-rounds.sh` records them in `<csv>.flaky.json`). A broken jsdom round (no time, or far from the other jsdom runs) leaves out that round only |
| `configs.sh` | Configuration names of `timing-rounds.sh` (`parse_config`), WARPDOM_ABLATE per configuration (`with_ablate`), per-package times from harness output (`package_times`); `test-configs.cjs` checks it |
| `versions.sh <out> <project...>` | Version dependence without warpdom: jsdom only, the project's own jsdom twice (flaky tests), then jsdom 20.0.3, 26.1.0, 30.1.2 (svelte also cssstyle 4.1.0, 4.6.0) forced through overrides; checkout restored afterwards |
| `versions.cjs` | Helpers of `versions.sh`: install commands without a frozen lockfile, overrides per package manager, the jsdom each runner resolves |
| `versions-report.cjs <out>` | Per suite and version: tests and files differing from the own jsdom (flaky left out), NA reasons, whether the version was forced, differing tests grouped by first error line; `test-versions.cjs` checks both |
| `ablation-isolation.sh <csv> <rounds> <project...>` | Strong baselines and the ablation of learned isolation (Vitest): jsdom default/shared/vmThreads/shared with cleanup (`jsdom-sharedclean`)/learned isolation's policy without reset (`jsdom-learned`), warpdom default/vmThreads/shared-fresh/shared-reset/learned, happy-dom shared; warm-up, rotated order, re-learning every round, G2 counts, per-test archive |
| `learned.sh <csv> <rounds> <project...>` | `ablation-isolation.sh` with jsdom-default, warpdom-default and warpdom-learned (the shipped `warpdom vitest run` where Vitest >= 3.2, else its emulation) |
| `ablation-report.cjs <csv> [--learning <jsonl>] [--pertest <dir>]` | Ablation summary: speedups with intervals, differing tests/files, false passes, the best correct jsdom configuration (of jsdom default/shared/vm/sharedclean), learning stability and break-even |
| `shared-cleanup.mjs` | The generic cleanup between test files of `jsdom-sharedclean` (no isolation): Testing Library's cleanup, Vitest's timers, mocks, stubbed globals and env, body, storage, title, cookies, URL; each step and its source in the file. The harness copies it next to the project's config (`trace-corpus.mjs --project-setup`) |
| `statuses.cjs` | Per-test status maps and counting (one key definition for every script; tests and files counted separately); `test-statuses.cjs` is its check (in `npm test`) |
| `learned-emulation.sh` | Learned isolation's emulation (decision rule, learning, learned runs; warpdom's fast mode, state version 2), sourced by `ablation-isolation.sh`; `LEARN_ENV` / `LEARN_FIRST` for another DOM (`jsdom-learned`); missing results count as failures; `test-learned.cjs` checks the rule |
| `g2-shuffle.sh <out dir> <project...>` | Assumption G2 (leaking state can only make a test fail) under shuffled file orders: warpdom isolated references (`ISO_RUNS`, default 3), and per seed (`SEEDS`, default 1-10) warpdom-sharedreset and warpdom's fast mode (from one learning in Vitest's own order, a fresh state copy per seed) with `--sequence.shuffle.files --sequence.seed=<s>`; the candidates' files isolated again (`CONFIRM_RUNS`, default 3); every run's per-worker file order (`order-setup.mjs`). Workflow mode `g2-shuffle` (rounds = seeds) |
| `g2-report.cjs <out dir>` | g2-shuffle.sh's report: per suite the seeds, tests, distinct orders, candidate G2 violations (pass shuffled, never pass in a reference), classified leak-induced / nondeterministic / unconfirmed, and the file order before each; `test-g2.cjs` checks it |
| `order-setup.mjs` | Vitest setup file: one JSON line per test file (worker, isolate, position in the worker) to `FILE_ORDER_OUT`; `--first-setup` is repeatable |
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
  harness looks for it; with `--unpinned` (the workflow's `unpinned`
  input) at the head of its default branch instead, to measure today's
  code. The environment JSON records each project's commit, its pin and
  `atPin`.
- The workflow checks warpdom out from its public repository at the
  `warpdom_ref` input. Until 2026-10-14 warpdom was private and the
  workflow read it with a read-only deploy key; runs before that date name
  warpdom commits by their pre-publication hashes, which warpdom's
  `docs/research/data/COMMIT-MAP.md` maps to the published history.
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

Mode `versions` runs `versions.sh` per project (one job each) and the
report job `versions-report.cjs` (`versions.csv`, `versions-groups.json`
in the `timing-report` artifact; the archived per-test maps with failure
messages are in each project's artifact under `versions/`).

`corpus/apps.json` (corpus input `apps.json`, pins in
`corpus/apps-pins.json`) holds web application suites, pinned before
measuring, with the reasons for choosing them.

By default each round runs jsdom, warpdom and happy-dom (`configs`
input), so the report also has a three-way table: the speed of each DOM
and how many tests differ from jsdom on warpdom and on happy-dom, with
medians over the suites with valid jsdom rounds. A jsdom round without a
time, or whose tests differ from the suite's other jsdom runs in more
than 5 tests (median), means the run was broken (for example a package
that did not run); the report flags it and leaves out that round.
