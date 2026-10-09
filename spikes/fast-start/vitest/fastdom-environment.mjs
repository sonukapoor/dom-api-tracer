// Vitest environment backed by the fast-start prototype (spike).
import { createRequire } from 'node:module';
const { createWindow } = createRequire(import.meta.url)('../fastdom.cjs');

export default {
  name: 'fastdom',
  viteEnvironment: 'client',
  setup(global) {
    const win = createWindow();
    // DOM interfaces, window and document; Node's own web APIs (URL, Blob,
    // AbortController, ...) stay, as in Vitest's jsdom environment.
    const dom = /^(HTML|SVG|Node|Element|Document|EventTarget|Event|CustomEvent|UIEvent|MouseEvent|KeyboardEvent|FocusEvent|InputEvent|Text|Comment|CharacterData|Attr|NamedNodeMap|DOMTokenList|NodeList|HTMLCollection|MutationObserver|CSS|Range|Selection|ShadowRoot|window$|document$)/;
    const keys = Object.keys(win).filter((k) => !k.startsWith('__') && (dom.test(k) || !(k in global)));
    const saved = new Map();
    for (const key of keys) {
      saved.set(key, Object.getOwnPropertyDescriptor(global, key));
      Object.defineProperty(global, key, { value: win[key], configurable: true, writable: true });
    }
    return {
      teardown(global) {
        for (const [key, d] of saved) { if (d) Object.defineProperty(global, key, d); else delete global[key]; }
      },
    };
  },
};
