// Fast mode for happy-dom: with --no-isolate, a fresh happy-dom window per
// test file, created and installed as Vitest's happy-dom environment does.
import { Window, GlobalWindow } from 'happy-dom';
import { populateGlobal } from 'vitest/environments';

const g = globalThis;
if (g.__freshWindowRestore) await g.__freshWindowRestore();
const win = new (GlobalWindow || Window)({
  console,
  url: 'http://localhost:3000',
  settings: { disableErrorCapturing: true },
});
const { keys, originals } = populateGlobal(g, win, {
  bindFunctions: true,
  additionalKeys: ['Request', 'Response', 'MessagePort', 'fetch'],
});
g.__freshWindowRestore = async () => {
  for (const key of keys) delete g[key];
  for (const [key, value] of originals) g[key] = value;
  if (win.close && win.happyDOM.abort) {
    await win.happyDOM.abort();
    win.close();
  } else win.happyDOM.cancelAsync();
};
