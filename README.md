# dom-api-tracer

Measure which DOM APIs real test suites actually use.

`dom-api-tracer` plugs into Vitest or Jest, instruments whatever DOM
implementation the tests run on (jsdom or happy-dom), and records every DOM
method call, property read and property write per test file. A CLI then
aggregates the data across files and projects into a usage report: which
members matter, how often they are hit, and how much of the DOM surface real
code touches at all.

It exists to answer one question with data instead of guesses: **what does a
DOM implementation for testing actually need to implement, and which paths
must be fastest?**

## Example findings

From 51 test files in two open-source projects (floating-ui and solid)
under jsdom:

- 213 of 3,558 instrumentable members were used (6.0%).
- 43 members accounted for 90% of all DOM operations.
- The most-hit members were `Element#tagName`, `Element#getAttribute`,
  `EventTarget#addEventListener`, `Node#parentElement` and `Node#nodeType`
  (35k-68k operations each).

A larger corpus is in progress (see "Tracing a corpus of real projects").

## Install

```sh
npm install --save-dev dom-api-tracer
```

## Use with Vitest

Add the tracer as the **first** setup file:

```js
// vitest.config.js
export default {
  test: {
    environment: 'jsdom', // or 'happy-dom'
    setupFiles: ['dom-api-tracer/vitest', ...yourOtherSetupFiles],
  },
};
```

## Use with Jest

```js
// jest.config.js
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['dom-api-tracer/jest', ...yourOtherSetupFiles],
};
```

## Generate a report

Run your tests as usual. Each test file writes a JSON report into
`.dom-trace/`. Then:

```sh
npx dom-trace report
```

This writes `dom-trace-report/summary.md` (human-readable),
`usage.json` (full data, including unused catalog members) and
`usage.csv` (one row per member).

Aggregate several projects by passing several trace directories:

```sh
npx dom-trace report ~/traces/project-a ~/traces/project-b --out corpus-report
```

### Commands

| Command | Description |
| --- | --- |
| `dom-trace report [dirs...] [--out dir] [--top n]` | Aggregate reports (default dir `.dom-trace`) |
| `dom-trace clean [dir]` | Delete a trace directory |

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DOM_TRACE_DIR` | `.dom-trace` | Where per-file reports are written |
| `DOM_TRACE_PROJECT` | cwd basename | Project name recorded in each report. Set it when tracing a monorepo so all packages count as one project. |
| `DOM_TRACE_NESTING` | `outermost` | `outermost` ignores DOM calls made by the DOM implementation itself while running another DOM call. `all` counts every call, including the implementation's own. |

## Tracing a corpus of real projects

`scripts/trace-corpus.mjs` traces many projects without editing their
configs. Projects are listed in `corpus/corpus.json`:

```json
{ "projects": [ { "name": "floating-ui",
    "repo": "https://github.com/floating-ui/floating-ui",
    "packages": [ { "dir": "packages/react", "runner": "vitest" } ] } ] }
```

```sh
node scripts/trace-corpus.mjs --repos-dir ~/src   # reuse checkouts, clone missing ones
node scripts/trace-corpus.mjs --only floating-ui  # re-run one project
```

For each package it:

1. clones and installs the project if needed (install command from the lockfile),
2. writes a temporary config next to the package's own Vitest or Jest config
   that imports it and puts the tracer first in the setup files,
3. runs the project's own runner binary with traces going to
   `.corpus/traces/<name>` and `DOM_TRACE_PROJECT=<name>`,
4. deletes the temporary config and runs the suite again untraced as a
   baseline,
5. records pass counts and durations for both runs in `.corpus/status.json`.

Runs use 2 test workers by default (`--max-workers <n>` to change), so large
suites do not saturate the machine. Only one run can be active at a time
(`.corpus/run.lock`), and wrapper configs left behind by an interrupted run
are removed when the next one starts.

Suites that run in Vitest browser mode are skipped, and a package that writes
no traces is reported as failed. Logs for every run are in `.corpus/logs/`,
and the aggregated report in `.corpus/report/`. Run
`node scripts/trace-corpus.mjs --help` for all options.

Choose projects whose tests use a simulated DOM: component libraries for
React, Vue, Angular, Svelte and Lit, plus design systems and form libraries.
A suite does not need to pass completely to produce useful data.

## How it works

At setup the tracer finds the real DOM window (handling Vitest's habit of
copying window members onto Node's global), then wraps every own method,
getter and setter on:

1. the prototypes of all DOM interface constructors on the window,
2. the window's own prototype chain and own functions and accessors, and
3. the prototype chains of representative live nodes (some implementations
   use internal subclasses that are not reachable from global constructors).

Each wrapper increments a counter and forwards to the original with the same
`this` and arguments. Function `name` and `length` are preserved. Functions
that tests replace with mocks are left untouched. ECMAScript built-ins and
Node's own classes are excluded.

Both jsdom and happy-dom call their own public API internally: happy-dom for
ordinary operations such as `classList.add`, jsdom for selector matching and
style resolution (a single `getComputedStyle` call reads `localName`,
`nodeType` and `parentNode` hundreds of times). By default only the outermost
DOM call is counted. User code that the implementation runs from inside a
DOM call is counted again: event listeners and `on*` handlers (wrapped when
registered; `el.onclick` still returns the original function) and custom
element lifecycle callbacks (wrapped when the class is passed to
`customElements.define`). The implementation's own work around them, such as
reading `event.type` during dispatch, is not counted.

Measured overhead on the fixture suite was within run-to-run noise.

## Report format

Each `run-*.json` contains:

```json
{
  "schemaVersion": 1,
  "project": "my-app",
  "testFile": "src/button.test.tsx",
  "runner": "vitest",
  "environment": "jsdom",
  "usage": {
    "Document#createElement": { "call": 51 },
    "HTMLInputElement#value": { "get": 6, "set": 4 }
  }
}
```

Member IDs are `Interface#member`. Window members are `window#member`.
`catalog-<environment>.json` lists every member that was instrumented, which
is the denominator for coverage figures.

## Known limitations

- Constructor calls (`new Event(...)`) are not counted yet.
  Prototype members of the created objects are.
- Members defined as non-configurable instance properties (for example jsdom's
  `[LegacyUnforgeable]` members like `location`) cannot be wrapped. They are
  listed under `skipped` in the catalog.
- Runner environment code is counted. For example,
  `jest-environment-jsdom` adds its own event listeners.
- DOM calls from other user code that the implementation runs synchronously
  inside a DOM call are not counted: custom element constructors (e.g. during
  `createElement` or `innerHTML`), `NodeIterator`/`TreeWalker` filters.
  Event listeners and custom element lifecycle callbacks are counted.
- A member re-entered from user code inside its own call (a listener that
  calls `dispatchEvent` from within `dispatchEvent`) is not counted again.
- Catalog sizes differ between jsdom versions. Jest bundles its own jsdom.

## Development

```sh
npm install
npm test   # runs the fixtures under Vitest+jsdom, Vitest+jsdom (no isolation),
           # Vitest+happy-dom and Jest+jsdom, and asserts exact counts
```

## License

MIT © Sonu Kapoor
