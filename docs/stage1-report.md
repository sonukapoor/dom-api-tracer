# What DOM do unit tests actually use?

**Measurements from 20 open-source test suites under jsdom and happy-dom**

*Draft, 2026-10-08. Data: commit SHAs in the corpus table; figures computed by
`scripts/report-data.mjs`.*

## Summary

We traced every DOM method call, property read and property write made by the
unit and component tests of 20 open-source projects: 4,151 test files and about
80,000 tests, covering React, Vue, Angular, Svelte, Solid, web components and
two data grids, on jsdom (17 projects) and happy-dom (6 projects; some
projects use both). Every suite passed exactly the same tests with and without
the tracer.

- **Tests use a small part of the DOM.** 1,006 of 5,887 members jsdom
  exposes were used (17.1%), and 518 of 2,983 in happy-dom (17.4%).
  1,148 members were used at all, and 165 were used by at least half of the
  projects.
- **A few members carry the load.** 8 members account for half of all 282
  million recorded operations, 56 for 90%.
- **The hot core is the same everywhere.** Weighting every project equally,
  the busiest members are `nodeType`, `addEventListener`, `ownerDocument`,
  `matches`, `setAttribute`, `tagName`, `getAttribute`, `insertBefore` and
  `createTextNode`, each used by 17 to 20 of the 20 projects.
- **Much of the hot work is tree walking done by test tooling**, not by the
  components under test: for example, Testing Library's `waitFor` +
  `getBy*` polling serializes the whole DOM into an error message on every
  failed attempt.
- **Layout-driven components measure constantly, and get zeros.** Grids and
  virtualized lists call `getComputedStyle` hundreds of times per test file
  and read `clientHeight`/`offsetWidth`/... hundreds more, in an environment
  with no layout engine.

## 1. Why measure

Unit and component tests run on a simulated DOM because a real browser is too
slow to start and to drive for thousands of small tests. The two common
choices trade speed against correctness: jsdom follows the specs closely,
happy-dom is faster. Neither was scoped from data about what tests use.

Some suites are known to suffer. Handsontable mocks its own stylesheet in unit
tests because, in its words, the stylesheet "makes jsdom's `getComputedStyle`
about 10x slower per grid". AG Grid runs its tests on happy-dom. We wanted to
know what a DOM built for tests has to implement, and which parts must be
fastest.

## 2. Method

**Tracer.** At test setup, before any project code runs, a tracer wraps every
method, getter and setter on the prototypes of all DOM interfaces, on the
window, and on the prototype chains of sample live nodes (happy-dom uses
internal subclasses not reachable from the global constructors). Each wrapper
increments a counter and forwards the call unchanged. One report is written
per test file.

**What counts as a use.** DOM implementations call their own public API
internally: happy-dom for ordinary operations (`classList.add` calls
`setAttribute`), jsdom for selector matching and style resolution (one
`getComputedStyle` call reads `localName`, `nodeType` and `parentNode`
hundreds of times). Counting every call would mostly measure the
implementation: on floating-ui's suite, 92% of all calls (7.6M of 8.3M) were
jsdom calling itself. So only the outermost DOM call is counted. Counting
resumes while user code runs inside a DOM call: event listeners and `on*`
handlers (wrapped when registered) and custom element lifecycle callbacks.

**Harness.** For each project, the tracer is injected through a temporary
config file that imports the project's own Vitest or Jest config; no project
file is changed. Each suite runs twice, untraced and traced, with the
project's own runner binary and two workers. Data is kept only when both runs
pass the same tests; all 20 did. The corpus is defined in
`corpus/corpus.json`, with each project's install, build and environment
requirements.

**Corpus selection.** Popular projects whose unit or component tests run on
jsdom or happy-dom, chosen for coverage of frameworks and library types. We
rejected suites that run in a real browser: Lit, Shoelace, FAST, Ionic,
Angular Material, ng-bootstrap, PrimeNG, Preact and Primer use Vitest browser
mode, Web Test Runner, Karma or Playwright. Web components are therefore
under-represented (see Limitations).

**Validation.** The tracer's own suite runs fixtures under Vitest + jsdom,
Vitest + jsdom without isolation, Vitest + happy-dom and Jest + jsdom, and
asserts exact counts, including that implementation-internal work is not
counted and that listener and custom element code is.

## 3. Corpus

| Project | Frameworks | Kind | DOM | Test files | Tests | Untraced / traced (s) |
| --- | --- | --- | --- | --- | --- | --- |
| [mantine](https://github.com/mantinedev/mantine) `f7ab1ef` | React | design system | jsdom (Jest) | 727 | 17,861 | 900 / 1,700 |
| [ag-grid](https://github.com/ag-grid/ag-grid) `73997c5` | vanilla | data grid | happy-dom | 717 | 11,694 | 303 / 313 |
| [handsontable](https://github.com/handsontable/handsontable) `fff66b1` | vanilla, React, Vue, Angular | data grid | jsdom (Jest) | 554 | 8,082 | 538 / 960 |
| [react-spectrum](https://github.com/adobe/react-spectrum) `2691598` | React | design system | jsdom (Jest) | 384 | 8,456 | 156 / 173 |
| [CopilotKit](https://github.com/CopilotKit/CopilotKit) `85fbc55` | React, Vue, Angular, web components | app components | jsdom | 327 | 3,860 | 203 / 211 |
| [material-ui](https://github.com/mui/material-ui) `bd66a84` | React | design system | jsdom | 266 | 6,770 | 96 / 97 |
| [ariakit](https://github.com/ariakit/ariakit) `51eb28a` | React, Solid | headless components | happy-dom (+ jsdom) | 264 | 1,857 | 119 / 123 |
| [ark-ui](https://github.com/chakra-ui/ark) `eb6abb0` | React, Vue, Solid, Svelte | headless components | happy-dom + jsdom | 174 | 1,245 | 61 / 64 |
| [element-plus](https://github.com/element-plus/element-plus) `6f7016e` | Vue | design system | jsdom (+ happy-dom) | 161 | 2,634 | 54 / 56 |
| [nuxt-ui](https://github.com/nuxt/ui) `9c4e33b` | Vue | design system | happy-dom | 143 | 4,056 | 59 / 59 |
| [react-hook-form](https://github.com/react-hook-form/react-hook-form) `e76876b` | React | forms | jsdom (Jest) | 124 | 1,515 | 6 / 8 |
| [vuetify](https://github.com/vuetifyjs/vuetify) `e23a3c1` | Vue | design system | jsdom | 73 | 947 | 15 / 17 |
| [ngx-formly](https://github.com/ngx-formly/ngx-formly) `1f88133` | Angular | forms | happy-dom (Jest) | 60 | 854 | 10 / 11 |
| [radix-primitives](https://github.com/radix-ui/primitives) `4e8b0db` | React | headless components | jsdom | 45 | 982 | 17 / 18 |
| [emoji-picker-element](https://github.com/nolanlawson/emoji-picker-element) `5d1c8bf` | web components | web component | jsdom | 31 | 160 | 22 / 22 |
| [solid](https://github.com/solidjs/solid) `aa12352` | Solid | framework runtime | jsdom | 27 | 482 | 1 / 2 |
| [floating-ui](https://github.com/floating-ui/floating-ui) `414e093` | React, Vue | positioning | jsdom | 24 | 340 | 10 / 11 |
| [kobalte](https://github.com/kobaltedev/kobalte) `675b4a1` | Solid | headless components | jsdom | 23 | 192 | 3 / 4 |
| [analog](https://github.com/analogjs/analog) `3b9463e` | Angular | meta-framework | jsdom | 18 | 194 | 14 / 16 |
| [svelte](https://github.com/sveltejs/svelte) `707c281` | Svelte | framework runtime | jsdom | 9 | 7,879 | 36 / 50 |

Times are wall clock with two test workers on one laptop. They show tracer
overhead (median about 1.1x; up to 1.9x for the busiest Jest + jsdom suites),
not comparable speeds between projects.

## 4. Results

### 4.1 Surface area

| Environment | Projects | Test files | Members available | Members used | Used |
| --- | --- | --- | --- | --- | --- |
| jsdom | 17 | 2,864 | 5,887 | 1,006 | 17.1% |
| happy-dom | 6 | 1,287 | 2,983 | 518 | 17.4% |

Catalogs combine the versions found in the corpus, so they are an upper bound
on what each environment exposes. Whole areas went untouched: 90 of 196
interfaces in jsdom and 143 of 205 in happy-dom had no member used at all.
The largest untouched ones in jsdom were `ElementInternals`, `SVGSVGElement`,
`HTMLObjectElement`, `HTMLBodyElement`, `HTMLAreaElement`, `XMLHttpRequest`,
the frame elements, `CSSCounterStyleRule` and `XPathResult`. In happy-dom
they include `HTMLMediaElement`, `SVGSVGElement`, `DOMMatrix`, `SubtleCrypto`
and `PerformanceResourceTiming`.

### 4.2 The core set

165 members were used by at least half of the projects. By interface:

| Interface | Members | Examples |
| --- | --- | --- |
| Element | 32 | `setAttribute`, `classList`, `getAttribute`, `matches`, `tagName`, `closest`, `append`, `remove` |
| Node | 19 | `nodeType`, `ownerDocument`, `appendChild`, `parentElement`, `childNodes`, `insertBefore`, `contains`, `textContent`, `getRootNode` |
| Document | 14 | `createElement`, `body`, `activeElement`, `createTextNode`, `querySelector(All)`, `getElementById`, `createRange`, `getSelection` |
| HTMLElement | 12 | `style`, `hidden`, `dataset`, `tabIndex`, `focus`, `blur`, `click`, `offsetWidth`/`Height`/`Left`/`Top` |
| HTMLInputElement | 12 | `type`, `value`, `checked`, `indeterminate`, `selectionStart`/`End`, `labels`, `select` |
| window | 12 | `getComputedStyle`, `requestAnimationFrame`, `customElements`, `navigator`, `performance`, timers |
| Event + subclasses | 27 | `type`, `target`, `defaultPrevented`, `composedPath`, `preventDefault`; mouse buttons and coordinates; key and modifiers; `relatedTarget` |
| CSSStyleDeclaration | 10 | `setProperty`, `getPropertyValue`, `removeProperty`, `cssText`, `width`, `height`, `position`, `display`, `transform`, `opacity` |
| other | 27 | `DOMTokenList` (`contains`, `add`, `remove`), `MutationObserver` (`observe`, `disconnect`), `NodeList`/`HTMLCollection` iteration, `Attr#value`, `CharacterData#data`, form controls |

### 4.3 Coverage curve

| Share of all operations | Members needed |
| --- | --- |
| 50% | 8 |
| 80% | 32 |
| 90% | 56 |
| 95% | 84 |
| 99% | 174 |
| 100% | 1,148 |

### 4.4 Hot paths, and where they come from

Raw operation counts are concentrated. Three projects (AG Grid 97M, React
Spectrum 77M, Mantine 42M) produce 76% of all operations, and the 100 busiest
test files (2.4% of files) produce half. The median test file makes about
3,900 DOM operations. We therefore rank by each member's average share of a
project's operations, giving every project the same weight:

| Member | Mean share per project | Projects |
| --- | --- | --- |
| `Node#nodeType` | 9.7% | 20 |
| `EventTarget#addEventListener` | 8.1% | 20 |
| `Node#ownerDocument` | 4.3% | 17 |
| `Element#matches` | 3.6% | 17 |
| `Element#setAttribute` | 3.6% | 20 |
| `Element#tagName` | 3.1% | 20 |
| `Element#getAttribute` | 2.8% | 19 |
| `Node#insertBefore` | 2.6% | 19 |
| `Document#createTextNode` | 2.1% | 19 |
| `Node#parentNode` | 1.9% | 20 |
| `Node#childNodes` | 1.8% | 19 |
| `HTMLElement#style` | 1.7% | 18 |
| `Document#createElement` | 1.6% | 20 |
| `Node#nextSibling` | 1.6% | 20 |
| `Node#parentElement` | 1.5% | 18 |

Two patterns explain much of this list.

**Test tooling walks the tree.** Testing Library queries (`getByRole`,
`getByText`) visit every element and read `nodeType`, `tagName`, attributes
and text. Inside `waitFor`, every failed attempt builds an error whose message
is a `prettyDOM` dump of the whole tree, and `waitFor` throws it away and
retries. In a 200-element test we measured, that dump caused all of the
attribute iteration and 86% of the `nodeType` reads; disabling it
(`configure({ getElementError })`) removed them. In the corpus, three
CopilotKit test files built this way produced 48% of all attribute iteration
across the 20 projects.

**Host APIs are a large share.** 29% of operations go to window-level
services rather than the document tree. `Performance#now` alone is 62.5M
calls, almost all in React Spectrum and Mantine (React's scheduler reads the
clock while rendering is the likely source); `navigator` is read in all 20
projects, typically by tooling detecting its environment.

### 4.5 By kind of library

Members used by at least half of one kind of project and by few others:

- **Data grids** (AG Grid, Handsontable): `border*Width` and `boxSizing`
  style reads, `before`/`prepend`, `childElementCount`, and the legacy
  `document.createEvent` + `initEvent`.
- **Design systems**: `localStorage`, `hasChildNodes`,
  `getElementsByClassName`, `TreeWalker`, `clientLeft`.
- **Headless components**: reads of individual style properties
  (`position`, `display`, `overflow`, `visibility`, `pointerEvents`,
  `opacity`) for visibility and positioning logic.

Style members appear under two interface names because newer jsdom versions
call the declaration object `CSSStyleProperties`; a new implementation should
treat these as one surface.

### 4.6 Layout-driven components

Per test file:

| Member | Handsontable | React Spectrum | AG Grid | Mantine | MUI | CopilotKit |
| --- | --- | --- | --- | --- | --- | --- |
| `getComputedStyle` | 940 | 886 | 151 | 349 | 163 | 408 |
| `style` | 3,039 | 3,127 | 9,654 | 1,268 | 89 | 117 |
| `clientHeight` | 257 | 2 | 369 | 29 | 44 | 10 |
| `clientWidth` | 216 | 1 | 24 | 83 | 51 | 9 |
| `offsetWidth` | 179 | 22 | 22 | 10 | 6 | 0 |
| `scrollWidth` / `scrollHeight` | 168 / 165 | 21 / 14 | 0 / 0 | 3 / 3 | 4 / 2 | 4 / 20 |
| `getBoundingClientRect` | 35 | 117 | 0 | 68 | 79 | 4 |

jsdom has no layout engine, so every size and position read returns 0. Grid
and virtualized-list code measures constantly and gets zeros; how much test
logic depends on those zeros we did not measure. React Spectrum and AG Grid
make about 200,000 and 135,000 DOM operations per test file; most component
libraries make between 1,000 and 50,000.

## 5. Implications for a test DOM

1. **Scope.** The 165-member core plus the members used by at least two
   projects (815 in total) are what a first implementation has to get right;
   most of the catalog can follow later or never.
2. **Fast paths.** Tree navigation (`nodeType`, `parentNode`,
   `parentElement`, `childNodes`, `nextSibling`, `ownerDocument`), attribute
   access and iteration, `matches`, event listener registration and dispatch,
   and node creation and insertion.
3. **Serialization is hot.** Fast attribute iteration and text access make
   Testing Library's error dumps cheap; this pattern deserves its own
   benchmark.
4. **Styles and layout.** A cheap `getComputedStyle` matters for grids and
   virtualized components; an optional, simple layout model is worth
   evaluating, since these suites currently test against zeros.
5. **Host services** (`performance.now`, timers, `requestAnimationFrame`,
   `navigator`) must be cheap; they are 29% of all operations.

## 6. Limitations

- **Corpus.** 20 popular open-source libraries; no application suites. Web
  components are under-represented because most web component libraries test
  in real browsers; Angular and Svelte have few suites.
- **Unit and component tests only.** Browser-mode and end-to-end suites are
  excluded by design.
- **Not counted:** constructors (`new Event()`, `new MutationObserver()`),
  non-configurable members (jsdom's `[LegacyUnforgeable]` members such as
  `location`), and user code that runs synchronously inside DOM calls other
  than listeners, handlers and custom element callbacks (for example custom
  element constructors and `TreeWalker` filters).
- **Runner and tooling code is counted.** Test environments, Testing Library
  and framework schedulers are measured together with component code; we can
  infer but not measure who made a call.
- **Concentration.** A few projects and files dominate raw counts; we report
  equal-weight rankings next to totals.
- **One commit per project**, mixed jsdom and happy-dom versions, Node 22.23.3.
- **Overhead.** Traced runs were up to 1.9x slower, so traced timings are not
  benchmarks.

## 7. Reproduce

```sh
git clone <this repository> && cd dom-api-tracer && npm ci
node scripts/trace-corpus.mjs --repos-dir ~/src        # clone, install, trace (2 workers)
node bin/dom-trace.cjs report .corpus/traces/*/ --out .corpus/report
node scripts/report-data.mjs                            # figures used in this report
```

`corpus/corpus.json` lists each project with its repository, install and
build commands, environment variables and notes. `.corpus/report/usage.json`,
`usage.csv` and `report-data.json` hold the full member table and every figure
above.

## Open items before publishing

- Publish the raw data (per-file traces, usage tables) next to the report.
- Figures: coverage curve, breadth vs operations, interface-by-project heatmap.
- Confirm the `Performance#now` source in React Spectrum and Mantine.
- Decide whether to count constructors before publishing.
- Name and home of the project the report introduces.
