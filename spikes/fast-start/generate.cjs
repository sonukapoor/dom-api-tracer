// Generate fastdom.cjs: a spike of a fast-start DOM with jsdom's shape
// (219 interfaces, 3,710 members). Core behaviour (tree, attributes, text,
// events, createElement, a few selectors) is real; every other member is a
// generated stand-in of realistic size, so load and setup costs are honest.
//
// Design under test: the implementation (property descriptors) is built once
// per process; createWindow() gives each window its own prototype objects and
// constructors (so a test patching HTMLElement.prototype cannot leak into the
// next file) by copying those descriptors onto fresh objects.
const fs = require('node:fs');
const shapes = require('./shapes.json');

const core = String.raw`
'use strict';
const children = (n) => n.__c || (n.__c = []);
function insert(parent, node, ref) {
  if (node.__p) remove(node.__p, node);
  const list = children(parent);
  const i = ref ? list.indexOf(ref) : -1;
  if (i < 0) list.push(node); else list.splice(i, 0, node);
  node.__p = parent;
  return node;
}
function remove(parent, node) {
  const list = children(parent);
  const i = list.indexOf(node);
  if (i >= 0) list.splice(i, 1);
  node.__p = null;
  return node;
}
function text(n) {
  if (n.nodeType === 3) return n.__d;
  let s = '';
  for (const c of children(n)) s += text(c);
  return s;
}
function matches(el, sel) {
  if (sel[0] === '#') return el.getAttribute('id') === sel.slice(1);
  if (sel[0] === '.') return (' ' + (el.getAttribute('class') || '') + ' ').includes(' ' + sel.slice(1) + ' ');
  return el.__t === sel.toLowerCase();
}
function find(root, sel, all, out) {
  for (const c of children(root)) {
    if (c.nodeType === 1) {
      if (matches(c, sel)) { out.push(c); if (!all) return out; }
      find(c, sel, all, out);
      if (!all && out.length) return out;
    }
  }
  return out;
}
const CORE = {
  EventTarget: {
    addEventListener(type, fn) { const m = this.__l || (this.__l = new Map()); const s = m.get(type) || []; if (!s.includes(fn)) s.push(fn); m.set(type, s); },
    removeEventListener(type, fn) { const s = this.__l && this.__l.get(type); if (s) { const i = s.indexOf(fn); if (i >= 0) s.splice(i, 1); } },
    dispatchEvent(ev) {
      ev.__target = this;
      for (let n = this; n && !ev.__stop; n = ev.bubbles ? n.__p : null) {
        ev.__current = n;
        for (const fn of [...((n.__l && n.__l.get(ev.type)) || [])]) typeof fn === 'function' ? fn.call(n, ev) : fn.handleEvent(ev);
      }
      return !ev.defaultPrevented;
    },
  },
  Node: {
    get nodeType() { return this.__nt; },
    get parentNode() { return this.__p || null; },
    get parentElement() { const p = this.__p; return p && p.nodeType === 1 ? p : null; },
    get childNodes() { return children(this).slice(); },
    get firstChild() { return children(this)[0] || null; },
    get lastChild() { const l = children(this); return l[l.length - 1] || null; },
    get nextSibling() { const l = this.__p ? children(this.__p) : []; return l[l.indexOf(this) + 1] || null; },
    get ownerDocument() { return this.__doc || null; },
    get textContent() { return text(this); },
    set textContent(v) { for (const c of children(this).slice()) remove(this, c); if (v !== '') insert(this, this.__doc.createTextNode(String(v))); },
    appendChild(n) { return insert(this, n, null); },
    insertBefore(n, ref) { return insert(this, n, ref); },
    removeChild(n) { return remove(this, n); },
    contains(n) { for (; n; n = n.__p) if (n === this) return true; return false; },
    hasChildNodes() { return children(this).length > 0; },
  },
  Element: {
    get tagName() { return this.__t.toUpperCase(); },
    get localName() { return this.__t; },
    get id() { return this.getAttribute('id') || ''; },
    get className() { return this.getAttribute('class') || ''; },
    set className(v) { this.setAttribute('class', v); },
    get children() { return children(this).filter((c) => c.nodeType === 1); },
    get innerHTML() { return ''; },
    getAttribute(k) { const a = this.__a; return a && a.has(k) ? a.get(k) : null; },
    setAttribute(k, v) { (this.__a || (this.__a = new Map())).set(k, String(v)); },
    hasAttribute(k) { return !!(this.__a && this.__a.has(k)); },
    removeAttribute(k) { if (this.__a) this.__a.delete(k); },
    querySelector(s) { return find(this, s, false, [])[0] || null; },
    querySelectorAll(s) { return find(this, s, true, []); },
    matches(s) { return matches(this, s); },
    remove() { if (this.__p) remove(this.__p, this); },
  },
  CharacterData: {
    get data() { return this.__d; },
    set data(v) { this.__d = String(v); },
  },
  Document: {
    get body() { return this.__body; },
    get head() { return this.__head; },
    get documentElement() { return this.__html; },
    createElement(tag) { return this.__win.__make(String(tag).toLowerCase()); },
    createTextNode(d) { const t = Object.create(this.__win.__protos.Text); t.__nt = 3; t.__d = String(d); t.__doc = this; return t; },
    getElementById(id) { return find(this, '#' + id, false, [])[0] || null; },
    querySelector(s) { return find(this, s, false, [])[0] || null; },
    querySelectorAll(s) { return find(this, s, true, []); },
  },
  Event: {
    get type() { return this.__type; },
    get bubbles() { return !!this.__init.bubbles; },
    get target() { return this.__target || null; },
    get currentTarget() { return this.__current || null; },
    get defaultPrevented() { return !!this.__prevented; },
    preventDefault() { if (this.__init.cancelable) this.__prevented = true; },
    stopPropagation() { this.__stop = true; },
  },
};
CORE.HTMLDocument = CORE.Document; // jsdom exposes HTMLDocument as an alias of Document
`;

// Stand-ins: realistic per-member code size (a real implementation of the
// ~800 used members plus spec plumbing would be at least this big).
let stubs = 'const STUBS = {\n';
for (const iface of shapes) {
  stubs += `  ${JSON.stringify(iface.name)}: {\n`;
  for (const [key, kind] of iface.members) {
    const k = JSON.stringify(key);
    if (kind === 'm') stubs += `    ${k}: { value: function (a, b, c) { if (this == null) throw new TypeError('Illegal invocation'); const s = this.__s || (this.__s = Object.create(null)); return s[${k}] === undefined ? undefined : s[${k}](a, b, c); }, writable: true, configurable: true },\n`;
    else stubs += `    ${k}: { get() { const s = this.__s; return s && ${k} in s ? s[${k}] : null; },${kind === 'gs' ? ` set(v) { (this.__s || (this.__s = Object.create(null)))[${k}] = v; },` : ''} configurable: true, enumerable: true },\n`;
  }
  stubs += '  },\n';
}
stubs += '};\n';

const rest = String.raw`
const SHAPES = ${JSON.stringify(shapes.map((s) => [s.name, s.parent]))};
// Descriptors per interface, built once per process: stand-ins overridden by core.
const DESCRIPTORS = {};
for (const [name] of SHAPES) {
  const d = Object.assign({}, STUBS[name]);
  if (CORE[name]) Object.assign(d, Object.getOwnPropertyDescriptors(CORE[name]));
  DESCRIPTORS[name] = d;
}
const ORDER = []; // parents before children
{ const seen = new Set(); const by = new Map(SHAPES);
  const visit = (n) => { if (seen.has(n) || !by.has(n)) return; seen.add(n); visit(by.get(n)); ORDER.push(n); };
  for (const [n] of SHAPES) visit(n); }
const PARENT = new Map(SHAPES);
const TAGS = { div: 'HTMLDivElement', span: 'HTMLSpanElement', p: 'HTMLParagraphElement', a: 'HTMLAnchorElement', button: 'HTMLButtonElement',
  input: 'HTMLInputElement', ul: 'HTMLUListElement', li: 'HTMLLIElement', form: 'HTMLFormElement', label: 'HTMLLabelElement',
  html: 'HTMLHtmlElement', head: 'HTMLHeadElement', body: 'HTMLBodyElement', img: 'HTMLImageElement', table: 'HTMLTableElement' };

function createWindow() {
  const win = Object.create(null);
  const protos = Object.create(null);
  for (const name of ORDER) {
    const parent = PARENT.get(name);
    const proto = Object.create(parent && protos[parent] ? protos[parent] : Object.prototype);
    Object.defineProperties(proto, DESCRIPTORS[name]);
    const ctor = name === 'Event'
      ? function Event(type, init) { const e = Object.create(ctor.prototype); e.__type = String(type); e.__init = init || {}; return e; }
      : function () { throw new TypeError('Illegal constructor'); };
    Object.defineProperty(ctor, 'name', { value: name });
    ctor.prototype = proto;
    Object.defineProperty(proto, 'constructor', { value: ctor, writable: true, configurable: true });
    protos[name] = proto;
    win[name] = ctor;
  }
  const doc = Object.create(protos.HTMLDocument || protos.Document);
  doc.__nt = 9; doc.__win = win; doc.__doc = doc;
  win.__protos = protos;
  win.__make = (tag) => { const el = Object.create(protos[TAGS[tag] || 'HTMLElement']); el.__nt = 1; el.__t = tag; el.__doc = doc; return el; };
  doc.__html = doc.appendChild(win.__make('html'));
  doc.__head = doc.__html.appendChild(win.__make('head'));
  doc.__body = doc.__html.appendChild(win.__make('body'));
  win.document = doc;
  win.window = win;
  return win;
}
module.exports = { createWindow };
`;

fs.writeFileSync(__dirname + '/fastdom.cjs', core + stubs + rest);
console.log(`wrote fastdom.cjs, ${(fs.statSync(__dirname + '/fastdom.cjs').size / 1024).toFixed(0)} KB`);
