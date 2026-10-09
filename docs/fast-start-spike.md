# Spike: how fast can a test DOM start?

*2026-10-09. Code: `spikes/fast-start/`. Node 22.17.1, Vitest 5.0.3,
jsdom 30.1.2, happy-dom 20.14.5, one laptop, two workers.*

## Why

Environment setup is a median 29% of test time in the corpus
(`docs/setup-cost.md`). Vitest gives every test file a fresh window so
nothing leaks between files: the document, globals, listeners, timers,
storage, and patches to the DOM classes themselves (tests mock prototypes,
e.g. `jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get')`). The spike
asks how cheap that fresh window can be while keeping the guarantee.

## Findings

**1. The cost is loading the DOM library, not creating windows.**

| | Load in a fresh process | First window | Later windows |
| --- | --- | --- | --- |
| jsdom | 176 ms | 23 ms | 1.3 ms |
| happy-dom | 81-97 ms | 2 ms | 0.3 ms |
| prototype | 11 ms | 2.6 ms | 2.2 ms |

With isolation, each test file starts in a fresh worker or context and pays
the load again. Node's compile cache helps only about 20% (jsdom 176 -> 141
ms), so there is no cheap fix that removes it.

**2. A jsdom-shaped DOM can load an order of magnitude faster.** The
prototype has all 219 jsdom interfaces and 3,710 members (845 KB of code;
core behaviour real, the rest generated stand-ins of realistic size). Its
implementation is defined once per module load; each window gets its own
prototype objects and constructors. Checks passed: a prototype patch in one
window does not affect another, `instanceof` is per window, and tree,
attribute, text, selector and event behaviour work.

**3. In Vitest, on 100 trivial test files:**

| Environment | Wall time | Cost of the DOM (above the 3.1 s no-DOM floor) |
| --- | --- | --- |
| jsdom | 15.2 s | 12.1 s |
| happy-dom | 8.5 s | 5.4 s |
| prototype | 3.9 s | 0.8 s |

The prototype removes 93% of jsdom's cost and 85% of happy-dom's here.

## What it means

- A fast-start, jsdom-shaped DOM can make the per-file environment almost
  free. On setup-heavy suites (MUI's packages spend 39-74% of their time on
  environment setup) that alone could mean 1.5-3x; on suites where the tests
  themselves dominate (Ariakit, Svelte) much less.
- The design that achieved it: one bundle with little top-level work, the
  implementation built once, a thin per-window layer of prototypes for
  isolation, and nothing loaded that tests do not use.

## Limits

- The prototype implements only core behaviour; most members are stand-ins.
  A real implementation of the ~800 used members, with spec behaviour and
  HTML parsing (parse5 loads in 8 ms), will load slower than 11 ms; the
  budget to stay well ahead of happy-dom is roughly 30-40 ms.
- Per-window setup copies every member (2.2 ms per window, slower than
  happy-dom's 0.3 ms); making the per-window layer lazy would cut it.
- Trivial tests exaggerate the share of environment setup; real suites
  spend more time running tests, where the earlier experiment measured
  happy-dom's DOM at a median 9% of CPU.
- Compatibility, the main risk of the product, is not tested here.
