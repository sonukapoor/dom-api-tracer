// Extract jsdom's interface shapes (name, parent, members by kind) so the
// prototype has the same number of interfaces and members to set up.
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const win = new JSDOM('').window;
const ES = new Set(require('node:vm').runInNewContext('Object.getOwnPropertyNames(globalThis)'));
const out = [];
for (const name of Object.getOwnPropertyNames(win)) {
  if (ES.has(name) || !/^[A-Z]/.test(name)) continue;
  let ctor; try { ctor = win[name]; } catch { continue; }
  if (typeof ctor !== 'function' || !ctor.prototype) continue;
  const parentProto = Object.getPrototypeOf(ctor.prototype);
  const parent = parentProto && parentProto !== win.Object.prototype ? parentProto.constructor.name : null;
  const members = [];
  for (const key of Object.getOwnPropertyNames(ctor.prototype)) {
    if (key === 'constructor') continue;
    const d = Object.getOwnPropertyDescriptor(ctor.prototype, key);
    members.push([key, typeof d.value === 'function' ? 'm' : d.get && d.set ? 'gs' : d.get ? 'g' : 'v']);
  }
  out.push({ name, parent, members });
}
fs.writeFileSync(__dirname + '/shapes.json', JSON.stringify(out));
console.log(`${out.length} interfaces, ${out.reduce((a, i) => a + i.members.length, 0)} members`);
