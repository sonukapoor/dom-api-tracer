# Stage 1 report: outline (draft)

> Working outline for the published stage 1 report. Temporary location, like
> `PLAN.md`: move it to the project's own repo once it has a name.

**Working title:** What DOM do unit tests actually use? Measurements from
N open-source test suites under jsdom and happy-dom.

**Audience:** maintainers of component libraries and test tooling, jsdom /
happy-dom maintainers, and anyone choosing a test DOM. They should be able to
check every number.

**The questions it answers**

1. How much of the DOM do real test suites touch?
2. Which members are needed everywhere (the must-have core)?
3. Which members are hot, and why (framework code or test tooling)?
4. How does this differ by framework and by kind of library?
5. What can a new test DOM defer or leave out?

## 0. Summary

One screen: corpus size, headline numbers (members used vs available, size
of the core set, members covering 90% of operations), the three most
important findings, and a link to the raw data.

## 1. Why measure

- Test DOMs are a trade-off between speed (happy-dom) and correctness
  (jsdom); neither was designed from usage data.
- Grids and large component suites are known to be slow under jsdom
  (Handsontable mocks its stylesheet because `getComputedStyle` is ~10x
  slower with it; AG Grid moved to happy-dom).
- Goal: a usage-driven scope and list of hot paths for a new test DOM.

## 2. Method

- **Tracer:** wraps every method, getter and setter of every DOM interface,
  the window, and live-node prototype chains; counts per test file.
- **What counts as a use:** only the outermost DOM call. Implementations
  call their own public API internally (jsdom's selector engine and style
  resolution, happy-dom generally); counting re-opens inside event listeners
  and custom element callbacks. Show the before/after numbers (92% of
  operations were jsdom internals) as the reason.
- **Harness:** tracer injected through a temporary config, project files
  untouched; each suite also run untraced, and only suites whose pass counts
  match are used. Worker counts and versions recorded.
- **Corpus selection:** criteria (popular, unit/component tests under jsdom
  or happy-dom, framework and library-kind coverage), and what was rejected
  and why (browser-mode suites, Karma, lockfile-only repos).
- **Validation:** the tracer's own fixture suite (exact expected counts under
  Vitest/Jest, jsdom/happy-dom).

## 3. Corpus

Table: project, framework, kind (component lib, design system, grid, form,
app framework), DOM environment, packages traced, test files, tests,
commit SHA, pass parity (baseline vs traced), tracer overhead.

## 4. Results

1. **Surface area:** members used vs instrumentable, per environment;
   coverage curve (members needed for 50/80/90/99% of operations).
2. **The core set:** members used by at least half of the projects, grouped
   by interface (Node, Element, Document, EventTarget, CSSStyleDeclaration,
   ...).
3. **Breadth ranking:** top members by projects and test files using them.
   This is the primary ranking.
4. **Hot paths:** top members by operations, each with a concentration
   column (share from the single busiest test file). Explain the Testing
   Library `waitFor` + `getBy*` error-dump effect with the experiment.
5. **By framework and by kind:** what React, Vue, Angular, Solid, web
   components, grids and design systems add beyond the core.
6. **jsdom vs happy-dom:** differences in what is available and what is
   used.
7. **Never or rarely used:** whole interfaces and areas no project touched
   (candidates to defer).
8. **Test speed observations:** suite durations under jsdom vs happy-dom
   where we have both, and the slowest suites (grids), as the bridge to
   stage 3.

## 5. Implications for a new test DOM

- Must-have list (the core set) and should-have list (common).
- Fast-path list: the members that dominate operations, and the patterns
  behind them (tree walking, `matches`, attribute iteration, style reads).
- What can be lazy (e.g. objects materialized only when read) and what can
  be deferred.

## 6. Limitations

- Corpus bias (popular open-source libraries; no private app suites).
- Unit and component tests only; browser and e2e suites excluded.
- Not counted: constructors (`new Event()`), unforgeable members, user code
  run inside DOM calls other than listeners and custom element callbacks.
- Runner environment code is counted (e.g. jest-environment-jsdom's own
  listeners).
- Operation counts are skewed by a few test files; caller (framework vs test
  tooling) can only be inferred, not measured.
- Single commit per project; jsdom/happy-dom version differences.
- Suites with files failing in both runs contribute partial data.

## 7. Reproduce it

Commands, `corpus/corpus.json`, tracer version, per-project commit SHAs and
runner versions, and downloadable `usage.json` / `usage.csv` / per-file
traces.

## Appendix

- Full member table (breadth, operations, concentration, environments).
- Per-project summaries.
- Glossary: member, operation, outermost counting, catalog, breadth.

## Figures to produce

- Coverage curve (members vs share of operations).
- Breadth vs operations scatter, with concentration highlighted.
- Interface x project heatmap.
- Before/after chart for outermost counting (jsdom internals).

## Open questions before publishing

- Caller attribution: can we cheaply tag operations from Testing Library vs
  framework code (e.g. sampled stack traces)? Would make 4.4 much stronger.
- Normalization: report per-file medians next to totals so one heavy file
  does not dominate?
- Count constructors (`new Event()`, `new MutationObserver()`) before
  publishing?
- Corpus size target and freeze date.
- Where to publish (project site, blog, GitHub) and under what project name.
