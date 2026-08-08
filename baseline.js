#!/usr/bin/env node
/**
 * baseline.js — characterization ("golden") baseline for the parsing engine.
 *
 * Run:    node baseline.js            compare current behaviour to the golden
 *         node baseline.js --update   re-record the golden (deliberate change)
 *         node baseline.js -v         also print the first differing case in full
 *
 * WHY THIS EXISTS, SEPARATELY FROM test.js
 * test.js asserts what the code SHOULD do — each test encodes an intention.
 * This file asserts only what the code CURRENTLY does: every case is run, its
 * full output serialized, and the result compared byte-for-byte against
 * baseline.golden.json. It has no opinion about whether the behaviour is right.
 *
 * That is exactly what makes it useful before a large rework. A refactor that
 * changes one cursor calculation shows up here as a diff in every case that
 * touches it, including the ones nobody thought to write a test for. When a
 * change is intentional, --update re-records and the DIFF ITSELF is reviewed in
 * git, so behaviour changes become visible in code review instead of silent.
 *
 * Recorded per case: every field's id, byte span, length, value, declared type,
 * override state, error and issue, plus the final cursor. Cursor position is captured
 * deliberately — sequential reads are the thing most likely to break when
 * explicit positioning is added.
 */

'use strict';
const fs     = require('fs');
const vm     = require('vm');
const path   = require('path');

const GOLDEN = path.join(__dirname, 'baseline.golden.json');
const UPDATE  = process.argv.includes('--update');
const VERBOSE = process.argv.includes('-v') || process.argv.includes('--verbose');

// ── Sandbox ─────────────────────────────────────────────────────────────────
// Deliberately a copy of test.js's loader rather than a shared import: if one
// harness breaks, the other still runs, and the baseline stays trustworthy when
// the unit suite is mid-refactor.
const html  = fs.readFileSync(path.join(__dirname, 'source.html'), 'utf8');
const match = html.match(/<script id="app">([\s\S]*?)<\/script>/);
if (!match) { console.error('FATAL: <script id="app"> not found in source.html'); process.exit(1); }

const elStubs = Object.create(null);
const domElStore = new Map();
const domEl = new Proxy(function () {}, {
  get: (target, k) => {
    if (domElStore.has(k)) return domElStore.get(k);
    if (k === 'addEventListener' || k === 'removeEventListener') return () => {};
    if (k === 'getElementById') return id => elStubs[id] || domEl;
    if (k === 'querySelectorAll') return () => [];
    if (k === 'classList') return { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
    if (k === 'style') return {};
    if (k === 'toString' || k === Symbol.toPrimitive) return () => '';
    return domEl;
  },
  set: (target, k, v) => { domElStore.set(k, v); return true; },
  apply: () => domEl,
  construct: () => domEl,
});
const storage = {
  _data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
};

const sandbox = vm.createContext({
  console, setTimeout: () => {}, clearTimeout: () => {}, setInterval: () => {},
  clearInterval: () => {}, requestAnimationFrame: () => {}, cancelAnimationFrame: () => {},
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  Math, JSON, Array, Object, Map, Set, WeakMap, WeakSet, RegExp, Uint8Array, Buffer,
  String, Number, Boolean, Symbol, Date, Promise, Error, BigInt,
  document: domEl, window: domEl, localStorage: storage,
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  location: { reload: () => {} },
  getComputedStyle: () => new Proxy({}, { get: () => '' }),
  _t: {},
});

try {
  vm.runInContext(match[1] + `
    _t.meExecParseSpec  = _meExecParseSpec;
    _t.migrateOverrides = window._migrateSpecOverrides;
    _t.parseHPEDDL      = parseHPEDDL;
    _t.buildDDLDocFields= buildDDLDocFields;
    _t.parseFlatMessage = parseFlatMessage;
    _t.detectFormat     = detectFormat;
    _t.extractBytes     = extractBytes;
    _t.buildRepoTypeRegistry    = buildRepoTypeRegistry;
    _t.buildRepoSectionRegistry = buildRepoSectionRegistry;
    _t.S = S;
  `, sandbox, { timeout: 10000 });
} catch (e) {
  console.error('FATAL: app script failed to initialize:', e.message);
  process.exit(1);
}

const {
  meExecParseSpec: _rawExecParseSpec, parseHPEDDL, buildDDLDocFields, parseFlatMessage,
  detectFormat, extractBytes, buildRepoTypeRegistry, buildRepoSectionRegistry, S,
  migrateOverrides,
} = sandbox._t;

// Cases below are written with de_map / var_length_groups / field_overrides —
// the shape a spec has on disk. The app folds those into `overrides` when it
// loads a spec, so the harness folds them at the door too. Without this the
// golden would appear to drift purely because the corpus speaks the old shape,
// and re-recording would silently bless a real loss of DE anchors.
const meExecParseSpec = (item, ...rest) => _rawExecParseSpec(migrateOverrides(item), ...rest);

// ── Serialization ───────────────────────────────────────────────────────────
// Field shape is captured in full. Anything that drifts — an offset, a value, a
// newly-emitted or newly-suppressed row, an error message — changes the record.
const clip = s => { s = String(s); return s.length > 160 ? s.slice(0, 160) + '…' : s; };

function serField(f) {
  const o = { id: f.id ?? null };
  if (f.startByte != null)     o.start   = f.startByte;
  if (f.endByte != null)       o.end     = f.endByte;
  if (f.length != null)        o.len     = f.length;
  if (f.value !== undefined)   o.value   = clip(f.value);
  if (f.rawHex)                o.hex     = clip(f.rawHex);
  if (f.dataType)              o.type    = f.dataType;
  if (f.typeOverride)          o.tOvr    = f.typeOverride;
  if (f.displayOverride)       o.dOvr    = f.displayOverride;
  if (f.displayValue !== undefined) o.disp = clip(f.displayValue);
  if (f.isRedefines)           o.redef   = true;
  if (f.bitSet)                o.bits    = Array.from(f.bitSet).sort((a, b) => a - b);
  if (f.error)                 o.error   = clip(f.error);
  if (f.issue)                 o.issue   = clip(f.issue);
  return o;
}
function serCtx(ctx) {
  const o = { cursor: ctx.cursor, fields: (ctx.fields || []).map(serField) };
  // token-area writes to ctx.tokens and touches no field, so without this its
  // cases record an empty object and lock in nothing at all.
  if (ctx.tokens) o.tokens = ctx.tokens.map(t => ({ id: t.id, value: clip(t.value ?? '') }));
  return o;
}

// ── Corpus ──────────────────────────────────────────────────────────────────
const CASES = [];
const kase = (group, name, fn) => CASES.push({ key: `${group} :: ${name}`, fn });

const bytesOf = v => (typeof v === 'string' ? Buffer.from(v, 'binary') : Uint8Array.from(v));
const hexOf   = h => Uint8Array.from(h.replace(/\s+/g, '').match(/../g).map(b => parseInt(b, 16)));

/** Run a parse_spec against a DDL and return the serialized context. */
function runSpec(ddl, defPath, blocks, input, opts) {
  S.ddlTree = ddl ? { V: { S: { D: ddl } } } : {};
  S.inputFormat = (opts && opts.format) || 'hex';
  const item = {
    name: 'BASE', type: 'BASE',
    ddl_bindings: defPath ? [`V/S/D/${defPath}`] : [],
    parse_spec_binary: blocks,
  };
  return serCtx(meExecParseSpec(item, bytesOf(input), opts));
}

// ── DDL fixtures ────────────────────────────────────────────────────────────
const DDL_FLAT = `DEF REC.
  02 HEAD PIC X(2).
  02 CNT  PIC X(1).
  02 BODY PIC X(4).
END REC.
`;

const DDL_TYPES = `DEF REC.
  02 A PIC X(3).
  02 B PIC 9(4).
  02 C PIC S9(4) COMP.
  02 D TYPE BINARY 16.
  02 E TYPE BINARY 32.
  02 F PIC 9(3)V99.
END REC.
`;

const DDL_OCCURS = `DEF REC.
  02 N PIC 9(2).
  02 GRP OCCURS 3 TIMES.
    03 K PIC X(2).
    03 V PIC X(3).
END REC.
`;

const DDL_REDEF = `DEF REC.
  02 A PIC X(8).
  02 B REDEFINES A.
    03 B1 PIC X(4).
    03 B2 PIC X(4).
  02 TAIL PIC X(2).
END REC.
`;

const DDL_ISO = `DEF MSG.
  02 TYP PIC X(4).
  02 PRI-BIT-MAP PIC X(16).
  02 DE-2 PIC X(4).
  02 DE-3 PIC X(6).
  02 DE-4 PIC X(6).
END MSG.
`;

const DDL_NESTED_BM = `DEF BICW.
  02 ISOPSEM.
    03 TYP PIC X(4).
    03 PRI-BIT-MAP PIC X(16).
  02 TRAILER PIC X(2).
END
`;

const DDL_SEG = `DEF FILEREC.
  02 SEG0.
    03 NAME PIC X(10).
  02 SEG1.
    03 NAME PIC X(10).
  02 SEG5.
    03 NAME PIC X(10).
END FILEREC.
`;

// ── 1. Sequential cursor behaviour, per block type ──────────────────────────
// The default "each block continues where the last stopped" contract. This is
// the single most important thing to hold still while positioning is added.

for (const len of [1, 2, 3, 4, 8]) {
  kase('cursor/read-fixed', `length ${len} then read-to-end`, () =>
    runSpec(null, null, [
      { 'read-fixed': { length: len, as: 'A' } },
      { 'read-to-end': { as: 'REST' } },
    ], 'ABCDEFGHIJ'));
}

for (const n of [0, 1, 5, 99]) {
  kase('cursor/skip', `skip ${n} then read-to-end`, () =>
    runSpec(null, null, [
      { skip: n },
      { 'read-to-end': { as: 'REST' } },
    ], 'ABCDEFGHIJ'));
}

for (const s of ['0x26', '0x00', 'Z']) {
  kase('cursor/read-until', `sentinel ${s}`, () =>
    runSpec(null, null, [
      { 'read-until': { sentinels: [s], eom: true, as: 'U' } },
      { 'read-to-end': { as: 'REST' } },
    ], 'AB&CDZEF'));
}

for (const pfx of ['uint8', 'uint16-be', 'uint16-le', 'bcd2']) {
  kase('cursor/read-length-prefix', `prefix ${pfx}`, () =>
    runSpec(null, null, [
      { 'read-length-prefix': { prefix: pfx, as: 'P' } },
      { 'read-to-end': { as: 'REST' } },
    ], hexOf('00 03 41 42 43 44 45 46 47')));
}

kase('cursor/read-ddl', 'walks every field in declaration order', () =>
  runSpec(DDL_FLAT, 'REC', [{ 'read-ddl': 'ANY' }], 'HH2ABCD'));

kase('cursor/read-ddl', 'field filter still advances the cursor past all', () =>
  runSpec(DDL_FLAT, 'REC', [
    { 'read-ddl': { fields: ['HEAD'] } },
    { 'read-to-end': { as: 'REST' } },
  ], 'HH2ABCD'));

kase('cursor/read-ddl', 'from/until window', () =>
  runSpec(DDL_FLAT, 'REC', [{ 'read-ddl': { from: 'CNT', until: 'BODY' } }], 'HH2ABCD'));

kase('cursor/repeat', 'literal count', () =>
  runSpec(null, null, [
    { repeat: { count: 3, body: [{ 'read-fixed': { length: 2, as: 'IT' } }] } },
    { 'read-to-end': { as: 'REST' } },
  ], 'AABBCCDD'));

kase('cursor/repeat', 'count from a field', () =>
  runSpec(DDL_FLAT, 'REC', [
    { 'read-ddl': { fields: ['HEAD', 'CNT'] } },
    { repeat: { count: 'CNT', body: [{ 'read-fixed': { length: 2, as: 'IT' } }] } },
    { 'read-to-end': { as: 'REST' } },
  ], 'HH2AABBZZ'));

kase('cursor/repeat', 'count of zero consumes nothing', () =>
  runSpec(null, null, [
    { repeat: { count: 0, body: [{ 'read-fixed': { length: 2, as: 'IT' } }] } },
    { 'read-to-end': { as: 'REST' } },
  ], 'ABCDEF'));

for (const [flag, label] of [['1', 'then branch'], ['0', 'else branch']]) {
  kase('cursor/when', label, () =>
    runSpec(null, null, [
      { 'read-fixed': { length: 1, as: 'FLAG' } },
      { when: { field: 'FLAG', not: '0',
                then: [{ 'read-fixed': { length: 3, as: 'T' } }],
                else: [{ 'read-fixed': { length: 1, as: 'E' } }] } },
      { 'read-to-end': { as: 'REST' } },
    ], flag + 'XYZQQ'));
}

kase('cursor/read-while', 'guard stops the loop', () =>
  runSpec(null, null, [
    { 'read-while': { while: { type: 'literal', value: '&' },
                      body: [{ 'read-fixed': { length: 3, as: 'IT' } }] } },
    { 'read-to-end': { as: 'REST' } },
  ], '&AB&CDEND'));

kase('cursor/read-while', 'max caps the loop', () =>
  runSpec(null, null, [
    { 'read-while': { max: 2, while: { type: 'literal', value: '&' },
                      body: [{ 'read-fixed': { length: 3, as: 'IT' } }] } },
    { 'read-to-end': { as: 'REST' } },
  ], '&AB&CD&EFEND'));

// ── 2. Overruns and error paths ─────────────────────────────────────────────
kase('errors', 'read-fixed past the end', () =>
  runSpec(null, null, [{ 'read-fixed': { length: 50, as: 'A' } }], 'ABC'));

kase('errors', 'length prefix larger than what remains', () =>
  runSpec(null, null, [{ 'read-length-prefix': { prefix: 'uint16-be', as: 'P' } }], hexOf('99 99 41 42')));

kase('errors', 'unknown block type', () =>
  runSpec(null, null, [{ 'read-nothing': { field: 'X' } }], 'ABC'));

kase('errors', 'repeat count field missing', () =>
  runSpec(null, null, [{ repeat: { count: 'NOPE', body: [{ 'read-fixed': { length: 1, as: 'I' } }] } }], 'ABC'));

kase('errors', 'read-tlv on a buffer that was never read', () =>
  runSpec(null, null, [{ 'read-tlv': { field: 'GHOST', tag_length: 1, length_length: 1 } }], 'ABC'));

// ── 3. TLV, as it behaves today ─────────────────────────────────────────────
// Locked in before the BER rework so any change to fixed-width framing is visible.
for (const [tl, ll, label] of [[1, 1, '1-byte tag, 1-byte len'], [2, 1, '2-byte tag, 1-byte len'], [2, 2, '2-byte tag, 2-byte len']]) {
  kase('tlv/fixed-width', label, () =>
    runSpec(null, null, [
      { 'read-fixed': { length: 12, as: 'BUF' } },
      { 'read-tlv': { field: 'BUF', tag_length: tl, length_length: ll } },
    ], hexOf('9F26 02 41 42 9F36 02 43 44 00 00 00 00')));
}

kase('tlv/fixed-width', 'ascii-hex encoded buffer', () =>
  runSpec(null, null, [
    { 'read-fixed': { length: 12, as: 'BUF' } },
    { 'read-tlv': { field: 'BUF', tag_length: 1, length_length: 1, encoding: 'ascii-hex' } },
  ], '9F02414242'));

kase('tlv/fixed-width', 'truncated final triple is dropped', () =>
  runSpec(null, null, [
    { 'read-fixed': { length: 7, as: 'BUF' } },
    { 'read-tlv': { field: 'BUF', tag_length: 1, length_length: 1 } },
  ], hexOf('9F 02 41 42 5A 09 FF')));

// ── 4. Bitmaps ──────────────────────────────────────────────────────────────
for (const enc of ['ascii-hex', 'hex']) {
  kase('bitmap/wire', `primary only, ${enc}`, () =>
    runSpec(DDL_ISO, 'MSG', [
      { 'read-fixed': { length: 4, as: 'TYP' } },
      { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: enc } },
    ], '02007000000000000000rest'));
}

kase('bitmap/wire', 'secondary present (bit 0 set)', () =>
  runSpec(DDL_ISO, 'MSG', [
    { 'read-fixed': { length: 4, as: 'TYP' } },
    { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'ascii-hex' } },
  ], '0200F000000000000000' + '0000000000000000' + 'rest'));

kase('bitmap/wire', 'nested bitmap resolved by qualified path', () =>
  runSpec(DDL_NESTED_BM, 'BICW', [
    { 'read-bitmap': { field: 'ISOPSEM.PRI-BIT-MAP', encoding: 'ascii-hex' } },
  ], '0000000000000000'));

kase('bitmap/wire', 'bare leaf name rejected when nested', () =>
  runSpec(DDL_NESTED_BM, 'BICW', [
    { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'ascii-hex' } },
  ], '0000000000000000'));

kase('bitmap/wire', 'unbound spec reads generically', () =>
  runSpec(null, null, [
    { 'read-bitmap': { field: 'ANY-MAP', encoding: 'ascii-hex' } },
  ], '0000000000000000'));

kase('bitmap/wire', 'message too short for a bitmap', () =>
  runSpec(null, null, [{ 'read-bitmap': { field: 'BM', encoding: 'ascii-hex' } }], 'short'));

kase('bitmap/fields', 'DEs read in bit order', () =>
  runSpec(DDL_ISO, 'MSG', [
    { 'read-fixed': { length: 4, as: 'TYP' } },
    { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'ascii-hex' } },
    { 'read-bitmap-fields': 'PRI-BIT-MAP' },
  ], '02007000000000000000' + '2222' + '333333' + '444444'));

kase('bitmap/fields', 'missing bitmap reference errors', () =>
  runSpec(DDL_ISO, 'MSG', [{ 'read-bitmap-fields': 'NOPE' }], '0200'));

// ── 5. Segment maps (Base24) ────────────────────────────────────────────────
for (const [val, label] of [['C0000000', 'SEG0+SEG1'], ['80000000', 'SEG0 only'], ['00000000', 'none set']]) {
  kase('segmap/declared', label, () =>
    runSpec(DDL_SEG, 'FILEREC', [
      { 'read-bitmap': { field: 'SEG-MAP', bits: 32, value: val, encoding: 'ascii-hex' } },
      { 'read-segment-fields': 'SEG-MAP' },
    ], 'AAAAAAAAAABBBBBBBBBBCCCCCCCCCC'));
}

kase('segmap/declared', 'malformed map value', () =>
  runSpec(DDL_SEG, 'FILEREC', [
    { 'read-bitmap': { field: 'SEG-MAP', bits: 32, value: 'ZZZZ', encoding: 'ascii-hex' } },
    { 'read-segment-fields': 'SEG-MAP' },
  ], 'AAAAAAAAAA'));

// ── 6. DDL compilation ──────────────────────────────────────────────────────
const typeReg = buildRepoTypeRegistry();
const secReg  = buildRepoSectionRegistry();
function runDDL(ddl, defName) {
  S.ddlTree = { V: { S: { D: ddl } } };
  const defs = parseHPEDDL(ddl, typeReg, secReg, defName);
  return { count: defs.length, defs: defs.map(d => ({
    id: d.id, offset: d.offset, length: d.length, type: d.dataType,
    group: !!d.isGroup, redef: !!d.isRedefines, occurs: d.occurs ?? null,
  })) };
}

for (const [name, ddl, def] of [
  ['flat', DDL_FLAT, 'REC'],
  ['pic types', DDL_TYPES, 'REC'],
  ['occurs', DDL_OCCURS, 'REC'],
  ['redefines', DDL_REDEF, 'REC'],
  ['iso layout', DDL_ISO, 'MSG'],
  ['nested group', DDL_NESTED_BM, 'BICW'],
  ['segmented file', DDL_SEG, 'FILEREC'],
]) {
  kase('ddl/compile', name, () => runDDL(ddl, def));
}

for (const [name, ddl, def] of [
  ['flat', DDL_FLAT, 'REC'],
  ['occurs', DDL_OCCURS, 'REC'],
  ['redefines', DDL_REDEF, 'REC'],
]) {
  kase('ddl/doc-fields', name, () => {
    const defs = parseHPEDDL(ddl, typeReg, secReg, def);
    const { fields, totalSize } = buildDDLDocFields(defs, typeReg);
    return { totalSize, fields: fields.map(f => ({
      q: f.qualName, off: f.offset, size: f.size, type: f.dataType,
      grp: !!f.isGroup, redef: !!f.isRedefines, occ: f.occurs ?? null,
    })) };
  });
}

// ── 7. Reading a DDL against real bytes, per input format ───────────────────
for (const fmt of ['hex', 'ascii', 'ebcdic', 'tandem-dump']) {
  kase('formats/read-ddl', fmt, () =>
    runSpec(DDL_TYPES, 'REC', [{ 'read-ddl': 'ANY' }],
            hexOf('414243 30303132 0064 0100 00000100 3132333435'), { format: fmt }));
}

// ── 8. Format detection and byte extraction ─────────────────────────────────
const SAMPLES = {
  'plain hex':        '41 42 43 44 45 46',
  'hex no spaces':    '414243444546',
  'ascii text':       'HELLO WORLD',
  'tandem dump':      '      0: 4142 4344 4546 4748 [ABCDEFGH]',
  'raw dump':         '00000000: 41 42 43 44  |ABCD|',
  'octal':            '%101 %102 %103',
  'empty':            '',
  'mixed junk':       'not a message at all ###',
};
for (const [name, text] of Object.entries(SAMPLES)) {
  kase('format/detect', name, () => {
    const fmt = detectFormat(text);
    let bytes = null, err = null;
    try { bytes = Array.from(extractBytes(text, fmt) || []); }
    catch (e) { err = clip(e.message); }
    return { fmt, len: bytes ? bytes.length : null, first16: bytes ? bytes.slice(0, 16) : null, err };
  });
}

// ── 9. Legacy flat parser ───────────────────────────────────────────────────
for (const [name, ddl, def, input] of [
  ['flat', DDL_FLAT, 'REC', 'HH2ABCD'],
  ['pic types', DDL_TYPES, 'REC', 'ABC01230064' + ' ' + '0000010012345'],
  ['occurs', DDL_OCCURS, 'REC', '03AAaaaBBbbbCCccc'],
  ['redefines', DDL_REDEF, 'REC', '12345678TL'],
]) {
  kase('legacy/parseFlatMessage', name, () => {
    const defs = parseHPEDDL(ddl, typeReg, secReg, def);
    const out  = parseFlatMessage(bytesOf(input), defs);
    return { fields: (out.fields || out || []).map(serField) };
  });
}

// ── 10. Attribute combinations, generated ───────────────────────────────────
// Every declared attribute of every block, crossed with every other attribute of
// that block. Domains carry three kinds of value on purpose: valid ones, edge
// ones (0, empty, absent) and invalid ones (a field id that does not exist, a
// bad enum). Error behaviour is as much a part of the contract as success, and
// it is where a refactor drifts most quietly.
//
// `undefined` in a domain means THE ATTRIBUTE IS OMITTED, so each product also
// covers every subset of optional attributes, not just every value of them.

function product(domains) {
  const keys = Object.keys(domains);
  let rows = [{}];
  for (const k of keys) {
    const next = [];
    for (const row of rows) for (const v of domains[k]) next.push({ ...row, [k]: v });
    rows = next;
  }
  return rows;
}
const label = combo => Object.entries(combo)
  .map(([k, v]) => `${k}=${v === undefined ? '-' : JSON.stringify(v)}`).join(' ');

/**
 * Generate one case per attribute combination.
 *   type    block type under test
 *   domains attribute → values (undefined = omitted)
 *   ctxFor  combo → { ddl, def, before, input, format }
 */
function combos(type, domains, ctxFor) {
  for (const combo of product(domains)) {
    const attrs = {};
    for (const [k, v] of Object.entries(combo)) if (v !== undefined) attrs[k] = v;
    const c = ctxFor(combo) || {};
    kase(`combo/${type}`, label(combo), () =>
      runSpec(c.ddl ?? null, c.def ?? null,
              [...(c.before || []), { [type]: attrs }],
              c.input ?? 'ABCDEFGHIJKLMNOP',
              c.format ? { format: c.format } : undefined));
  }
}

// DDL_FLAT is 7 bytes and read-ddl advances past all of them even when the
// output is filtered, so the input carries a tail for the block under test to
// actually read. Without it every combo after a read-ddl records the same
// "exceeds the 0 byte(s) left" error and the product tests nothing.
const FLAT = { ddl: DDL_FLAT, def: 'REC', input: 'HH2ABCD' + 'PAYLOAD-0123456789' };
const HEAD_CNT = [{ 'read-ddl': { fields: ['HEAD', 'CNT'] } }];

combos('read-ddl', {
  binding: [undefined, 'ANY', 0, 1],
  fields:  [undefined, 'ANY', ['HEAD'], ['HEAD', 'BODY'], ['NOPE']],
  from:    [undefined, 'CNT', 'NOPE'],
  until:   [undefined, 'BODY', 'NOPE'],
}, () => FLAT);

combos('read', {
  field: ['HEAD', 'BODY', 'NOPE'],
  type:  [undefined, 'uint-be', 'uint-le', 'binary', 'ascii', 'ebcdic',
          'hex-char', 'hex-ascii-decimal', 'hex-ebcdic-decimal', 'bogus'],
}, () => FLAT);

combos('read-fixed', {
  length:   [1, 2, 'CNT', 'NOPE', 0],
  type:     [undefined, 'X', '9', 'BINARY'],
  encoding: [undefined, 'ascii', 'ebcdic', 'bcd'],
  as:       [undefined, 'OUT'],
}, () => ({ ...FLAT, before: HEAD_CNT }));

combos('read-until', {
  sentinels: [undefined, ['0x26'], ['0x00', 'Z'], ['nope']],
  eom:       [undefined, true, false],
  as:        [undefined, 'U'],
}, () => ({ input: 'AB&CDZEF' }));

combos('read-length-prefix', {
  prefix:    [undefined, 'uint8', 'uint16-be', 'uint16-le', 'bcd2'],
  as:        [undefined, 'P'],
  sentinels: [undefined, ['0x26']],
  eom:       [undefined, true],
}, () => ({ input: hexOf('00 03 41 42 43 26 44 45 46') }));

combos('read-to-end', { as: [undefined, 'R'] }, () => ({ input: 'ABCDEF' }));

combos('read-bitmap', {
  field:    ['PRI-BIT-MAP', 'NOPE'],
  encoding: [undefined, 'binary', 'ascii-hex', 'hex', 'ascii-bits'],
  bits:     [undefined, 16, 32, 64],
  value:    [undefined, 'C0000000', 'ZZZZ'],
  bit0:     [undefined, 'left', 'right'],
}, () => ({ ddl: DDL_ISO, def: 'MSG', before: [{ 'read-fixed': { length: 4, as: 'TYP' } }],
            input: '02007000000000000000' + '2222' + '333333' + '444444' }));

combos('read-bitmap-fields', {
  bitmap: ['PRI-BIT-MAP', 'NOPE'],
}, () => ({ ddl: DDL_ISO, def: 'MSG',
            before: [{ 'read-fixed': { length: 4, as: 'TYP' } },
                     { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'ascii-hex' } }],
            input: '02007000000000000000' + '2222' + '333333' + '444444' }));

combos('read-segment-fields', {
  binding: [undefined, 0, 1],
}, () => ({ ddl: DDL_SEG, def: 'FILEREC',
            before: [{ 'read-bitmap': { field: 'SEG-MAP', bits: 32, value: 'C0000000', encoding: 'ascii-hex' } }],
            input: 'AAAAAAAAAABBBBBBBBBBCCCCCCCCCC' }));

combos('read-tlv', {
  field:         ['BUF', 'NOPE'],
  tag_length:    [undefined, 1, 2],
  length_length: [undefined, 1, 2],
  encoding:      [undefined, 'binary', 'ascii-hex'],
}, () => ({ before: [{ 'read-fixed': { length: 12, as: 'BUF' } }],
            input: hexOf('9F26 02 41 42 9F36 02 43 44 00 00 00 00') }));

combos('skip', { length: [0, 1, 5, 99, -1, 'CNT'] }, () => ({ ...FLAT, before: HEAD_CNT }));

combos('when', {
  field: ['CNT', 'NOPE'],
  is:    [undefined, '2', ['2', '3']],
  not:   [undefined, '0', ['0']],
  then:  [[{ 'read-fixed': { length: 2, as: 'T' } }]],
  else:  [undefined, [{ 'read-fixed': { length: 1, as: 'E' } }]],
}, () => ({ ...FLAT, before: HEAD_CNT }));

combos('repeat', {
  count: [0, 2, 'CNT', 'NOPE'],
  body:  [[{ 'read-fixed': { length: 2, as: 'IT' } }]],
}, () => ({ ...FLAT, before: HEAD_CNT }));

combos('read-while', {
  while: [undefined, { type: 'literal', value: '&' }, { type: 'literal', value: 'X' }],
  body:  [[{ 'read-fixed': { length: 3, as: 'IT' } }]],
  max:   [undefined, 1, 2, 'CNT'],
}, () => ({ ...FLAT, before: HEAD_CNT, input: 'HH2ABCD' + '&AB&CDEND' }));

combos('token-area', {
  tokens: [undefined, 'ANY', ['T1']],
  from:   [undefined, 'T1'],
  until:  [undefined, 'T1'],
}, () => ({ input: 'HEADER00& ! B8ARQCDATA! P6210920! 24VD0018' }));

// ── 11. Block pairs — cursor hand-off between every self-sufficient block ────
// One block's end position is the next one's start. Positioning work touches
// exactly this seam, so every ordered pair is recorded.
const PAIRABLE = {
  'read-fixed':         { 'read-fixed': { length: 2, as: 'X' } },
  'skip':               { skip: 2 },
  'read-until':         { 'read-until': { sentinels: ['0x26'], eom: true, as: 'U' } },
  'read-to-end':        { 'read-to-end': { as: 'R' } },
  'read-ddl':           { 'read-ddl': 'ANY' },
  'read-length-prefix': { 'read-length-prefix': { prefix: 'uint8', as: 'P' } },
  'read-bitmap':        { 'read-bitmap': { field: 'BM', encoding: 'ascii-hex' } },
  'token-area':         { 'token-area': { tokens: 'ANY' } },
};
for (const [aName, aBlk] of Object.entries(PAIRABLE)) {
  for (const [bName, bBlk] of Object.entries(PAIRABLE)) {
    kase('pair', `${aName} → ${bName}`, () =>
      runSpec(DDL_FLAT, 'REC', [aBlk, bBlk], 'HH2ABCD0000000000000000&TAIL'));
  }
}

// ── 12. New features: positioning, per-bit entries, BER TLV ─────────────────
// Recorded the same way as everything else, so the next change to any of them
// shows up as a diff rather than as a surprise in production.

const DDL_EMV = `DEF REC.
  02 BITMAP PIC X(8).
  02 EMV-ELEMENT.
    04 ARQC.
      06 LEN  PIC X(2).
      06 DATA PIC X(16).
    04 ATC.
      06 TAG  PIC X(4).
      06 LEN  PIC X(2).
      06 DATA PIC X(16).
END REC.
`;
// bitmap(8) | 9F26 len 08 … | 9F36 len 02 … | 82 len 02 …  (82 is a ONE-byte tag)
const EMV_IN = hexOf('4000000000000000 9F26 08 0102030405060708 9F36 02 1234 82 02 5800');

// "at" across every value shape, on several block types
combos('read-fixed', {
  at:     [undefined, 0, 3, 10, 27, 28, 99, -1],
  peek:   [undefined, true, false],
  length: [2],
  as:     ['A'],
}, () => ({ input: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ01' }));

for (const anchor of [
  { field: 'A' }, { field: 'A', offset: 0 }, { field: 'A', offset: 5 },
  { field: 'A', offset: -2 }, { field: 'A', offset: -99 },
  { field: 'A', from: 'start' }, { field: 'A', from: 'start', offset: 2 },
  { field: 'A', from: 'middle' }, { field: 'GHOST' }, { offset: 3 },
]) {
  kase('at/relative', JSON.stringify(anchor), () =>
    runSpec(null, null, [
      { 'read-fixed': { length: 4, as: 'A' } },
      { 'read-fixed': { length: 2, as: 'B', at: anchor } },
      { 'read-fixed': { length: 2, as: 'C' } },
    ], 'ABCDEFGHIJKLMNOPQRSTUVWXYZ01'));
}

for (const blk of ['skip', 'read-to-end', 'read-until', 'read-ddl', 'read-bitmap']) {
  const attrs = { skip: { length: 2 }, 'read-to-end': { as: 'R' },
                  'read-until': { sentinels: ['0x26'], eom: true, as: 'U' },
                  'read-ddl': { fields: ['HEAD'] },
                  'read-bitmap': { field: 'BM', length: 4 } }[blk];
  kase('at/other-blocks', `${blk} at:6`, () =>
    runSpec(DDL_FLAT, 'REC', [{ [blk]: { ...attrs, at: 6 } },
                              { 'read-fixed': { length: 2, as: 'AFTER' } }],
            'HH2ABCD&TAILDATA0000'));
}

combos('read-bitmap', {
  field:  ['WIRE-MAP'],
  length: [undefined, 1, 2, 4, 8, 0, -1],
  at:     [undefined, 0, 4],
}, () => ({ input: hexOf('C0000000 40000000 4142434445464748') }));

// read-tlv: framing × mapping × unknown policy, standalone (explicit buffer)
combos('read-tlv', {
  field:         ['BUF'],
  ber:           [undefined, true],
  tag_length:    [undefined, 1, 2],
  length_length: [undefined, 1],
  tags:          [undefined, {}, { '9F26': { field: 'ARQC' } },
                  { '9F26': { field: 'ARQC' }, '9F36': { field: 'ATC' } },
                  { '9F26': { field: 'NOPE' } }],
  unknown:       [undefined, 'emit', 'skip', 'error', 'bogus'],
}, () => ({ ddl: DDL_EMV, def: 'REC',
            before: [{ 'read-fixed': { length: 20, as: 'BUF', at: 8 } }],
            input: EMV_IN }));

// read-tlv: explicit leaf names, for TLV that is not EMV
combos('read-tlv', {
  field:        ['BUF'],
  ber:          [true],
  tags:         [{ '9F26': { field: 'ARQC' } }],
  tag_field:    [undefined, 'TAG', 'NOSUCH'],
  length_field: [undefined, 'LEN', 'NOSUCH'],
  value_field:  [undefined, 'DATA', 'NOSUCH'],
}, () => ({ ddl: DDL_EMV, def: 'REC',
            before: [{ 'read-fixed': { length: 20, as: 'BUF', at: 8 } }],
            input: EMV_IN }));

// BER length forms — short, and both long forms
for (const [label, lenBytes] of [
  ['short form 0x0A', '0A'], ['long form 81 0A', '81 0A'], ['long form 82 000A', '82 000A'],
  ['long form 81 FF (overruns)', '81 FF'], ['reserved 0x80 (indefinite)', '80'],
]) {
  kase('tlv/ber-length', label, () =>
    runSpec(DDL_EMV, 'REC', [
      { 'read-fixed': { length: 24, as: 'BUF' } },
      { 'read-tlv': { field: 'BUF', ber: true, tags: { '9F26': { field: 'ARQC' } } } },
    ], hexOf(`9F26 ${lenBytes} 0102030405060708090A 000000000000000000000000`)));
}

// per-bit "de" entries
for (const [label, de] of [
  ['bare block list',        { '2': [{ 'read-tlv': { ber: true, tags: { '9F26': { field: 'ARQC' } } } }] }],
  ['object with field',      { '2': { field: 'EMV-ELEMENT', blocks: [{ 'read-tlv': { ber: true, tags: { '9F26': { field: 'ARQC' } } } }] } }],
  ['explicit length window', { '2': { field: 'EMV-ELEMENT', length: 11, blocks: [{ 'read-tlv': { ber: true, tags: { '9F26': { field: 'ARQC' } } } }] } }],
  ['field that does not exist', { '2': { field: 'NOPE', blocks: [{ 'read-to-end': { as: 'X' } }] } }],
  ['entry with no blocks',   { '2': { field: 'EMV-ELEMENT', blocks: [] } }],
  ['bit that is not set',    { '9': [{ 'read-to-end': { as: 'X' } }] }],
  ['non-numeric key',        { 'abc': [{ 'read-to-end': { as: 'X' } }] }],
  ['nested read-fixed then tlv', { '2': { field: 'EMV-ELEMENT', blocks: [
      { 'read-fixed': { length: 3, as: 'PRE' } },
      { 'read-tlv': { ber: true, tags: { '9F36': { field: 'ATC' } }, unknown: 'skip' } }] } }],
]) {
  kase('bitmap-fields/de', label, () =>
    runSpec(DDL_EMV, 'REC', [
      { 'read-bitmap': { field: 'BITMAP', length: 8 } },
      { 'read-bitmap-fields': { bitmap: 'BITMAP', de } },
    ], EMV_IN));
}

// ── 13. Variable-length groups, per length encoding ─────────────────────────
// The corpus had no VLG group with a BINARY length, so the bug where such a
// length parsed as zero — collapsing the group and shifting every later field —
// produced no diff here at all. Covered now.

const DDL_VLG = `DEF MSG.
  02 BITMAP PIC X(8).
  02 EMV.
    04 LEN  PIC X(2).
    04 DATA PIC X(20).
  02 TAIL PIC X(4).
END MSG.
`;
for (const [label, len] of [
  ['binary 0x0005',      [0x00, 0x05]],
  ['binary 0x0014 (=20)',[0x00, 0x14]],
  ['binary 0x0000',      [0x00, 0x00]],
  ['ascii "05"',         [0x30, 0x35]],
  ['ascii "20"',         [0x32, 0x30]],
  ['ascii "99" > payload',[0x39, 0x39]],
  ['binary 0x7FFF absurd',[0x7F, 0xFF]],
  ['mixed 0x30 0xFF',    [0x30, 0xFF]],
]) {
  kase('vlg/length-encoding', label, () => {
    S.ddlTree = { V: { S: { D: DDL_VLG } } };
    S.inputFormat = 'hex';
    const bytes = [0x40, 0, 0, 0, 0, 0, 0, 0, ...len,
                   0x41, 0x42, 0x43, 0x44, 0x45, 0x54, 0x41, 0x49, 0x4C];
    return serCtx(meExecParseSpec({
      name: 'BASE', type: 'BASE', ddl_bindings: ['V/S/D/MSG'],
      de_map: [{ field: 'EMV', de: 2 }],
      parse_spec_binary: [{ 'read-bitmap': { field: 'BITMAP', length: 8 } },
                          { 'read-bitmap-fields': 'BITMAP' }],
    }, Uint8Array.from(bytes)));
  });
}

// ── Run ─────────────────────────────────────────────────────────────────────
const results = {};
const errors  = [];
for (const c of CASES) {
  try { results[c.key] = c.fn(); }
  catch (e) { results[c.key] = { THREW: clip(e.message) }; errors.push(`${c.key}: ${e.message}`); }
}

const stable = obj => JSON.stringify(obj, null, 1);

if (UPDATE || !fs.existsSync(GOLDEN)) {
  fs.writeFileSync(GOLDEN, stable(results) + '\n');
  const n = Object.keys(results).length;
  console.log(`${UPDATE ? 'Re-recorded' : 'Recorded'} baseline: ${n} cases → ${path.basename(GOLDEN)}`);
  if (errors.length) {
    console.log(`\n${errors.length} case(s) threw and were recorded as THREW — check these are expected:`);
    for (const e of errors.slice(0, 20)) console.log('  · ' + e);
  }
  process.exit(0);
}

const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
const nowKeys = Object.keys(results), oldKeys = Object.keys(golden);
const added   = nowKeys.filter(k => !(k in golden));
const removed = oldKeys.filter(k => !(k in results));
const changed = nowKeys.filter(k => k in golden && stable(results[k]) !== stable(golden[k]));

console.log(`baseline: ${nowKeys.length} cases`);
if (!added.length && !removed.length && !changed.length) {
  console.log('  ✓  identical to the recorded baseline — no behaviour drift');
  process.exit(0);
}

if (changed.length) {
  console.log(`\n  ✗  ${changed.length} case(s) BEHAVE DIFFERENTLY:`);
  for (const k of changed) console.log('       ' + k);
}
if (removed.length) {
  console.log(`\n  ✗  ${removed.length} case(s) disappeared from the corpus:`);
  for (const k of removed) console.log('       ' + k);
}
if (added.length) {
  console.log(`\n  +  ${added.length} new case(s) not yet in the baseline:`);
  for (const k of added) console.log('       ' + k);
}
if (VERBOSE && changed.length) {
  const k = changed[0];
  console.log(`\n──── first difference: ${k}\n--- recorded\n${stable(golden[k])}\n+++ current\n${stable(results[k])}`);
} else if (changed.length) {
  console.log('\n  (run with -v to see the first difference in full)');
}
console.log('\nIf these changes are intentional: node baseline.js --update, then review the diff.');
process.exit(1);
