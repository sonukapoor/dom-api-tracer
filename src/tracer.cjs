'use strict';

/**
 * dom-api-tracer core.
 *
 * Instruments whatever DOM implementation is installed on the global object
 * (jsdom, happy-dom, ...) by wrapping prototype methods, getters and setters
 * with cheap counters. Behaviour is unchanged: every wrapper forwards to the
 * original with the same `this` and arguments.
 */

const vm = require('node:vm');

const REGISTRY = Symbol.for('dom-api-tracer.registry');
const WRAPPED = Symbol.for('dom-api-tracer.wrapped');

// ECMAScript built-ins (Object, Array, Promise, ...) are not DOM APIs.
const ES_GLOBALS = new Set(vm.runInNewContext('Object.getOwnPropertyNames(globalThis)'));

// Host (Node / test-runner) globals that may leak onto the window object.
const HOST_GLOBALS = new Set([
  'global',
  'globalThis',
  'process',
  'Buffer',
  'require',
  'module',
  'exports',
  '__filename',
  '__dirname',
  'setImmediate',
  'clearImmediate',
  'console',
  'jsdom',
  'happyDOM',
  'expect',
  'jest',
  'vi',
  'vitest',
  // Test framework globals. Jest installs them on the jsdom window itself.
  'describe',
  'fdescribe',
  'xdescribe',
  'it',
  'fit',
  'xit',
  'test',
  'xtest',
  'beforeAll',
  'afterAll',
  'beforeEach',
  'afterEach',
  'suite',
  'context',
  'pending',
  'fail',
  'spyOn',
  'jasmine',
]);

const FUNCTION_OWN_KEYS = new Set(['length', 'name', 'prototype', 'arguments', 'caller']);

// DOM functions never carry extra own properties. Functions that do (it.each,
// expect.extend, ...) belong to someone else, and a wrapper would hide them.
function hasExtraOwnProps(fn) {
  try {
    return Reflect.ownKeys(fn).some((k) => !FUNCTION_OWN_KEYS.has(k));
  } catch {
    return true;
  }
}

// Properties we never wrap because wrapping them adds noise or risk.
const SKIP_MEMBERS = new Set(['constructor', 'prototype', 'length', 'name', 'caller', 'arguments']);

function keyName(key) {
  return typeof key === 'symbol' ? `[${key.description}]` : key;
}

function createRegistry() {
  return {
    counters: new Map(), // memberId -> { call, get, set }
    catalog: new Set(), // every memberId we instrumented
    skipped: [], // { id, reason }
    instrumentedPrototypes: new WeakSet(),
    environment: 'unknown',
    state: { depth: 0, outermostOnly: false },
    windows: new WeakSet(), // windows already instrumented
    listeners: new WeakMap(), // user listener -> counting wrapper
    originals: new WeakMap(), // counting wrapper -> user listener
  };
}

function counterFor(registry, id) {
  let c = registry.counters.get(id);
  if (!c) {
    c = { call: 0, get: 0, set: 0, active: false };
    registry.counters.set(id, c);
  }
  return c;
}

function copyFnMeta(wrapper, original) {
  try {
    Object.defineProperty(wrapper, 'name', { value: original.name, configurable: true });
  } catch {}
  try {
    Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true });
  } catch {}
  wrapper[WRAPPED] = original;
  return wrapper;
}

// Event listeners and on* handlers are user code that the implementation runs
// from inside DOM calls (dispatchEvent, click, focus, ...). They are wrapped
// when registered so counting re-opens only while they run, not for the
// implementation's own dispatch work around them.
const LISTENER_MEMBERS = new Set(['addEventListener', 'removeEventListener']);
const HANDLER_PROPERTY = /^on[a-z]+$/;

// Custom element reactions are user code the implementation calls from inside
// DOM operations (appendChild, setAttribute, remove, ...).
const CUSTOM_ELEMENT_CALLBACKS = [
  'connectedCallback',
  'disconnectedCallback',
  'adoptedCallback',
  'attributeChangedCallback',
  'connectedMoveCallback',
  'formAssociatedCallback',
  'formResetCallback',
  'formDisabledCallback',
  'formStateRestoreCallback',
];

function memberOf(id) {
  return id.slice(id.indexOf('#') + 1);
}

// One wrapper per listener, so adding the same listener twice still
// registers it once and removeEventListener finds it.
function listenerFor(registry, listener) {
  if (!listener || (typeof listener !== 'function' && typeof listener !== 'object')) return listener;
  let wrapped = registry.listeners.get(listener);
  if (!wrapped) {
    const state = registry.state;
    wrapped = function () {
      const savedDepth = state.depth;
      state.depth = 0;
      try {
        return typeof listener === 'function'
          ? Reflect.apply(listener, this, arguments)
          : listener.handleEvent(...arguments);
      } finally {
        state.depth = savedDepth;
      }
    };
    // Code that inspects registered listeners must see the original: zone.js
    // stores what addEventListener receives, and Angular's DebugElement finds
    // its own listeners by their source text.
    if (typeof listener === 'function') {
      copyFnMeta(wrapped, listener);
      Object.defineProperty(wrapped, 'toString', {
        value: () => Function.prototype.toString.call(listener),
        configurable: true,
        writable: true,
      });
    }
    registry.listeners.set(listener, wrapped);
    registry.originals.set(wrapped, listener);
  }
  return wrapped;
}

// Swap user listeners and on* handlers for their wrappers on the way in, and
// on* handlers back to the originals on the way out (el.onclick === handler).
function argsFor(registry, member, kind, args, outermost) {
  if (kind === 'call' && LISTENER_MEMBERS.has(member) && args.length > 1) {
    const listener =
      member === 'addEventListener'
        ? outermost
          ? listenerFor(registry, args[1])
          : args[1]
        : registry.listeners.get(args[1]) || args[1];
    if (listener !== args[1]) return [args[0], listener, ...Array.prototype.slice.call(args, 2)];
  }
  if (kind === 'set' && outermost && HANDLER_PROPERTY.test(member) && typeof args[0] === 'function') {
    return [listenerFor(registry, args[0])];
  }
  return args;
}

function makeWrapper(registry, id, original, kind) {
  const c = counterFor(registry, id);
  const state = registry.state;
  const member = memberOf(id);
  const handlerGetter = kind === 'get' && HANDLER_PROPERTY.test(member);
  const wrapper = function () {
    // Implementations may call the same member up the prototype chain
    // (super.setAttribute). Count only the outermost entry.
    if (c.active) return Reflect.apply(original, this, arguments);
    // Some implementations (happy-dom) call their own public API internally,
    // e.g. classList.add -> setAttribute. In outermost-only mode, calls made
    // while another DOM member is running are not user calls.
    const outermost = state.depth === 0;
    if (!state.outermostOnly || outermost) c[kind]++;
    const args = argsFor(registry, member, kind, arguments, outermost);
    const savedDepth = state.depth;
    state.depth = savedDepth + 1;
    c.active = true;
    try {
      const result = Reflect.apply(original, this, args);
      return handlerGetter && registry.originals.has(result) ? registry.originals.get(result) : result;
    } finally {
      c.active = false;
      state.depth = savedDepth;
    }
  };
  return copyFnMeta(wrapper, original);
}

// Run user code at depth 0 so its DOM calls count in outermost-only mode.
function wrapUserCode(registry, original) {
  const state = registry.state;
  const wrapper = function () {
    const savedDepth = state.depth;
    state.depth = 0;
    try {
      return Reflect.apply(original, this, arguments);
    } finally {
      state.depth = savedDepth;
    }
  };
  return copyFnMeta(wrapper, original);
}

/**
 * Wrap the lifecycle callbacks of every class passed to customElements.define.
 * Implementations read the callbacks from the prototype during define(), so
 * they are wrapped before the original define() runs. Callbacks inherited from
 * a base class (e.g. LitElement) are wrapped once, where they are defined.
 */
function instrumentCustomElements(registry, win) {
  let proto;
  try {
    proto = win.customElements && Object.getPrototypeOf(win.customElements);
  } catch {
    return;
  }
  for (; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    const desc = Object.getOwnPropertyDescriptor(proto, 'define');
    if (!desc || typeof desc.value !== 'function' || !desc.configurable) continue;
    const define = desc.value;
    const wrapper = function (name, ctor) {
      if (typeof ctor === 'function' && ctor.prototype) {
        for (const cb of CUSTOM_ELEMENT_CALLBACKS) {
          let owner = ctor.prototype;
          while (owner && !Object.prototype.hasOwnProperty.call(owner, cb)) owner = Object.getPrototypeOf(owner);
          if (!owner) continue;
          const cbDesc = Object.getOwnPropertyDescriptor(owner, cb);
          if (typeof cbDesc.value !== 'function' || cbDesc.value[WRAPPED] || !cbDesc.configurable) continue;
          try {
            Object.defineProperty(owner, cb, { ...cbDesc, value: wrapUserCode(registry, cbDesc.value) });
          } catch {}
        }
      }
      return Reflect.apply(define, this, arguments);
    };
    copyFnMeta(wrapper, define);
    // Keep the original reachable for code that unwraps; `define` itself is
    // the counting wrapper installed by instrumentObject.
    wrapper[WRAPPED] = define[WRAPPED] || define;
    try {
      Object.defineProperty(proto, 'define', { ...desc, value: wrapper });
    } catch {}
    return;
  }
}

function wrapMethod(registry, id, original) {
  return makeWrapper(registry, id, original, 'call');
}
function wrapGetter(registry, id, original) {
  return makeWrapper(registry, id, original, 'get');
}
function wrapSetter(registry, id, original) {
  return makeWrapper(registry, id, original, 'set');
}

/**
 * Wrap every own member of `obj`, labelling members as `${label}#${member}`.
 */
function instrumentObject(registry, obj, label) {
  if (!obj || registry.instrumentedPrototypes.has(obj)) return;
  registry.instrumentedPrototypes.add(obj);

  for (const key of Reflect.ownKeys(obj)) {
    if (typeof key === 'string' && SKIP_MEMBERS.has(key)) continue;
    const id = `${label}#${keyName(key)}`;
    let desc;
    try {
      desc = Object.getOwnPropertyDescriptor(obj, key);
    } catch {
      continue;
    }
    if (!desc) continue;

    const isMethod = typeof desc.value === 'function';
    const isAccessor = typeof desc.get === 'function' || typeof desc.set === 'function';
    if (!isMethod && !isAccessor) continue; // plain data (e.g. constants, toStringTag)
    if (isMethod && desc.value[WRAPPED]) continue;
    if (isAccessor && ((desc.get && desc.get[WRAPPED]) || (desc.set && desc.set[WRAPPED]))) continue;

    if (!desc.configurable) {
      registry.skipped.push({ id, reason: 'non-configurable' });
      continue;
    }

    try {
      if (isMethod) {
        Object.defineProperty(obj, key, { ...desc, value: wrapMethod(registry, id, desc.value) });
      } else {
        Object.defineProperty(obj, key, {
          ...desc,
          get: desc.get ? wrapGetter(registry, id, desc.get) : undefined,
          set: desc.set ? wrapSetter(registry, id, desc.set) : undefined,
        });
      }
      registry.catalog.add(id);
    } catch (err) {
      registry.skipped.push({ id, reason: String((err && err.message) || err) });
    }
  }
}

function isInterfaceConstructor(key, value) {
  return typeof value === 'function' && /^[A-Z]/.test(key) && value.prototype && typeof value.prototype === 'object';
}

// Node's own classes (e.g. MessagePort from worker_threads) can appear on the
// window. They carry Node-internal symbols such as nodejs.util.inspect.custom.
function isNodeHostClass(value) {
  try {
    return Object.getOwnPropertySymbols(value.prototype).some((sym) =>
      String(sym.description || '').startsWith('nodejs.'),
    );
  } catch {
    return false;
  }
}

/**
 * Find the real DOM window. Under Vitest, globalThis.window is Node's global
 * with delegating getters; the actual jsdom window lives on globalThis.jsdom.
 */
function resolveWindow(globalObj) {
  const candidates = [];
  try {
    candidates.push(globalObj.jsdom && globalObj.jsdom.window);
  } catch {}
  try {
    candidates.push(globalObj.document && globalObj.document.defaultView);
  } catch {}
  try {
    candidates.push(globalObj.window);
  } catch {}
  for (const c of candidates) {
    try {
      if (c && c.document) return c;
    } catch {}
  }
  return null;
}

function detectEnvironment(win) {
  try {
    const ua = String((win.navigator && win.navigator.userAgent) || '');
    if (/jsdom/i.test(ua)) return 'jsdom';
    if (/happydom/i.test(ua.replace(/[-\s]/g, ''))) return 'happy-dom';
    if (win.happyDOM) return 'happy-dom';
  } catch {}
  return 'unknown';
}

function instrumentChain(registry, obj) {
  let proto = obj && Object.getPrototypeOf(obj);
  // Stop at Object.prototype of any realm (the root: it has no prototype).
  // jsdom's window lives in its own realm, so comparing against this realm's
  // Object.prototype is not enough.
  while (proto && Object.getPrototypeOf(proto) !== null && proto !== Function.prototype) {
    let label = 'Anonymous';
    try {
      const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor');
      if (ctor && typeof ctor.value === 'function' && ctor.value.name) label = ctor.value.name;
    } catch {}
    instrumentObject(registry, proto, label);
    proto = Object.getPrototypeOf(proto);
  }
}

const SAMPLE_TAGS = [
  'div',
  'span',
  'p',
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'form',
  'label',
  'ul',
  'ol',
  'li',
  'img',
  'table',
  'tr',
  'td',
  'template',
  'dialog',
  'iframe',
  'canvas',
  'video',
  'style',
  'script',
  'h1',
  'section',
  'details',
];

function sampleNodes(doc) {
  const out = [doc];
  const attempt = (fn) => {
    try {
      const n = fn();
      if (n) out.push(n);
    } catch {}
  };
  attempt(() => doc.documentElement);
  attempt(() => doc.head);
  attempt(() => doc.body);
  attempt(() => doc.createTextNode(''));
  attempt(() => doc.createComment(''));
  attempt(() => doc.createDocumentFragment());
  attempt(() => doc.createElementNS('http://www.w3.org/2000/svg', 'svg'));
  attempt(() => doc.createElementNS('http://www.w3.org/2000/svg', 'path'));
  for (const tag of SAMPLE_TAGS) attempt(() => doc.createElement(tag));
  attempt(() => doc.body.style);
  attempt(() => doc.body.classList);
  attempt(() => doc.body.dataset);
  attempt(() => doc.body.attributes);
  attempt(() => doc.body.childNodes);
  attempt(() => doc.body.children);
  attempt(() => doc.createRange());
  return out;
}

/**
 * Runners like Vitest copy window functions onto Node's global, either by value
 * or as a getter returning a bound copy cached at setup. Point those at a
 * counting wrapper too, but only while they still hold the original: if a test
 * replaces the function with a mock, the mock is returned untouched.
 */
function mirrorOnGlobal(registry, globalObj, key, id, original, wrapped) {
  const gdesc = Object.getOwnPropertyDescriptor(globalObj, key);
  if (!gdesc || (!gdesc.configurable && !gdesc.writable)) return;
  try {
    if ('value' in gdesc) {
      if (gdesc.value === original) Object.defineProperty(globalObj, key, { ...gdesc, value: wrapped });
      return;
    }
    if (typeof gdesc.get !== 'function' || !gdesc.configurable) return;
    const origGet = gdesc.get;
    const initial = origGet.call(globalObj);
    if (typeof initial !== 'function') return;
    const wrappedInitial = initial === original ? wrapped : wrapMethod(registry, id, initial);
    const get = function () {
      const v = Reflect.apply(origGet, this, arguments);
      return v === initial ? wrappedInitial : v;
    };
    get[WRAPPED] = origGet;
    Object.defineProperty(globalObj, key, { ...gdesc, get });
  } catch {}
}

/**
 * Instrument the DOM installed on `globalObj` (defaults to globalThis).
 * Safe to call more than once; returns the shared registry.
 */
function install(globalObj = globalThis) {
  const win = resolveWindow(globalObj);
  if (!win) {
    throw new Error(
      '[dom-api-tracer] No DOM found on the global object. Run tests with a jsdom or happy-dom environment.',
    );
  }

  let registry = globalObj[REGISTRY];
  if (!registry) {
    registry = createRegistry();
    registry.environment = detectEnvironment(win);
    // Implementations call their own public API internally: happy-dom for
    // ordinary operations, jsdom for selector matching and style resolution.
    // By default only the outermost DOM call is counted (user code reached from
    // inside a DOM call, such as listeners, re-opens counting).
    registry.state.outermostOnly = process.env.DOM_TRACE_NESTING !== 'all';
    Object.defineProperty(globalObj, REGISTRY, { value: registry, configurable: true });
  }
  // A runner may put a new window on the same global for the next test file
  // (Vitest 2 with isolate: false). Instrument every window once; the counters
  // are shared.
  if (registry.windows.has(win)) return registry;
  registry.windows.add(win);
  instrumentWindow(registry, globalObj, win);

  // Discard anything recorded while sampling nodes during installation.
  snapshot(registry, { reset: true });
  return registry;
}

function instrumentWindow(registry, globalObj, win) {
  // 1. Every DOM interface constructor: instrument its prototype and statics.
  for (const key of Object.getOwnPropertyNames(win)) {
    if (ES_GLOBALS.has(key) || HOST_GLOBALS.has(key)) continue;
    let value;
    try {
      value = win[key];
    } catch {
      continue;
    }
    if (isInterfaceConstructor(key, value)) {
      if (isNodeHostClass(value)) continue;
      instrumentObject(registry, value.prototype, key);
    }
  }

  // 2. The window's own prototype chain (Window.prototype, EventTarget.prototype, ...).
  instrumentChain(registry, win);

  // 3. Live instances. Some implementations (happy-dom) build per-window
  //    subclasses that are not reachable from the global constructors, so
  //    walk the prototype chains of representative nodes too.
  for (const node of sampleNodes(win.document)) instrumentChain(registry, node);

  // 4. Window's own functions and accessors (getComputedStyle, matchMedia, document, ...).
  for (const key of Object.getOwnPropertyNames(win)) {
    if (ES_GLOBALS.has(key) || HOST_GLOBALS.has(key)) continue;
    if (/^[A-Z]/.test(key)) continue; // constructors handled above
    const id = `window#${key}`;
    let desc;
    try {
      desc = Object.getOwnPropertyDescriptor(win, key);
    } catch {
      continue;
    }
    if (!desc) continue;

    if (typeof desc.value === 'function' && !desc.value[WRAPPED]) {
      const original = desc.value;
      if (hasExtraOwnProps(original)) continue;
      if (!desc.configurable && !desc.writable) {
        registry.skipped.push({ id, reason: 'non-configurable' });
        continue;
      }
      const wrapped = wrapMethod(registry, id, original);
      try {
        if (desc.configurable) Object.defineProperty(win, key, { ...desc, value: wrapped });
        else win[key] = wrapped;
        registry.catalog.add(id);
      } catch (err) {
        registry.skipped.push({ id, reason: String((err && err.message) || err) });
        continue;
      }
      if (globalObj !== win) mirrorOnGlobal(registry, globalObj, key, id, original, wrapped);
    } else if (desc.get || desc.set) {
      if (!desc.configurable) {
        registry.skipped.push({ id, reason: 'non-configurable' });
        continue;
      }
      // An accessor that hands out a function (e.g. a bound getComputedStyle)
      // is really a method: count calls, keep identity stable, leave mocks alone.
      let initial;
      try {
        initial = desc.get ? desc.get.call(win) : undefined;
      } catch {}
      if (typeof initial === 'function' && !initial[WRAPPED] && !hasExtraOwnProps(initial)) {
        const origGet = desc.get;
        const wrappedInitial = wrapMethod(registry, id, initial);
        const get = function () {
          const v = Reflect.apply(origGet, this, arguments);
          return v === initial ? wrappedInitial : v;
        };
        get[WRAPPED] = origGet;
        try {
          Object.defineProperty(win, key, { ...desc, get });
          registry.catalog.add(id);
        } catch (err) {
          registry.skipped.push({ id, reason: String((err && err.message) || err) });
        }
        continue;
      }
      try {
        Object.defineProperty(win, key, {
          ...desc,
          get: desc.get ? wrapGetter(registry, id, desc.get) : undefined,
          set: desc.set ? wrapSetter(registry, id, desc.set) : undefined,
        });
        registry.catalog.add(id);
      } catch (err) {
        registry.skipped.push({ id, reason: String((err && err.message) || err) });
      }
    }
  }

  // 5. Custom element lifecycle callbacks run user code inside DOM calls.
  instrumentCustomElements(registry, win);
}

/** True when a DOM is installed (false for files opting into a node environment). */
function hasDom(globalObj = globalThis) {
  return resolveWindow(globalObj) !== null;
}

function getRegistry(globalObj = globalThis) {
  return globalObj[REGISTRY] || null;
}

/** Return non-zero counters as a plain object and optionally reset them. */
function snapshot(registry, { reset = false } = {}) {
  const usage = {};
  for (const [id, c] of registry.counters) {
    if (c.call || c.get || c.set) {
      const entry = {};
      if (c.call) entry.call = c.call;
      if (c.get) entry.get = c.get;
      if (c.set) entry.set = c.set;
      usage[id] = entry;
    }
    if (reset) {
      c.call = 0;
      c.get = 0;
      c.set = 0;
    }
  }
  return usage;
}

module.exports = { install, hasDom, getRegistry, snapshot, REGISTRY };
