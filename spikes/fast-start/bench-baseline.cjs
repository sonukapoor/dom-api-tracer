// How long does it take jsdom and happy-dom to create one fresh window with a
// document, as a test environment does once per test file?
const { performance } = require('node:perf_hooks');
const { JSDOM } = require('jsdom');
const { Window } = require('happy-dom');

function bench(name, create, close, n = 200) {
  for (let i = 0; i < 10; i++) close(create()); // warm up module and JIT
  const times = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    const w = create();
    w.document.body.appendChild(w.document.createElement('div')); // touch it
    times.push(performance.now() - t);
    close(w);
  }
  times.sort((a, b) => a - b);
  const median = times[n >> 1], p90 = times[Math.floor(n * 0.9)];
  console.log(`${name.padEnd(28)} median ${median.toFixed(2)} ms   p90 ${p90.toFixed(2)} ms`);
}

bench('jsdom (new JSDOM)', () => new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true }).window, (w) => w.close());
bench('happy-dom (new Window)', () => new Window({ url: 'http://localhost/' }), (w) => w.happyDOM.abort?.() ?? w.close?.());

const t = performance.now();
require.cache && 0;
console.log(`(node ${process.version})`);
