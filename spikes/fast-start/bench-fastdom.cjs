// Load time, window creation time and isolation of the fast-start prototype.
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const { createWindow } = require('./fastdom.cjs');

// Isolation: patching one window's prototypes must not affect another window.
const a = createWindow(), b = createWindow();
Object.defineProperty(a.HTMLElement.prototype, 'offsetWidth', { get: () => 42, configurable: true });
const divA = a.document.createElement('div'), divB = b.document.createElement('div');
assert.equal(divA.offsetWidth, 42, 'patch applies in its own window');
assert.notEqual(divB.offsetWidth, 42, 'patch does not leak into another window');
assert.ok(divA instanceof a.HTMLElement && !(divA instanceof b.HTMLElement), 'instanceof is per window');
// Core behaviour works.
const doc = a.document, ul = doc.createElement('ul');
for (let i = 0; i < 3; i++) { const li = doc.createElement('li'); li.textContent = 'item ' + i; ul.appendChild(li); }
doc.body.appendChild(ul);
let clicks = 0; ul.addEventListener('click', () => clicks++);
doc.querySelector('li').dispatchEvent(new a.Event('click', { bubbles: true }));
assert.equal(doc.querySelectorAll('li').length, 3); assert.equal(ul.textContent, 'item 0item 1item 2'); assert.equal(clicks, 1);

const times = [];
for (let i = 0; i < 10; i++) createWindow();
for (let i = 0; i < 200; i++) { const t = performance.now(); const w = createWindow(); w.document.body.appendChild(w.document.createElement('div')); times.push(performance.now() - t); }
times.sort((x, y) => x - y);
console.log(`fast-start prototype         median ${times[100].toFixed(2)} ms   p90 ${times[180].toFixed(2)} ms   (isolation and core checks passed)`);
