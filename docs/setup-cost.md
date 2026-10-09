# Where does a Vitest run spend its time? Per-file setup vs tests

*2026-10-09. Runs: `scripts/setup-cost.mjs` on 11 corpus projects (33 Vitest
packages), Node 22.23.3, two workers. Raw results:
`.corpus-env/setup-cost/results.json`.*

## Question

Vitest gives every test file a fresh environment and re-imports its modules.
How much of a run is that per-file setup, and what does skipping it
(`--no-isolate`, which shares one environment and module graph per worker)
gain and break?

## Results

Vitest's own breakdown, summed over all files (median over 33 packages):

| Phase | Share of time |
| --- | --- |
| Environment setup (creating the DOM window and globals) | 29% |
| Importing modules (React, the library, test utilities) | 15% |
| Running the tests | 24% |
| Transforms, setup files, prepare | the rest |

So about **half of the time goes to per-file setup**, more than to running
the tests themselves.

Skipping per-file setup with `--no-isolate`, packages taking over 8 seconds:

| Package | Faster without isolation | Tests |
| --- | --- | --- |
| MUI mui-utils / mui-system / mui-material | 7.3x / 6.0x / 3.7x | unchanged |
| Radix | 2.1x | unchanged |
| Vuetify | 5.5x | 23 fewer pass |
| emoji-picker-element | 2.1x | 60 fewer pass |
| Ariakit | 1.5x | 7 fewer pass |
| Svelte | 1.0x | unchanged |
| Element Plus | 1.0x | 108 fewer pass |
| CopilotKit react-core / vue / web-inspector | 0.8x / 1.2x / 1.7x | about half fewer pass |
| Ark UI react / vue / solid | 0.4x / 1.5x / 0.9x | 70-75% fewer pass |
| AG Grid behavioural | 0.7x, then crashed | no result |

(floating-ui is excluded: run this way, Vitest found no test files.)

## What it means

- **Per-file setup is the largest single cost**, larger than the DOM work
  done during tests. Removing it gives 2-7x on suites where that is safe.
- **Removing it by sharing state is unsafe for most suites.** Only 5 of the
  16 large packages kept every test passing; the rest lost tests, slowed
  down or crashed. Isolation exists for a reason.
- **The environment part (29%) is the DOM's own startup cost.** Creating a
  fresh jsdom or happy-dom window per file is DOM work, and it can be made
  cheap without sharing anything between files: every file still gets its
  own fresh window, it just costs little to make. That is a DOM product
  problem, not a test-runner problem.
- **The import part (15%) belongs to the test runner** (module graph
  re-evaluation); attacking it means working inside Vitest's internals, where
  Vitest itself is active (`isolate: false`, the `vmThreads` pool).
