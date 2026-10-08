# Is there a case for another test DOM? jsdom vs happy-dom on 9 real suites

*2026-10-08. Runs: `scripts/trace-corpus.mjs --environment <env> [--profile]`,
analysis: `scripts/env-compare.mjs`, `scripts/profile-share.mjs`. Node
22.23.3, two test workers, one laptop.*

## Question

Building a new test DOM is only worth it if (1) the DOM implementation is a
large share of test time, and (2) the fast option that already exists,
happy-dom, cannot simply replace jsdom. We measured both on the same suites.

## Method

Eleven corpus suites ran four times each: on jsdom and on happy-dom, once for
wall time and once with V8 CPU profiles of every test process. Projects on a
DOM were switched to the other one; a DOM package a project lacked was linked
in from this repository (jsdom 30.1.2, happy-dom 20.14.5; projects otherwise
used their own versions). CPU time was split by the code running; built-in
and Node-internal frames were charged to their nearest caller with a source
file, so array or map work done by jsdom counts as DOM.

Excluded: Nuxt UI (its generated Nuxt config was missing, every file failed
on both DOMs), Handsontable (its core suite hung on happy-dom), React
Spectrum's jsdom profile (Jest killed its workers before they wrote profiles;
its timings are kept).

## Results

| Suite | jsdom (s) | happy-dom (s) | jsdom ÷ happy-dom | DOM share of CPU, jsdom | DOM share, happy-dom | Pass on jsdom, not on happy-dom |
| --- | --- | --- | --- | --- | --- | --- |
| Ariakit | 404 | 120 | 3.4x | 41% | 11% | 0 of 1,857 |
| AG Grid | 648 | 302 | 2.1x | 34% | 20% | 0 of 11,694 (4,149 the other way) |
| Radix | 21.5 | 11.6 | 1.9x | 50% | 8% | 18 of 982 |
| Kobalte | 4.7 | 2.7 | 1.7x | 32% | 3% | 0 of 192 |
| MUI | 90 | 64 | 1.4x | 48% | 10% | 197 of 6,770 (176 are skips when not on jsdom) |
| Element Plus | 56 | 47 | 1.2x | 33% | 21% | 133 of 2,634 |
| floating-ui | 10.1 | 8.4 | 1.2x | 39% | 7% | 8 of 340 (7 skips) |
| React Spectrum | 139 | 122 | 1.1x | n/a | 8% | 1,359 of 8,456 |
| react-hook-form | 6.5 | 8.1 | 0.8x | 26% | 9% | 7 of 1,515 |

- **jsdom costs about a third of the CPU time of jsdom suites:** median 37%
  (26% to 50%) of CPU time is spent inside jsdom and its dependencies.
- **happy-dom costs about a tenth:** median 9% (3% to 21%).
- **Switching to happy-dom makes suites faster but not by the DOM share
  alone:** median 1.4x wall time (0.8x to 3.4x).
- **Switching breaks tests in both directions.** Suites written on jsdom lose
  tests on happy-dom; AG Grid, written on happy-dom, loses 35% of its tests
  on jsdom. Handsontable's core suite hangs on happy-dom.

Why tests fail on happy-dom:

- **Tests coupled to jsdom's object shapes.** 661 of React Spectrum's
  failures are `jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get')`-style
  mocks of getters that happy-dom defines elsewhere; 52 more are a
  `process.versions` conflict in happy-dom's Jest environment.
- **Behavior differences, a long tail.** Element Plus fails in 94 distinct
  ways (checked state, element removal timing, focus); Radix on accessible
  names and text queries; react-hook-form on checkbox and text state.
- **Deliberate skips.** MUI and floating-ui skip some tests when not on jsdom.

## Answer

By the decision rule set before the experiment, the case is **partly there,
but not for the product as first described**.

1. **"Faster than happy-dom" has little headroom.** On happy-dom the DOM is
   about 9% of CPU time. A DOM infinitely faster than happy-dom would save
   about a tenth of test time. Speed alone does not justify a new DOM.
2. **jsdom users pay a real cost.** About a third of their CPU time is
   jsdom, and happy-dom already shows suites can run 1.2x to 3.4x faster.
3. **But they cannot simply switch.** Every jsdom suite we moved lost tests,
   partly to behavior gaps and partly to tests that depend on jsdom's object
   shapes (where getters live, what can be spied on).

So the opportunity is **jsdom compatibility at happy-dom speed**: a DOM that
behaves and is shaped like jsdom where tests can observe it, and costs what
happy-dom costs. That is a narrower, clearer target than "a new DOM", and it
has two competing routes:

- **Improve happy-dom's compatibility upstream.** Behavior gaps are a long
  tail of fixable bugs; object-shape differences (getters on different
  prototypes) are design choices happy-dom may not want to change.
- **Speed up jsdom upstream.** Its hot paths are known from stage 1
  (`getComputedStyle`, selector matching, tree walking); a third of CPU time
  is the ceiling.
- **Build a new DOM** that is jsdom-shaped by design and happy-dom-fast,
  scoped to the ~800 members tests use.

## Caveats

Nine suites, one machine, two workers. Profiling adds overhead, and CPU time
from profiles is not wall time. Environment setup per test file is included
in the DOM share but not separated. Per-file `@vitest-environment` comments
were not switched. Projects kept their own DOM versions where installed
(Element Plus's jsdom is 16.4, much older than the others). Failing counts
include tests that fail for setup reasons on one DOM, not only behavior.
