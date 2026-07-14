#!/usr/bin/env node
/**
 * test.js — unit tests for pure logic functions extracted from source.html.
 * Run: node test.js
 */

'use strict';
const fs     = require('fs');
const vm     = require('vm');
const assert = require('assert');

// ── Load the app script into a minimal sandbox ──────────────────────────────
const html  = fs.readFileSync('./source.html', 'utf8');
const match = html.match(/<script id="app">([\s\S]*?)<\/script>/);
if (!match) { console.error('FATAL: <script id="app"> not found in source.html'); process.exit(1); }

// DOM stubs — pure logic functions never call these; they are only used inside
// UI handlers which are never invoked during tests.
const domStub = new Proxy({}, {
  get: () => domStub,
  apply: () => domStub,
  construct: () => domStub,
});
const domEl = new Proxy({}, {
  get: (target, k) => {
    if (k in target) return target[k];
    if (k === 'addEventListener') return () => {};
    if (k === 'removeEventListener') return () => {};
    if (k === 'getElementById') return () => domEl;
    if (k === 'querySelectorAll') return () => [];
    if (k === 'classList') return { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
    if (k === 'style') return {};
    if (typeof k === 'string') return () => domEl;
    return domEl;
  },
  set: (target, k, v) => { target[k] = v; return true; },
});
const storage = {
  _data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
};

const sandbox = vm.createContext({
  // Core JS globals
  console, setTimeout: () => {}, clearTimeout: () => {}, setInterval: () => {},
  clearInterval: () => {}, requestAnimationFrame: () => {}, cancelAnimationFrame: () => {},
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  Math, JSON, Array, Object, Map, Set, WeakMap, WeakSet, RegExp, Uint8Array,
  String, Number, Boolean, Symbol, Date, Promise, Error, BigInt,
  // DOM stubs
  document: domEl,
  window:   domEl,
  localStorage: storage,
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  location: { reload: () => {} },
  // Test export slot
  _t: {},
});

// Run the app script in the sandbox, then expose the pure functions we want to test.
const appSrc = match[1] + `
_t.picSize            = picSize;
_t.typeSize           = typeSize;
_t.buildDDLDocFields  = buildDDLDocFields;
_t.expandTypeRefs     = expandTypeRefs;
_t.parseDDLSections   = parseDDLSections;
_t.parseHPEDDL        = parseHPEDDL;
_t.isHPEDDLText       = isHPEDDLText;
_t.parseFlatMessage   = parseFlatMessage;
_t.parseSimpleDDL     = parseSimpleDDL;
_t.validateDDLErrors  = validateDDLErrors;
_t.normalizeDataType  = normalizeDataType;
_t.validateFieldContent = validateFieldContent;
_t.buildRedefSkipSet  = buildRedefSkipSet;
_t.detectFormat       = detectFormat;
_t.isHexAsciiLine     = isHexAsciiLine;
_t.hexAsciiStartCol   = hexAsciiStartCol;
_t.extractBytes       = extractBytes;
_t.stripJsonc         = _stripJsonc;
_t.migrateSpec        = window._migrateSpec;
_t.fmtTestSpecs       = window._fmtTestSpecs;
_t.meExecParseSpec    = _meExecParseSpec;
_t.mePsKnownDDLIds    = _mePsKnownDDLIds;
_t.meFmCountUnresolved = _meFmCountUnresolved;
_t.meWalkDEFields     = _meWalkDEFields;
_t.meCollectBindingDefs = _meCollectBindingDefs;
_t.getDDLFromPath     = getDDLFromPath;
_t.meFmtDateTime      = _meFmtDateTime;
_t.meFmtAmount        = _meFmtAmount;
_t.meFmtHex           = _meFmtHex;
_t.meFmtText          = _meFmtText;
_t.meFmtEbcdic        = _meFmtEbcdic;
_t.S                  = S;
_t.P                  = P;
`;

try {
  vm.runInContext(appSrc, sandbox, { timeout: 5000 });
} catch (e) {
  console.error('FATAL: app script failed to initialize:', e.message);
  process.exit(1);
}

const {
  picSize, typeSize, buildDDLDocFields, expandTypeRefs,
  parseDDLSections, parseHPEDDL, isHPEDDLText, parseFlatMessage,
  parseSimpleDDL, validateDDLErrors, normalizeDataType, validateFieldContent, buildRedefSkipSet,
  detectFormat, isHexAsciiLine, hexAsciiStartCol, extractBytes,
  stripJsonc, migrateSpec, fmtTestSpecs,
  meExecParseSpec, mePsKnownDDLIds, meFmCountUnresolved, S, P,
} = sandbox._t;

// ── Test harness ────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function eq(actual, expected, msg) {
  assert.strictEqual(actual, expected, `${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function deepEq(actual, expected, msg) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, `${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// Helper: build a raw field item (same shape parseDDLSections / parseHPEDDL produce)
function f(level, name, { pic = null, comp = null, typeClause = null, redefines = null, occurs = 1, desc = '' } = {}) {
  return {
    level,
    name:       name.toUpperCase(),
    pic:        pic        ? pic.toUpperCase()       : null,
    comp:       comp       ? comp.toUpperCase()      : null,
    typeClause: typeClause ? typeClause.toUpperCase(): null,
    redefines:  redefines  ? redefines.toUpperCase() : null,
    occurs,
    desc,
  };
}

// Helper: find field by name in a buildDDLDocFields result
function byName(fields, name) {
  return fields.find(f => f.name.toUpperCase() === name.toUpperCase());
}

function fixtureText(relPath) {
  return fs.readFileSync(relPath, 'utf8');
}

// ── picSize ──────────────────────────────────────────────────────────────────
console.log('\npicSize');
test('PIC X(5) → 5', () => eq(picSize('X(5)'), 5));
test('PIC 9(4) → 4', () => eq(picSize('9(4)'), 4));
test('PIC X(3) COMP → 2 (COMP rounds up to half-word)', () => eq(picSize('9(4)', 'COMP'), 2));
test('PIC S9(7) COMP-3 → 4 (packed)', () => eq(picSize('S9(7)', 'COMP-3'), 4));
test('PIC X → 1', () => eq(picSize('X'), 1));
test('PIC S9(5) → 6 (DISPLAY: 5 digits + separate leading sign)', () => eq(picSize('S9(5)'), 6));
test('PIC 9(5)S → 6 (DISPLAY: 5 digits + separate trailing sign)', () => eq(picSize('9(5)S'), 6));
test('PIC S9(4) COMP → 2 (sign folds into binary width)', () => eq(picSize('S9(4)', 'COMP'), 2));

// ── buildDDLDocFields — basic sequential ────────────────────────────────────
console.log('\nbuildDDLDocFields — sequential');
test('two sequential fields: offsets 0, 5', () => {
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'FIELD-A', { pic: 'X(5)' }),
    f(2, 'FIELD-B', { pic: 'X(3)' }),
  ]);
  eq(byName(fields, 'FIELD-A').offset, 0, 'FIELD-A.offset');
  eq(byName(fields, 'FIELD-B').offset, 5, 'FIELD-B.offset');
});

test('group has offset 0, children advance sequentially', () => {
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'GRP'),
    f(3, 'F1', { pic: 'X(2)' }),
    f(3, 'F2', { pic: 'X(3)' }),
  ]);
  eq(byName(fields, 'GRP').offset, 0, 'GRP.offset');
  eq(byName(fields, 'F1').offset,  0, 'F1.offset');
  eq(byName(fields, 'F2').offset,  2, 'F2.offset');
});

// ── buildDDLDocFields — REDEFINES basics ────────────────────────────────────
console.log('\nbuildDDLDocFields — REDEFINES basics');
test('elementary REDEFINES shares target offset', () => {
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'FIELD-A', { pic: 'X(5)' }),
    f(2, 'FIELD-B', { pic: 'X(5)', redefines: 'FIELD-A' }),
    f(2, 'FIELD-C', { pic: 'X(3)' }),
  ]);
  eq(byName(fields, 'FIELD-A').offset, 0, 'FIELD-A.offset');
  eq(byName(fields, 'FIELD-B').offset, 0, 'FIELD-B.offset must equal FIELD-A');
  eq(byName(fields, 'FIELD-C').offset, 5, 'FIELD-C.offset after both');
});

test('REDEFINES group: children start at target offset', () => {
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'FIELD-A', { pic: 'X(5)' }),
    f(2, 'FIELD-B', { redefines: 'FIELD-A' }),
    f(3, 'PART-1', { pic: 'X(2)' }),
    f(3, 'PART-2', { pic: 'X(3)' }),
    f(2, 'FIELD-C', { pic: 'X(3)' }),
  ]);
  eq(byName(fields, 'FIELD-B').offset, 0, 'FIELD-B.offset');
  eq(byName(fields, 'PART-1').offset,  0, 'PART-1.offset');
  eq(byName(fields, 'PART-2').offset,  2, 'PART-2.offset');
  eq(byName(fields, 'FIELD-C').offset, 5, 'FIELD-C after REDEFINES group');
});

test('[REGRESSION] elementary REDEFINES larger than target: next sibling anchored at target end', () => {
  // FIELD2=15 bytes. FIELD3 REDEFINES FIELD2 as 20 bytes (leaf, no children).
  // FIELD4 REDEFINES FIELD2 as 15 bytes. FIELD5 must start at 15, not 20.
  const { fields } = buildDDLDocFields([
    f(2, 'FIELD2',  { pic: 'X(15)' }),
    f(2, 'FIELD3',  { pic: 'X(20)', redefines: 'FIELD2' }),
    f(2, 'FIELD4',  { pic: 'X(15)', redefines: 'FIELD2' }),
    f(2, 'FIELD5',  { pic: 'X(3)'  }),
  ]);
  eq(byName(fields, 'FIELD2').offset, 0,  'FIELD2.offset');
  eq(byName(fields, 'FIELD3').offset, 0,  'FIELD3.offset must equal FIELD2');
  eq(byName(fields, 'FIELD4').offset, 0,  'FIELD4.offset must equal FIELD2');
  eq(byName(fields, 'FIELD5').offset, 15, 'FIELD5 must follow FIELD2 (15), not FIELD3 (20)');
});

test('[REGRESSION] two consecutive REDEFINES groups larger than target: next sibling anchored at target end', () => {
  // FIELD2 = 15 bytes. FIELD3 REDEFINES FIELD2 = 20 bytes (LARGER).
  // FIELD4 REDEFINES FIELD2 = 15 bytes. FIELD5 must start at 15, not at 20.
  const { fields } = buildDDLDocFields([
    f(2, 'FIELD2'),
    f(3, 'FIELD2-YYY', { pic: 'X(10)' }),
    f(3, 'FIELD2-ZZZ', { pic: 'X(5)' }),
    f(2, 'FIELD3', { redefines: 'FIELD2' }),
    f(3, 'FIELD3-YYY', { pic: 'X(12)' }),   // ← intentionally LARGER than FIELD2
    f(3, 'FIELD3-ZZZ', { pic: 'X(8)' }),
    f(2, 'FIELD4', { redefines: 'FIELD2' }),
    f(3, 'FIELD4-YYY', { pic: 'X(6)' }),
    f(3, 'FIELD4-ZZZ', { pic: 'X(9)' }),
    f(2, 'FIELD5',    { pic: 'X(3)' }),
  ]);
  eq(byName(fields, 'FIELD2').offset,  0,  'FIELD2.offset');
  eq(byName(fields, 'FIELD3').offset,  0,  'FIELD3.offset must equal FIELD2 offset');
  eq(byName(fields, 'FIELD4').offset,  0,  'FIELD4.offset must equal FIELD2 offset');
  eq(byName(fields, 'FIELD5').offset, 15,  'FIELD5 must follow FIELD2 (15 bytes), not FIELD3 (20 bytes)');
});

test('[REGRESSION] OCCURS inside REDEFINES group: shift must not bleed past REDEFINES boundary', () => {
  // FIELD3 REDEFINES FIELD2 and contains FIELD3-GRP OCCURS 100 TIMES.
  // Pass-3's OCCURS shift must stop at the REDEFINES boundary — FIELD5 must
  // NOT be displaced by the 100× expansion inside FIELD3.
  const { fields } = buildDDLDocFields([
    f(2, 'FIELD2'),
    f(3, 'FIELD2-YYY', { pic: 'X(5)' }),
    f(3, 'FIELD2-ZZZ', { pic: 'X(3)' }),
    f(2, 'FIELD3',     { redefines: 'FIELD2' }),
    f(3, 'FIELD3-GRP', { occurs: 100 }),
    f(4, 'FIELD3-ITEM',{ pic: 'X(10)' }),
    f(3, 'FIELD3-ZZZ', { pic: 'X(2)' }),
    f(2, 'FIELD4',     { redefines: 'FIELD2' }),
    f(3, 'FIELD4-YYY', { pic: 'X(4)' }),
    f(3, 'FIELD4-ZZZ', { pic: 'X(4)' }),
    f(2, 'FIELD5',     { pic: 'X(3)' }),
  ]);
  eq(byName(fields, 'FIELD3').offset, 0, 'FIELD3.offset = FIELD2.offset');
  eq(byName(fields, 'FIELD4').offset, 0, 'FIELD4.offset = FIELD2.offset');
  eq(byName(fields, 'FIELD5').offset, 8, 'FIELD5 must follow FIELD2 (5+3=8), not be shifted by OCCURS inside FIELD3');
});

test('[REGRESSION] nested OCCURS: inner OCCURS size rolls up into the outer + grandparent group', () => {
  // MULT OCCURS 2 contains INFO OCCURS 5. MULT must use INFO's full 95 (19×5),
  // giving (2+1+1+95)×2 = 198 — not (2+1+1+19)×2 = 46. The grandparent ACCT then
  // spans MULT(198) + PIN(1) + SAVE(171) = 370, with the trailing siblings shifted.
  const { fields } = buildDDLDocFields([
    f(2, 'ACCT'),
    f(4, 'MULT', { occurs: 2 }),
    f(6, 'ACCT-TYP',  { pic: '9(2)' }),
    f(6, 'CNT',       { pic: 'X' }),
    f(6, 'USER-FLD7', { pic: 'X' }),
    f(6, 'INFO', { occurs: 5 }),
    f(8, 'NUM', { pic: 'X(19)' }),
    f(4, 'PIN-VRFY-FLG', { pic: '9' }),
    f(4, 'SAVE-AREA',    { pic: 'X(171)' }),
  ]);
  eq(byName(fields, 'INFO').size, 95, 'INFO = 19 × 5');
  eq(byName(fields, 'MULT').size, 198, 'MULT = (2+1+1+95) × 2 = 198, not 46');
  eq(byName(fields, 'MULT').occursChildSize, 99, 'MULT single occurrence = 99');
  eq(byName(fields, 'ACCT').size, 370, 'ACCT = MULT 198 + PIN 1 + SAVE 171 = 370');
  eq(byName(fields, 'PIN-VRFY-FLG').offset, 198, 'PIN follows MULT full span');
  eq(byName(fields, 'SAVE-AREA').offset, 199, 'SAVE follows PIN');
});

// ── buildDDLDocFields — OCCURS ───────────────────────────────────────────────
console.log('\nbuildDDLDocFields — OCCURS');
test('OCCURS group: size = childSpan × occurs', () => {
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'GRP', { occurs: 3 }),
    f(3, 'ITEM', { pic: 'X(2)' }),
    f(2, 'AFTER', { pic: 'X(3)' }),
  ]);
  const grp   = byName(fields, 'GRP');
  const after = byName(fields, 'AFTER');
  eq(grp.size,    6, 'GRP.size = 2×3');
  eq(after.offset, 6, 'AFTER.offset after 3×2-byte OCCURS');
});

test('OCCURS group with two children: size = (2+3)×3 = 15', () => {
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'GRP', { occurs: 3 }),
    f(3, 'A', { pic: 'X(2)' }),
    f(3, 'B', { pic: 'X(3)' }),
    f(2, 'AFTER', { pic: 'X(1)' }),
  ]);
  eq(byName(fields, 'GRP').size,    15, 'GRP.size');
  eq(byName(fields, 'AFTER').offset, 15, 'AFTER.offset');
});

// ── buildDDLDocFields — REDEFINES + OCCURS (the regression) ─────────────────
console.log('\nbuildDDLDocFields — REDEFINES + OCCURS');
test('[REGRESSION] REDEFINES target before OCCURS group: offset must stay at 0', () => {
  // Layout:
  //   02 FIELD-A  PIC X(5)              ← offset 0
  //   02 GRP      OCCURS 3 TIMES
  //     03 ITEM   PIC X(2)              ← OCCURS group, size 6
  //   02 FIELD-B  REDEFINES FIELD-A PIC X(5)  ← must stay at offset 0
  //   02 AFTER    PIC X(1)              ← must be at offset 11 (5 + 6)
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'FIELD-A', { pic: 'X(5)' }),
    f(2, 'GRP', { occurs: 3 }),
    f(3, 'ITEM', { pic: 'X(2)' }),
    f(2, 'FIELD-B', { pic: 'X(5)', redefines: 'FIELD-A' }),
    f(2, 'AFTER', { pic: 'X(1)' }),
  ]);
  eq(byName(fields, 'FIELD-A').offset, 0,  'FIELD-A.offset');
  eq(byName(fields, 'FIELD-B').offset, 0,  'FIELD-B must stay at target offset, not shifted by OCCURS');
  eq(byName(fields, 'AFTER').offset,   11, 'AFTER.offset = 5 (FIELD-A) + 6 (GRP)');
});

test('[REGRESSION] REDEFINES group (with children) target before OCCURS: children anchored', () => {
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'FIELD-A', { pic: 'X(5)' }),
    f(2, 'GRP', { occurs: 3 }),
    f(3, 'ITEM', { pic: 'X(2)' }),
    f(2, 'FIELD-B', { redefines: 'FIELD-A' }),
    f(3, 'PART-1', { pic: 'X(2)' }),
    f(3, 'PART-2', { pic: 'X(3)' }),
    f(2, 'AFTER', { pic: 'X(1)' }),
  ]);
  eq(byName(fields, 'FIELD-B').offset, 0, 'FIELD-B.offset');
  eq(byName(fields, 'PART-1').offset,  0, 'PART-1.offset');
  eq(byName(fields, 'PART-2').offset,  2, 'PART-2.offset');
  eq(byName(fields, 'AFTER').offset,  11, 'AFTER.offset = 5 (FIELD-A) + 6 (GRP)');
});

test('REDEFINES target after OCCURS group: both shift correctly', () => {
  // Both target and REDEFINES appear after the OCCURS group — both get shifted
  // by the same amount so their delta remains 0.
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'GRP', { occurs: 3 }),
    f(3, 'ITEM', { pic: 'X(2)' }),
    f(2, 'FIELD-A', { pic: 'X(5)' }),
    f(2, 'FIELD-B', { pic: 'X(5)', redefines: 'FIELD-A' }),
    f(2, 'AFTER', { pic: 'X(1)' }),
  ]);
  eq(byName(fields, 'GRP').offset,    0,  'GRP.offset');
  eq(byName(fields, 'FIELD-A').offset, 6,  'FIELD-A.offset after 3×2 OCCURS');
  eq(byName(fields, 'FIELD-B').offset, 6,  'FIELD-B must equal FIELD-A');
  eq(byName(fields, 'AFTER').offset,   11, 'AFTER.offset = 6 + 5');
});

test('REDEFINES before OCCURS group: neither affected', () => {
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'FIELD-A', { pic: 'X(5)' }),
    f(2, 'FIELD-B', { pic: 'X(5)', redefines: 'FIELD-A' }),
    f(2, 'GRP', { occurs: 3 }),
    f(3, 'ITEM', { pic: 'X(2)' }),
    f(2, 'AFTER', { pic: 'X(1)' }),
  ]);
  eq(byName(fields, 'FIELD-A').offset, 0,  'FIELD-A.offset');
  eq(byName(fields, 'FIELD-B').offset, 0,  'FIELD-B.offset');
  eq(byName(fields, 'GRP').offset,    5,  'GRP.offset');
  eq(byName(fields, 'AFTER').offset,  11, 'AFTER.offset = 5 + 6');
});

test('multiple OCCURS groups: subsequent siblings each shift correctly', () => {
  const { fields } = buildDDLDocFields([
    f(1, 'ROOT'),
    f(2, 'GRP1', { occurs: 2 }),
    f(3, 'A', { pic: 'X(3)' }),
    f(2, 'GRP2', { occurs: 4 }),
    f(3, 'B', { pic: 'X(1)' }),
    f(2, 'LAST', { pic: 'X(2)' }),
  ]);
  // GRP1: offset=0, size=6 (3×2); GRP2: offset=6, size=4 (1×4); LAST: offset=10
  eq(byName(fields, 'GRP1').size,    6,  'GRP1.size');
  eq(byName(fields, 'GRP2').offset,  6,  'GRP2.offset');
  eq(byName(fields, 'GRP2').size,    4,  'GRP2.size');
  eq(byName(fields, 'LAST').offset, 10,  'LAST.offset');
});

// ── parseDDLSections ─────────────────────────────────────────────────────────
// parseDDLSections handles HPE DDL (DEF … END) format only.
// The DEF line must end with '.' so the period-splitter separates it from the
// first child field; otherwise they merge into one token.
console.log('\nparseDDLSections');
test('parses a basic HPE DEF section', () => {
  const text = `
    DEF MSG-REC.
      02 FIELD-A PIC X(5).
      02 FIELD-B PIC 9(3).
    END MSG-REC.
  `;
  const sections = parseDDLSections(text);
  assert.ok(sections.length >= 1, 'at least one section');
  const items = sections[0].items;
  const a = items.find(i => i.name === 'FIELD-A');
  const b = items.find(i => i.name === 'FIELD-B');
  assert.ok(a, 'FIELD-A parsed');
  assert.ok(b, 'FIELD-B parsed');
  eq(a.pic, 'X(5)', 'FIELD-A pic');
  eq(b.pic, '9(3)', 'FIELD-B pic');
});

test('parses REDEFINES clause', () => {
  const text = `
    DEF REC.
      02 FLD-X PIC X(4).
      02 FLD-Y REDEFINES FLD-X PIC 9(4).
    END REC.
  `;
  const sections = parseDDLSections(text);
  const items = sections[0].items;
  const y = items.find(i => i.name === 'FLD-Y');
  assert.ok(y, 'FLD-Y parsed');
  eq(y.redefines, 'FLD-X', 'redefines reference');
});

test('parses OCCURS clause', () => {
  const text = `
    DEF REC.
      02 ARR OCCURS 5 TIMES.
        03 EL PIC X(2).
    END REC.
  `;
  const sections = parseDDLSections(text);
  const items = sections[0].items;
  const arr = items.find(i => i.name === 'ARR');
  assert.ok(arr, 'ARR parsed');
  eq(arr.occurs, 5, 'occurs count');
});

// ── isHPEDDLText ─────────────────────────────────────────────────────────────
console.log('\nisHPEDDLText');
test('recognises HPE DDL text', () => {
  const hpe = `DEF MYREC\n  02 FIELD-A PIC X(5).\nEND MYREC`;
  assert.ok(isHPEDDLText(hpe), 'HPE DDL detected');
});

test('rejects plain COBOL as non-HPE', () => {
  const cobol = `01 REC.\n  02 FIELD-A PIC X(5).`;
  assert.ok(!isHPEDDLText(cobol), 'COBOL not flagged as HPE');
});

// ── parseHPEDDL — integration ────────────────────────────────────────────────
console.log('\nparseHPEDDL — integration');
test('parses a basic HPE DEF and produces correct field offsets', () => {
  // DEF line must end with '.' to separate cleanly from the first child field
  const ddl = `
    DEF SIMPLE.
      02 FIELD-A  PIC X(5).
      02 FIELD-B  PIC X(3).
    END SIMPLE.
  `;
  const defs = parseHPEDDL(ddl);
  const a = defs.find(d => /FIELD-A/.test(d.id));
  const b = defs.find(d => /FIELD-B/.test(d.id));
  assert.ok(a, 'FIELD-A in output');
  assert.ok(b, 'FIELD-B in output');
  eq(a.offset, 0, 'FIELD-A.offset');
  eq(b.offset, 5, 'FIELD-B.offset');
});

test('[REGRESSION] parseHPEDDL expands nested OCCURS (inner group repeats per outer occurrence)', () => {
  const ddl = `
    DEF T.
      02 ACCT.
         04 MULT OCCURS 2 TIMES.
            06 ACCT-TYP PIC 9(2).
            06 CNT PIC X.
            06 USER-FLD7 PIC X.
            06 INFO OCCURS 5 TIMES.
               08 NUM PIC X(19).
         04 PIN-VRFY-FLG PIC 9.
    END T.
  `;
  const defs = parseHPEDDL(ddl, null, null, 'T');
  const nums = defs.filter(d => /NUM/.test(d.id));
  eq(nums.length, 10, 'NUM emitted 2 (MULT) × 5 (INFO) = 10 times, not once per MULT');
  deepEq(nums.map(d => d.offset), [4, 23, 42, 61, 80, 103, 122, 141, 160, 179], 'nested NUM offsets');
  assert.ok(defs.find(d => d.id === 'ACCT.MULT[01].INFO[05].NUM'), 'hierarchical [NN] id per OCCURS level');
  eq(defs.find(d => /PIN-VRFY/.test(d.id)).offset, 198, 'field after MULT follows its full 198-byte span');
});

test('[REGRESSION] parseFlatMessage nested OCCURS: fixed keeps all; eye-catcher bounds each outer frame', () => {
  const ddl = `
    DEF T.
      02 MULT OCCURS 2 TIMES.
        06 ATYP PIC 9(2).
        06 INFO OCCURS 5 TIMES.
          08 NUM PIC X(19).
    END T.
  `;
  const defs = parseHPEDDL(ddl, null, null, 'T');   // single MULT = 97, total = 194
  const numCount = bytes => parseFlatMessage(Uint8Array.from(bytes), defs, Uint8Array.from(bytes))
    .filter(f => /NUM/.test(f.id) && !f.error).length;
  eq(numCount(Array(200).fill(0x41)), 10, 'fixed/full → all 2×5 = 10 occurrences kept');
  // '& ' eye-catcher at byte 116 → MULT[0] full (available≥97), MULT[1] dropped (only 1 full 97-byte occ)
  const b = Array(200).fill(0x41); b[116] = 0x26; b[117] = 0x20;
  eq(numCount(b), 5, 'eye-catcher bounds the outer OCCURS: MULT[1] dropped, MULT[0] intact');
});

test('[REGRESSION] HPE DEF with REDEFINES after OCCURS: correct offset', () => {
  const ddl = `
    DEF TREC.
      02 BASE-FLD   PIC X(5).
      02 REP-GRP    OCCURS 3 TIMES.
        03 REP-ITEM PIC X(2).
      02 RDEF-FLD   REDEFINES BASE-FLD PIC X(5).
    END TREC.
  `;
  const defs = parseHPEDDL(ddl);
  const base = defs.find(d => /BASE-FLD/.test(d.id));
  const rdef = defs.find(d => /RDEF-FLD/.test(d.id));
  assert.ok(base, 'BASE-FLD in output');
  assert.ok(rdef, 'RDEF-FLD in output');
  eq(base.offset, 0, 'BASE-FLD.offset');
  eq(rdef.offset, 0, 'RDEF-FLD must match BASE-FLD offset, not be shifted by OCCURS');
});

test('HPE DEF totalSize accounts for OCCURS span', () => {
  const ddl = `
    DEF WREC.
      02 GRP OCCURS 4 TIMES.
        03 ITEM PIC X(3).
      02 TAIL PIC X(2).
    END WREC.
  `;
  const defs = parseHPEDDL(ddl);
  const tail = defs.find(d => /TAIL/.test(d.id));
  assert.ok(tail, 'TAIL in output');
  eq(tail.offset, 12, 'TAIL.offset = 4×3 = 12');
});

test('targetDef limits parsing to the requested DEF section', () => {
  const ddl = `
    DEF FIRST.
      02 A PIC X(2).
    END FIRST.
    DEF SECOND.
      02 B PIC X(3).
    END SECOND.
  `;
  const defs = parseHPEDDL(ddl, null, null, 'SECOND');
  eq(defs.length, 1, 'only one leaf from requested DEF');
  eq(defs[0].id, 'B', 'requested DEF field id');
  eq(defs[0].length, 3, 'requested DEF field length');
});

test('fixture smoke: parses representative repo DDL samples without validation errors', () => {
  const fixtures = [
    'test/DDL-Tests/DEF address.',
    'test/DDL-Tests/DEF binary-pictures.',
    'test/DDL-Tests/DEF employee-odo.',
  ];
  for (const file of fixtures) {
    const text = fixtureText(file);
    const validation = validateDDLErrors(text, new Map());
    eq(validation.errors.length, 0, `${file} validation errors`);
    const defs = parseHPEDDL(text);
    assert.ok(defs.length > 0, `${file} produced parsed fields`);
  }
});

// ── parseFlatMessage ─────────────────────────────────────────────────────────
console.log('\nparseFlatMessage');
test('sequential fields extracted at correct byte positions', () => {
  const defs = [
    { id: 'A', type: 'FIXED', length: 3, offset: 0,  description: 'A' },
    { id: 'B', type: 'FIXED', length: 2, offset: 3,  description: 'B' },
    { id: 'C', type: 'FIXED', length: 4, offset: 5,  description: 'C' },
  ];
  const bytes = Buffer.from('ABCDEFGHIabc');
  const fields = parseFlatMessage(bytes, defs);
  eq(fields[0].startByte, 0, 'A.startByte');
  eq(fields[1].startByte, 3, 'B.startByte');
  eq(fields[2].startByte, 5, 'C.startByte');
});

test('REDEFINES field overlaps target byte range', () => {
  const defs = [
    { id: 'X',    type: 'FIXED', length: 4, offset: 0, description: 'X',    isRedefines: false },
    { id: 'X-R',  type: 'FIXED', length: 4, offset: 0, description: 'X-R',  isRedefines: true  },
    { id: 'NEXT', type: 'FIXED', length: 2, offset: 4, description: 'NEXT', isRedefines: false },
  ];
  const bytes = Buffer.from('HELLO WORLD');
  const fields = parseFlatMessage(bytes, defs);
  eq(fields[0].startByte, 0, 'X.startByte');
  eq(fields[1].startByte, 0, 'X-R.startByte same as X');
  eq(fields[2].startByte, 4, 'NEXT.startByte');
});

test('LLVAR and LLLVAR fields advance the sequential cursor by prefix plus payload', () => {
  const defs = [
    { id: 'L2', type: 'LLVAR',  length: 99,  description: 'L2' },
    { id: 'L3', type: 'LLLVAR', length: 999, description: 'L3' },
  ];
  const fields = parseFlatMessage(Array.from(Buffer.from('03ABC004WXYZ')), defs);
  eq(fields.length, 2, 'two variable-length fields parsed');
  eq(fields[0].lenPrefix, '03', 'LLVAR length prefix');
  eq(fields[0].value, 'ABC', 'LLVAR payload');
  eq(fields[0].startByte, 0, 'LLVAR starts at byte 0');
  eq(fields[1].lenPrefix, '004', 'LLLVAR length prefix');
  eq(fields[1].value, 'WXYZ', 'LLLVAR payload');
  eq(fields[1].startByte, 5, 'LLLVAR starts after LLVAR prefix and payload');
});

// ── typeSize ────────────────────────────────────────────────────────────────
console.log('\ntypeSize');
test('built-in HPE TYPE sizes', () => {
  eq(typeSize('CHARACTER 12'), 12, 'CHARACTER');
  eq(typeSize('BINARY 8'), 1, 'BINARY 8');
  eq(typeSize('BINARY'), 2, 'BINARY default');
  eq(typeSize('FLOAT 64'), 8, 'FLOAT 64');
  eq(typeSize('BIT 9'), 2, 'BIT rounds up to bytes');
});

test('unknown TYPE size is 0', () => eq(typeSize('CUSTOM-TYPE'), 0, 'custom type'));

// ── expandTypeRefs ──────────────────────────────────────────────────────────
console.log('\nexpandTypeRefs');
test('expands TYPE name references as nested children', () => {
  const sectionByName = new Map([
    ['ADDR', [
      f(2, 'ADDR'),
      f(3, 'STREET', { pic: 'X(4)' }),
      f(3, 'ZIP', { pic: '9(5)' }),
    ]],
  ]);
  const expanded = expandTypeRefs([
    f(2, 'CUSTOMER'),
    f(3, 'HOME', { typeClause: 'ADDR' }),
  ], sectionByName);
  deepEq(expanded.map(i => `${i.level}:${i.name}:${i.pic || ''}`), [
    '2:CUSTOMER:',
    '3:HOME:',
    '4:ADDR:',
    '5:STREET:X(4)',
    '5:ZIP:9(5)',
  ], 'expanded item shape');
});

test('cycle guard leaves recursive TYPE reference unresolved', () => {
  const sectionByName = new Map([
    ['NODE', [f(2, 'NODE', { typeClause: 'NODE' })]],
  ]);
  const expanded = expandTypeRefs([f(2, 'ROOT', { typeClause: 'NODE' })], sectionByName);
  eq(expanded.length, 2, 'wrapper plus unresolved recursive child');
  eq(expanded[1].typeClause, 'NODE', 'recursive child remains a type ref');
});

// ── parseSimpleDDL ──────────────────────────────────────────────────────────
console.log('\nparseSimpleDDL');
test('parses 5-column simple DDL with datatype and quoted description', () => {
  const defs = parseSimpleDDL('pan FIXED 19 N "Primary account number"');
  eq(defs[0].id, 'PAN', 'id');
  eq(defs[0].dataType, 'N', 'dataType');
  eq(defs[0].description, 'Primary account number', 'description');
});

test('ignores comments and parses unquoted simple DDL descriptions', () => {
  const defs = parseSimpleDDL('# comment\nflag FIXED 1 Indicator');
  eq(defs.length, 1, 'one definition');
  eq(defs[0].description, 'Indicator', 'description');
});

// ── field content validation ────────────────────────────────────────────────
console.log('\nfield content validation');
test('normalizes PIC and simple datatype tags', () => {
  eq(normalizeDataType('PIC 9(4)'), 'N', 'PIC 9');
  eq(normalizeDataType('PIC A(4)'), 'A', 'PIC A');
  eq(normalizeDataType('PIC X(4)'), 'ANS', 'PIC X');
  eq(normalizeDataType('BINARY 16'), 'B', 'binary');
  eq(normalizeDataType('PIC S9(5)'), 'SN', 'leading signed numeric');
  eq(normalizeDataType('PIC 9(5)S'), 'SN', 'trailing signed numeric');
  eq(normalizeDataType('PIC T9(5)'), 'SN', 'embedded-sign numeric');
  eq(normalizeDataType('PIC N(5)'), 'NAT', 'national');
  eq(normalizeDataType('PIC 9(4) COMP'), 'B', 'COMP numeric is binary, not ASCII');
  eq(normalizeDataType('PIC S9(9) COMP-3'), 'B', 'packed decimal is binary, not ASCII');
});

test('signed & national fields validate without false positives', () => {
  assert.ok(validateFieldContent(Buffer.from('-12345'), 'SN'), 'signed accepts leading - and digits');
  assert.ok(validateFieldContent(Buffer.from('12345+'), 'SN'), 'signed accepts trailing + and digits');
  assert.ok(!validateFieldContent(Buffer.from('12X45'), 'SN'), 'signed still rejects X mid-field');
  assert.ok(!validateFieldContent(Buffer.from('1234?'), 'SN'), 'signed rejects ? placeholder');
  assert.ok(validateFieldContent(Buffer.from([0x00, 0xFF, 0x3F]), 'NAT'), 'national skips byte validation');
});

test('validates numeric, alphabetic, alphanumeric, printable, and track data', () => {
  assert.ok(validateFieldContent(Buffer.from('12345'), 'N'), 'numeric accepts digits');
  assert.ok(!validateFieldContent(Buffer.from('12A45'), 'N'), 'numeric rejects letters');
  assert.ok(validateFieldContent(Buffer.from('Ab Z'), 'A'), 'alpha accepts letters and spaces');
  assert.ok(!validateFieldContent(Buffer.from('AB1'), 'A'), 'alpha rejects digits');
  assert.ok(validateFieldContent(Buffer.from('A9 Z'), 'AN'), 'alphanumeric accepts letters/digits/spaces');
  assert.ok(!validateFieldContent(Buffer.from([0x1f]), 'ANS'), 'printable rejects control bytes');
  assert.ok(validateFieldContent(Buffer.from('123D45=6?'), 'Z'), 'track data accepts D/d/=/?)');
});

test('buildRedefSkipSet skips mixed-type redefine bases only', () => {
  const skip = buildRedefSkipSet([
    { id: 'BASE', dataType: 'N' },
    { id: 'BASE-R', isRedefines: true, redefTarget: 'BASE', dataType: 'ANS' },
    { id: 'SAME', dataType: 'N' },
    { id: 'SAME-R', isRedefines: true, redefTarget: 'SAME', dataType: 'N' },
  ]);
  assert.ok(skip.has('BASE'), 'mixed redefine base is skipped');
  assert.ok(!skip.has('SAME'), 'same-type redefine base is not skipped');
});

// ── format detection and byte extraction ────────────────────────────────────
console.log('\nformat detection and byte extraction');
test('recognizes HEXASCII/Tandem dump lines and start column', () => {
  const text = '  0000: 3031 3233 [0123]';
  assert.ok(isHexAsciiLine(text), 'line is HEXASCII');
  eq(hexAsciiStartCol(text), 6, 'start column includes address prefix after trimStart');
  eq(detectFormat(text), 'tandem-dump', 'format');
  deepEq(extractBytes(text, 'tandem-dump'), [0x30, 0x31, 0x32, 0x33], 'bytes');
});

test('detects ASCII ISO before hex-ratio heuristic', () => {
  eq(detectFormat('ISO0100ABCDEF0123456789'), 'ascii', 'ISO literal is ASCII');
});

test('vetoes hex classification when first line is not predominantly hex', () => {
  const mixed = 'message 1234\n30313233343536373839\n414243444546';
  eq(detectFormat(mixed), 'ascii', 'later hex-heavy lines must not override textual first line');
});

test('detects EBCDIC-looking hex and decodes bytes to ASCII', () => {
  const ebcdicDigits = 'F0F1F2F3F4F5F6F7';
  eq(detectFormat(ebcdicDigits), 'ebcdic', 'EBCDIC format');
  deepEq(extractBytes(ebcdicDigits, 'ebcdic'), Array.from('01234567').map(c => c.charCodeAt(0)), 'decoded');
});

test('detects FUP COPY fixtures as ASCII vs hex dumps before generic heuristics', () => {
  eq(detectFormat(fixtureText('test/FUP-test/fup-copy-ascii.txt')), 'fup-ascii', 'FUP ASCII fixture');
  eq(detectFormat(fixtureText('test/FUP-test/fup-copy-hex.txt')), 'fup-hex', 'FUP hex fixture');
});

test('extracts pure hex, labelled hex, octal, and fixed-width ASCII bytes', () => {
  deepEq(extractBytes('30313233', 'hex'), [48, 49, 50, 51], 'pure hex');
  deepEq(extractBytes('payload = 41 42 43 44', 'hex'), [65, 66, 67, 68], 'labelled hex');
  deepEq(extractBytes('101 102 377', 'oct'), [65, 66, 255], 'octal');
  P.lineWidth = 3; S.asciiMargin = 0; S.asciiRulerCol = 0;
  deepEq(extractBytes('A\nBC', 'ascii'), [65, 32, 32, 66, 67, 32], 'ASCII padding');
  P.lineWidth = 0;
});

// ── JSONC and recognizer pipeline ───────────────────────────────────────────
console.log('\nJSONC and recognizer pipeline');
test('stripJsonc preserves comment-like text inside strings and removes trailing commas', () => {
  const src = `[
    // comment
    { "read-fixed": { "length": 2, "as": "A//B" } },
    /* block */ { "skip": 1, },
  ]`;
  const parsed = JSON.parse(stripJsonc(src));
  eq(parsed[0]['read-fixed'].as, 'A//B', 'string preserved');
  eq(parsed[1].skip, 1, 'trailing comma removed');
});

test('migrates legacy parse_spec fields to binary variant', () => {
  const spec = { name: 'X', parse_spec: [{ skip: 1 }], parse_spec_source: '[{"skip":1}]' };
  migrateSpec(spec);
  assert.ok(!('parse_spec' in spec), 'legacy parse_spec removed');
  deepEq(spec.parse_spec_binary, [{ skip: 1 }], 'binary spec set');
});

test('format recognizers honor spec order, literals, ranges, regex, uint masks, and failAt', () => {
  const bytes = Buffer.from('AB12Z');
  const specs = [
    { name: 'LOW', priority: 0, recognizers: [{ type: 'literal', offset: 0, value: 'AB##' }] },
    { name: 'HIGH', priority: 5, recognizers: [
      { type: 'literal', offset: 0, value: 'AB??' },
      { type: 'regex', offset: 2, length: 2, pattern: '^\\d{2}$' },
      { type: 'uint8', offset: 4, mask: '0xDF', eq: 0x5A },
    ] },
    { name: 'RANGE', priority: 10, recognizers: [{ type: 'literal', offset: 2, value: [{ from: '10', to: '12' }] }] },
  ];
  const results = fmtTestSpecs(specs, bytes);
  eq(results[0].spec.name, 'LOW', 'first passing spec in list order wins');
  assert.ok(results[0].passed, 'ordered literal match passes');
  eq(results.length, 1, 'stops after first passing spec');

  const failed = fmtTestSpecs([{ name: 'BAD', recognizers: [
    { type: 'literal', offset: 0, value: 'AB' },
    { type: 'numeric', offset: 4, length: 1 },
  ] }], bytes);
  assert.ok(!failed[0].passed, 'failing spec reported');
  eq(failed[0].failAt, 1, 'failAt points to failing recognizer');
});

test('metadata recognizers match source, destination, and filename from context', () => {
  const bytes = Buffer.from('ISO0200');
  const results = fmtTestSpecs([{
    name: 'CTX',
    recognizers: [
      { type: 'source', pattern: 'PIA^C###' },
      { type: 'destination', pattern: 'PIA^SWITCH' },
      { type: 'filename', pattern: '$VOL.SUBVOL.FILE#' },
    ],
  }], bytes, {
    source: 'PIA^C910',
    dest: 'PIA^SWITCH',
    filename: '$VOL.SUBVOL.FILE7',
  });
  assert.ok(results[0].passed, 'context metadata recognizers pass');
});

test('metadata recognizers reject specific patterns when context is missing', () => {
  const bytes = Buffer.from('ISO0200');
  const results = fmtTestSpecs([{
    name: 'CTX-MISS',
    recognizers: [{ type: 'source', pattern: 'PIA^C###' }],
  }], bytes, {});
  assert.ok(!results[0].passed, 'specific source pattern fails without ctx.source');
  eq(results[0].failAt, 0, 'missing metadata fails at first recognizer');
});

// ── fixture-driven validation ───────────────────────────────────────────────
console.log('\nfixture-driven validation');
test('invalid DDL fixtures surface hard validation errors', () => {
  const fixtures = [
    'test/DDL-Invalid/DEF missing-end.',
    'test/DDL-Invalid/DEF invalid-pic-char.',
    'test/DDL-Invalid/DEF redefines-larger.',
  ];
  for (const file of fixtures) {
    const validation = validateDDLErrors(fixtureText(file), new Map());
    assert.ok(validation.errors.length > 0, `${file} should produce validation errors`);
  }
});

test('validator rejects COBOL-style comma terminators', () => {
  const ddl = `
    DEF REC.
      02 FIELD-A PIC X(2),
    END REC.
  `;
  const validation = validateDDLErrors(ddl, new Map());
  assert.ok(validation.errors.some(e => e.includes('statement ends with a comma')), 'comma terminator error reported');
});

test('[REGRESSION] validator sizes nested OCCURS for REDEFINES checks (ancestor OCCURS multipliers)', () => {
  // ACCT = MULT OCCURS 2 { 2+1+1 + INFO OCCURS 5 { NUM 19 } } + PIN 1 + SAVE 171
  //      = 2*(4 + 5*19) + 172 = 2*99 + 172 = 370.
  const body = `
      02 ACCT REDEFINES RQST.
         04 MULT OCCURS 2 TIMES.
            06 ACCT-TYP PIC 9(2).
            06 CNT PIC X.
            06 USER-FLD7 PIC X.
            06 INFO OCCURS 5 TIMES.
               08 NUM PIC X(19).
         04 PIN-VRFY-FLG PIC 9.
         04 SAVE-AREA PIC X(171).`;
  // Equal-size target → no size warning (previously ACCT was under-counted → false warning).
  const ok = validateDDLErrors(`DEF T.\n  02 RQST PIC X(370).${body}\nEND.\n`, new Map());
  assert.ok(!ok.warnings.some(w => /smaller structure/.test(w)) && !ok.errors.some(e => /REDEFINES size mismatch/.test(e)),
    'nested-OCCURS ACCT sizes to 370 = RQST → no REDEFINES warning');
  // Smaller target → ACCT (370) is larger → real mismatch is still reported.
  const bad = validateDDLErrors(`DEF T.\n  02 RQST PIC X(200).${body}\nEND.\n`, new Map());
  assert.ok(bad.errors.some(e => /REDEFINES size mismatch/.test(e) && e.includes('370')),
    'ACCT computed as 370 bytes (nested OCCURS counted), flags mismatch vs RQST 200');
});

test('DDL name validity: invalid characters, bad start char, and length', () => {
  // Invalid character (colon) in a field name.
  const badChar = validateDDLErrors('DEF REC.\n  02 DE-33: PIC X(2).\nEND REC.\n', new Map());
  assert.ok(badChar.errors.some(e => e.includes('DE-33') && e.includes('invalid character')),
    'field name with a colon is flagged');

  // Name must begin with a letter or underscore (here a digit).
  const badStart = validateDDLErrors('DEF REC.\n  02 1ABC PIC X(2).\nEND REC.\n', new Map());
  assert.ok(badStart.errors.some(e => e.includes('begin with a letter')),
    'field name starting with a digit is flagged');

  // Maximum 30 characters.
  const longName = 'A'.repeat(31);
  const tooLong = validateDDLErrors(`DEF REC.\n  02 ${longName} PIC X(2).\nEND REC.\n`, new Map());
  assert.ok(tooLong.errors.some(e => e.includes('maximum is 30')),
    'field name longer than 30 chars is flagged');

  // DEF name is validated too.
  const badDef = validateDDLErrors('DEF RE:C.\n  02 A PIC X(2).\nEND.\n', new Map());
  assert.ok(badDef.errors.some(e => e.includes('Definition') && e.includes('invalid character')),
    'DEF name with an invalid character is flagged');

  // A perfectly valid name produces no name-related error.
  const ok = validateDDLErrors('DEF REC.\n  02 DE-33 PIC X(2).\nEND REC.\n', new Map());
  assert.ok(!ok.errors.some(e => e.includes('invalid character') || e.includes('begin with a letter') || e.includes('maximum is 30')),
    'valid names produce no name-rule errors');
});

test('warning-only fixtures stay warnings instead of hard errors', () => {
  const warnings = validateDDLErrors(fixtureText('test/DDL-Invalid/DEF unresolved-type.'), new Map());
  eq(warnings.errors.length, 0, 'unresolved TYPE fixture has no hard errors');
  assert.ok(warnings.warnings.some(w => w.includes('not found in loaded DDLs')), 'unresolved TYPE warning is reported');

  const partialRedef = validateDDLErrors(fixtureText('test/DDL-Invalid/DEF redefines-smaller.'), new Map());
  eq(partialRedef.errors.length, 0, 'smaller redefine fixture has no hard errors');
  assert.ok(partialRedef.warnings.some(w => w.includes('smaller structure')), 'smaller redefine warning is reported');
});

// ── parse_spec interpreter ──────────────────────────────────────────────────
console.log('\nparse_spec interpreter');
test('executes read-ddl filters, repeat, when/not, length refs, read-until, read-to-end, and read-tlv', () => {
  // The DDL covers only the fixed header — read-ddl walks it and leaves the
  // cursor right after CNT, so the synthetic read-fixed blocks continue from
  // there (cursor always advances through every field read).
  S.ddlTree = { VOL: { SV: { 'TESTDDL': `
    DEF REC.
      02 HEAD PIC X(2).
      02 CNT PIC X(1).
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = {
    type: 'TST',
    ddl_bindings: ['VOL/SV/TESTDDL/REC'],
    parse_spec_binary: [
      { 'read-ddl': { fields: ['HEAD', 'CNT'] } },
      { repeat: { count: 'CNT', body: [{ 'read-fixed': { length: 2, as: 'ITEM' } }] } },
      { 'read-fixed': { length: 1, as: 'FLAG' } },
      { 'read-fixed': { length: 1, as: 'LEN' } },
      { when: { field: 'FLAG', not: '0', then: [{ 'read-fixed': { length: 'LEN', as: 'PAYLOAD' } }] } },
      { 'read-until': { sentinels: ['0x26'], eom: true, as: 'UNTIL-AMP' } },
      { skip: 1 },
      { 'read-to-end': { as: 'REST' } },
    ],
  };
  const bytes = Buffer.from('HH2AABB13XYZQQ&END');
  const ctx = meExecParseSpec(item, bytes);
  deepEq(ctx.fields.map(x => x.id), ['HEAD', 'CNT', 'ITEM', 'ITEM', 'FLAG', 'LEN', 'PAYLOAD', 'UNTIL-AMP', 'REST'], 'field sequence');
  eq(ctx.fields.find(x => x.id === 'PAYLOAD').value, 'XYZ', 'length ref payload');
  eq(ctx.fields.find(x => x.id === 'UNTIL-AMP').value, 'QQ', 'read-until payload');
  eq(ctx.fields.find(x => x.id === 'REST').value, 'END', 'read-to-end after skip');

  const tlvItem = {
    ddl_bindings: [],
    parse_spec_binary: [
      { 'read-fixed': { length: 6, as: 'BUF' } },
      { 'read-tlv': { field: 'BUF', tag_length: 1, length_length: 1 } },
    ],
  };
  const tlv = meExecParseSpec(tlvItem, Uint8Array.from([0x9F, 0x02, 0x41, 0x42, 0x5A, 0x00]));
  const tag = tlv.fields.find(x => x.id === 'BUF.9F');
  assert.ok(tag, 'TLV tag emitted');
  eq(tag.value, 'AB', 'TLV value');
});

test('read-ddl from/until emits an inclusive window but still reads hidden fields for references', () => {
  S.ddlTree = { VOL: { SV: { 'WINDOWDDL': `
    DEF REC.
      02 A PIC X(1).
      02 B PIC X(1).
      02 C PIC X(1).
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: ['VOL/SV/WINDOWDDL/REC'],
    parse_spec_binary: [{ 'read-ddl': { from: 'B', until: 'C' } }],
  };
  const ctx = meExecParseSpec(item, Buffer.from('ABC'));
  deepEq(ctx.fields.map(x => x.id), ['B', 'C'], 'visible window is inclusive');
  eq(ctx.fieldsById.A.value, 'A', 'hidden prefix field still read into field map');
});

test('read-length-prefix decodes bcd2 prefixes and read-while max can come from a binary field', () => {
  S.ddlTree = {};
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: [],
    parse_spec_binary: [
      { 'read-length-prefix': { prefix: 'bcd2', as: 'DATA' } },
      { 'read-fixed': { length: 1, as: 'COUNT' } },
      { 'read-while': {
          while: { type: 'alphabetic', length: 1 },
          max: 'COUNT',
          body: [{ 'read-fixed': { length: 1, as: 'CH' } }],
      } },
    ],
  };
  const ctx = meExecParseSpec(item, Uint8Array.from([
    0x00, 0x03, 0x41, 0x42, 0x43, // bcd2 length=3, DATA='ABC'
    0x02,                         // binary count field
    0x44, 0x45, 0x46,             // alphabetic payload, but max should stop after D,E
  ]));
  eq(ctx.fields[0].id, 'DATA', 'first field id');
  eq(ctx.fields[0].value, 'ABC', 'bcd2 payload');
  eq(ctx.fields[0].lenPrefix, '3', 'bcd2 decoded length');
  deepEq(ctx.fields.map(x => x.id), ['DATA', 'COUNT', 'CH', 'CH'], 'read-while stops at binary max count');
  deepEq(ctx.fields.filter(x => x.id === 'CH').map(x => x.value), ['D', 'E'], 'read-while emitted only max iterations');
  eq(ctx.cursor, 8, 'cursor stops after max-limited iterations');
});

test('field_overrides can reinterpret bound DDL fields and add a display formatter', () => {
  S.ddlTree = { VOL: { SV: { 'OVRDDL': `
    DEF REC.
      02 LEN PIC X(2).
      02 TXT PIC X(2).
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: ['VOL/SV/OVRDDL/REC'],
    field_overrides: [
      { field: 'LEN', type: 'uint16-be' },
      { field: 'TXT', display: 'hex' },
    ],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }],
  };
  const ctx = meExecParseSpec(item, Uint8Array.from([0x01, 0x02, 0x41, 0x42]));
  const len = ctx.fields.find(x => x.id === 'LEN');
  const txt = ctx.fields.find(x => x.id === 'TXT');
  eq(len.value, '258', 'type override reinterprets bytes as uint16-be');
  eq(len.dataType, 'uint16-be', 'type override updates dataType');
  eq(len.typeOverride, 'uint16-be', 'type override marker set');
  eq(txt.value, 'AB', 'underlying field value stays text');
  eq(txt.displayValue, '0x4142', 'display override exposes hex rendering');
  eq(txt.displayOverride, 'hex', 'display override marker set');
});

test('uint64-be/le overrides decode 8 bytes to a decimal integer via BigInt', () => {
  S.ddlTree = { VOL: { SV: { 'U64DDL': `
    DEF REC.
      02 BE TYPE BINARY 64.
      02 LE TYPE BINARY 64.
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: ['VOL/SV/U64DDL/REC'],
    field_overrides: [
      { field: 'BE', type: 'uint64-be' },
      { field: 'LE', type: 'uint64-le' },
    ],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }],
  };
  // 123456 = 0x01E240 → be: 00 00 00 00 00 01 E2 40 ; le: 40 E2 01 00 00 00 00 00
  const ctx = meExecParseSpec(item, Uint8Array.from([
    0x00,0x00,0x00,0x00,0x00,0x01,0xE2,0x40,
    0x40,0xE2,0x01,0x00,0x00,0x00,0x00,0x00,
  ]));
  eq(ctx.fields.find(x => x.id === 'BE').value, '123456', 'uint64-be decodes big-endian');
  eq(ctx.fields.find(x => x.id === 'LE').value, '123456', 'uint64-le decodes little-endian');
});

test('uint-be / uint-le are size-adaptive (width = field length) and migrate from legacy uintN', () => {
  S.ddlTree = { VOL: { SV: { 'UADDL': `
    DEF REC.
      02 B1 TYPE BINARY 8.
      02 B2 TYPE BINARY 16.
      02 B4 TYPE BINARY 32.
      02 B8 TYPE BINARY 64.
      02 L2 TYPE BINARY 16.
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = migrateSpec({
    ddl_bindings: ['VOL/SV/UADDL/REC'],
    field_overrides: [
      { field: 'B1', type: 'uint-be' },
      { field: 'B2', type: 'uint-be' },
      { field: 'B4', type: 'uint-be' },
      { field: 'B8', type: 'uint-be' },
      { field: 'L2', type: 'uint16-le' },   // legacy → migrates to uint-le
    ],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }],
  });
  eq(item.field_overrides.find(o => o.field === 'L2').type, 'uint-le', 'legacy uint16-le migrated to uint-le');
  const ctx = meExecParseSpec(item, Uint8Array.from([
    0xFF,                                     // B1 → 255
    0x01, 0xF4,                               // B2 → 500
    0x00, 0x01, 0xE2, 0x40,                   // B4 → 123456
    0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0xE2, 0x40, // B8 → 123456
    0xF4, 0x01,                               // L2 (le) → 500
  ]));
  const v = id => ctx.fields.find(x => x.id === id).value;
  eq(v('B1'), '255',    'uint-be on a 1-byte field');
  eq(v('B2'), '500',    'uint-be on a 2-byte field');
  eq(v('B4'), '123456', 'uint-be on a 4-byte field');
  eq(v('B8'), '123456', 'uint-be on an 8-byte field');
  eq(v('L2'), '500',    'migrated uint-le on a 2-byte field');
});

test('gmt-ts display decodes a NonStop JULIANTIMESTAMP (BINARY 64) to GMT', () => {
  S.ddlTree = { VOL: { SV: { 'TSDDL': `
    DEF REC.
      02 EXIT-TIM TYPE BINARY 64.
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  // JULIANTIMESTAMP = unixMicros + epoch; epoch = Julian day 2440588 (1970-01-01)
  // × 86400 × 1e6 = 210866803200000000 µs.
  const EPOCH = 210866803200000000n;
  const jt = BigInt(Date.UTC(2024, 5, 15, 12, 30, 45)) * 1000n + EPOCH;
  const bytes = []; let x = jt;
  for (let i = 0; i < 8; i++) { bytes.unshift(Number(x & 255n)); x >>= 8n; }
  const item = {
    ddl_bindings: ['VOL/SV/TSDDL/REC'],
    field_overrides: [{ field: 'EXIT-TIM', display: 'gmt-ts' }],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }],
  };
  const ctx = meExecParseSpec(item, Uint8Array.from(bytes));
  eq(ctx.fields.find(f => f.id === 'EXIT-TIM').displayValue,
     '2024-06-15 12:30:45.000000 GMT', 'JULIANTIMESTAMP → GMT date/time');
});

test('field_overrides match ALL occurrences of a nested OCCURS field (occurrence-independent)', () => {
  S.ddlTree = { VOL: { SV: { 'FOCC': `
    DEF REC.
      02 MULT OCCURS 2 TIMES.
        06 INFO OCCURS 3 TIMES.
          08 NUM TYPE BINARY 16.
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: ['VOL/SV/FOCC/REC'],
    field_overrides: [{ field: 'MULT.INFO.NUM', type: 'uint-be' }],  // occurrence-stripped id
    parse_spec_binary: [{ 'read-ddl': 'ANY' }],
  };
  const bytes = []; for (let i = 1; i <= 6; i++) bytes.push(0x00, i);  // 2 MULT × 3 INFO, uint16-be 1..6
  const ctx = meExecParseSpec(item, Uint8Array.from(bytes));
  const nums = ctx.fields.filter(f => /NUM$/.test(f.id) && !f.error);
  eq(nums.length, 6, 'all 6 occurrences read');
  deepEq(nums.map(f => f.value), ['1','2','3','4','5','6'], 'canonical override applied to EVERY occurrence');
  eq(nums.every(f => f.typeOverride === 'uint-be'), true, 'each occurrence carries the override marker');
});

test('field_overrides reject incompatible lengths without replacing the parsed field', () => {
  S.ddlTree = { VOL: { SV: { 'BADOVR': `
    DEF REC.
      02 ONE PIC X(1).
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: ['VOL/SV/BADOVR/REC'],
    field_overrides: [{ field: 'ONE', type: 'uint16-be' }],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }],
  };
  const ctx = meExecParseSpec(item, Buffer.from('A'));
  const parsed = ctx.fields.find(x => x.id === 'ONE' && !x.error);
  const err = ctx.fields.find(x => x.id === 'ONE' && x.error);
  eq(parsed.value, 'A', 'original parsed field remains visible');
  assert.ok(!parsed.typeOverride, 'invalid override is not applied');
  assert.ok(err.error.includes('override ignored'), 'mismatch emits warning row');
});

test('inline parse-spec type overrides take precedence over field_overrides', () => {
  S.ddlTree = { VOL: { SV: { 'INLINEOVR': `
    DEF REC.
      02 NUM PIC X(2).
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: ['VOL/SV/INLINEOVR/REC'],
    field_overrides: [{ field: 'NUM', type: 'uint16-be' }],
    parse_spec_binary: [{ read: { field: 'NUM', type: 'uint16-le' } }],
  };
  const ctx = meExecParseSpec(item, Uint8Array.from([0x01, 0x02]));
  const num = ctx.fields.find(x => x.id === 'NUM' && !x.error);
  eq(num.value, '513', 'inline type override wins over UI field override');
  eq(num.dataType, 'uint16-le', 'effective data type reflects inline override');
  eq(num.typeOverride, 'uint16-le', 'field records the inline override that was applied');
});

test('bitmap-fields honors DE anchors from item.de_map when mapping set bits', () => {
  S.ddlTree = { VOL: { SV: { 'BITDDL': `
    DEF REC.
      02 F1 PIC X(1).
      02 F2 PIC X(1).
      02 F3 PIC X(1).
    END REC.
  ` } } };
  S.inputFormat = 'ascii';
  const item = {
    ddl_bindings: ['VOL/SV/BITDDL/REC'],
    de_map: [{ field: 'F1', de: 2 }],
    parse_spec_binary: [],
    parse_spec_ascii: [
      { 'read-bitmap': { field: 'BMP', encoding: 'ascii-hex' } },
      { 'bitmap-fields': 'BMP' },
    ],
  };
  const ctx = meExecParseSpec(item, Buffer.from('5000000000000000AC'));
  deepEq(ctx.fields.map(x => x.id), ['BMP', 'F1', 'F3'], 'DE-2 and DE-4 map to anchored fields');
  // Present DEs are read sequentially after the bitmap — DDL offsets assume
  // every field is present and would point inside the bitmap region here.
  eq(ctx.fields.find(x => x.id === 'F1').startByte, 16, 'first present DE starts right after the bitmap');
  eq(ctx.fields.find(x => x.id === 'F1').value, 'A', 'first present DE reads the first payload byte');
  eq(ctx.fields.find(x => x.id === 'F3').startByte, 17, 'next present DE follows sequentially (absent F2 consumes nothing)');
  eq(ctx.fields.find(x => x.id === 'F3').value, 'C', 'next present DE reads the second payload byte');
});

test('DE numbering starts after the bitmap field and skips REDEFINES, matching the Field Map UI', () => {
  S.ddlTree = { VOL: { SV: { 'ISODDL': `
    DEF REC.
      02 HDR PIC X(3).
      02 BMP PIC X(16).
      02 PAN.
        03 LEN PIC 9(2).
        03 DATA PIC X(4).
      02 ALT-VIEW REDEFINES PAN.
        03 RAW PIC X(6).
      02 AMT PIC 9(3).
    END REC.
  ` } } };
  S.inputFormat = 'ascii';
  const item = {
    ddl_bindings: ['VOL/SV/ISODDL/REC'],
    // Bit 1 is the secondary-bitmap indicator (never a DE), so anchor the
    // first real DE to 2 — same shape as BIC's SEC-BIT-MAP=DE-1 convention.
    de_map: [{ field: 'PAN', de: 2 }],
    parse_spec_ascii: [
      { 'read-ddl': { until: 'HDR' } },
      { 'read-bitmap': { field: 'BMP', encoding: 'ascii-hex' } },
      { 'bitmap-fields': 'BMP' },
    ],
    parse_spec_binary: [],
  };
  // UI walker view: HDR and BMP unnumbered; PAN group anchored to DE-2
  // (terminal, owns its leaves); ALT-VIEW (REDEFINES) skipped; AMT = DE-3.
  const rows = sandbox._t.meWalkDEFields(
    sandbox._t.meCollectBindingDefs([sandbox._t.getDDLFromPath('VOL/SV/ISODDL/REC')]), item);
  const rowDE = id => rows.find(r => r.id === id)?.de ?? null;
  eq(rowDE('HDR'), null, 'header field carries no DE');
  eq(rowDE('BMP'), null, 'bitmap field carries no DE');
  eq(rowDE('PAN'), 2, 'terminal group owns the anchored DE-2');
  eq(rowDE('PAN.LEN'), null, 'leaf under terminal group carries no DE');
  eq(rowDE('ALT-VIEW'), null, 'REDEFINES wrapper carries no DE');
  eq(rowDE('AMT'), 3, 'numbering continues past the redef without consuming a DE');

  // Engine view must agree: bits 2 and 3 (0x60) → PAN group, AMT.
  // Message: HDR(3) + bitmap(16 ascii-hex) + PAN.LEN(2) + PAN.DATA(4) + AMT(3)
  const ctx = meExecParseSpec(item, Buffer.from('HHH600000000000000004ABCD123'));
  const ids = ctx.fields.map(f => f.id);
  deepEq(ids, ['HDR', 'BMP', 'PAN.LEN', 'PAN.DATA', 'AMT'], 'group DE reads its leaves; AMT follows');
  eq(ctx.fields.find(f => f.id === 'PAN.DATA').value, 'ABCD', 'group leaves read sequentially after the bitmap');
  eq(ctx.fields.find(f => f.id === 'AMT').value, '123', 'second DE follows the group');
});

test('[REGRESSION] DE walker expands every nested OCCURS occurrence; DE only on representatives', () => {
  S.ddlTree = { VOL: { SV: { 'NESTDDL': `
    DEF REC.
      02 ACCT.
        04 MULT OCCURS 2 TIMES.
          06 ATYP PIC 9(2).
          06 INFO OCCURS 5 TIMES.
            08 NUM PIC X(19).
    END REC.
  ` } } };
  const defs = sandbox._t.meCollectBindingDefs([sandbox._t.getDDLFromPath('VOL/SV/NESTDDL/REC')]);
  const rows = sandbox._t.meWalkDEFields(defs, { ddl_bindings: ['VOL/SV/NESTDDL/REC'] });
  const ids = rows.map(r => r.id);
  // Full expansion: every occurrence is its own row.
  eq(ids.filter(id => /\.NUM$/.test(id)).length, 10, '2 (MULT) × 5 (INFO) = 10 NUM rows shown');
  assert.ok(ids.includes('ACCT.MULT[02].INFO[05].NUM'), 'both nesting dimensions expanded');
  assert.ok(ids.includes('ACCT.MULT[02]'), 'outer occurrence 2 group row present');
  // A repeated field is one logical DE: only the all-[01] representative owns/advances a DE.
  const de = id => rows.find(r => r.id === id)?.de;
  assert.ok(de('ACCT.MULT[01].INFO[01]') != null, 'representative terminal group owns a DE');
  assert.ok(de('ACCT.MULT[02].INFO[01]') == null, 'non-representative occurrence carries no DE');
  assert.ok(de('ACCT.MULT[02]') == null, 'non-representative group carries no DE');
});

test('VLG group distributes runtime LEN across children with real ids and overrides applied', () => {
  S.ddlTree = { VOL: { SV: { 'VLGDDL': `
    DEF REC.
      02 BMP PIC X(16).
      02 ICC.
        03 LEN PIC 9(2).
        03 TAG PIC X(2).
        03 VAL PIC X(8).
    END REC.
  ` } } };
  S.inputFormat = 'ascii';
  const item = {
    ddl_bindings: ['VOL/SV/VLGDDL/REC'],
    var_length_groups: ['ICC'],
    field_overrides: [{ field: 'ICC.VAL', display: 'hex' }],
    parse_spec_ascii: [
      { 'read-bitmap': { field: 'BMP', encoding: 'ascii-hex' } },
      { 'bitmap-fields': 'BMP' },
    ],
    parse_spec_binary: [],
  };
  // Bitmap 0x80... → wait, bit 1 is the secondary indicator; use bit 2 (0x40).
  // ICC is the only group after BMP → DE-1... but bit 1 is reserved. Anchor it to 2.
  item.de_map = [{ field: 'ICC', de: 2 }];
  // LEN says 05: TAG takes 2, VAL takes 3 (capped by remaining), emitted even short.
  const ctx = meExecParseSpec(item, Buffer.from('400000000000000005TTVVV'));
  const ids = ctx.fields.map(f => f.id);
  deepEq(ids, ['BMP', 'ICC.LEN', 'ICC.TAG', 'ICC.VAL'], 'VLG children use their real qualified ids');
  eq(ctx.fields.find(f => f.id === 'ICC.LEN').value, '05', 'LEN read as declared');
  eq(ctx.fields.find(f => f.id === 'ICC.TAG').value, 'TT', 'first child takes its declared width');
  const val = ctx.fields.find(f => f.id === 'ICC.VAL');
  eq(val.valueLength, 3, 'last child capped by remaining LEN bytes');
  eq(val.displayValue, '0x565656', 'display override applied to VLG child');
});

test('VLG with selected LEN field: fields before LEN read fixed, fields after distribute (TLV)', () => {
  S.ddlTree = { VOL: { SV: { 'VLGTLV': `
    DEF REC.
      02 BMP PIC X(16).
      02 ICC.
        03 TAG PIC X(2).
        03 LEN PIC 9(2).
        03 VAL PIC X(8).
    END REC.
  ` } } };
  S.inputFormat = 'ascii';
  const item = {
    ddl_bindings: ['VOL/SV/VLGTLV/REC'],
    // LEN is the 2nd sub-field, not the first — selected explicitly.
    var_length_groups: [{ group: 'ICC', len: 'ICC.LEN' }],
    parse_spec_ascii: [
      { 'read-bitmap': { field: 'BMP', encoding: 'ascii-hex' } },
      { 'bitmap-fields': 'BMP' },
    ],
    parse_spec_binary: [],
  };
  item.de_map = [{ field: 'ICC', de: 2 }];
  // TAG='TT' (fixed 2), LEN='05', VAL takes 5 of remaining (declared 8).
  const ctx = meExecParseSpec(item, Buffer.from('4000000000000000TT05VVVVV'));
  const ids = ctx.fields.map(f => f.id);
  deepEq(ids, ['BMP', 'ICC.TAG', 'ICC.LEN', 'ICC.VAL'], 'fields emitted in declaration order, TAG before LEN');
  eq(ctx.fields.find(f => f.id === 'ICC.TAG').value, 'TT', 'TAG before LEN reads its declared fixed width');
  eq(ctx.fields.find(f => f.id === 'ICC.LEN').value, '05', 'selected LEN field read as declared');
  const val = ctx.fields.find(f => f.id === 'ICC.VAL');
  eq(val.valueLength, 5, 'field after LEN gets the distributed bytes');
  eq(val.value, 'VVVVV', 'VAL takes 5 bytes per the runtime LEN');
});

test('display override formatters: datetime, amount with sign, hex, text', () => {
  eq(sandbox._t.meFmtDateTime('0315142207'), '03/15 14:22:07', 'MMDDhhmmss');
  eq(sandbox._t.meFmtDateTime('999999'), '999999', 'unparseable input falls through');
  eq(sandbox._t.meFmtAmount('000000012345'), '123.45', 'plain amount');
  eq(sandbox._t.meFmtAmount('000000012345D'), '-123.45', 'trailing D = debit = negative');
  eq(sandbox._t.meFmtAmount('-12345'), '-123.45', 'leading minus preserved');
  eq(sandbox._t.meFmtAmount('000000012345C'), '123.45', 'trailing C = credit = positive');
  eq(sandbox._t.meFmtHex({ rawHex: 'abcd' }), '0xABCD', 'hex dump');
  eq(sandbox._t.meFmtText({ rawHex: '486900ff' }), 'Hi..', 'ascii render (raw bytes) with non-printables dotted');
  // ebcdic display: EBCDIC "HI" = C8 C9, F1 = "1", non-printable byte -> "."
  eq(sandbox._t.meFmtEbcdic({ rawHex: 'C8C9F100' }), 'HI1.', 'ebcdic render of raw bytes');
});

test('display ascii/text alias and ebcdic render raw bytes ignoring the type override', () => {
  S.ddlTree = { VOL: { SV: { 'DISPDDL': `
    DEF REC.
      02 A PIC X(1).
      02 B PIC X(1).
      02 C PIC X(1).
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: ['VOL/SV/DISPDDL/REC'],
    field_overrides: [
      { field: 'A', type: 'binary', display: 'ascii' },  // raw F1 -> non-printable -> '.'
      { field: 'B', type: 'binary', display: 'ebcdic' },  // raw F1 -> EBCDIC '1'
      { field: 'C', display: 'text' },                    // legacy alias still works
    ],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }],
  };
  const ctx = meExecParseSpec(item, Uint8Array.from([0xF1, 0xF1, 0x41]));
  eq(ctx.fields.find(x => x.id === 'A').displayValue, '.', 'ascii display ignores binary type override, dots non-printable F1');
  eq(ctx.fields.find(x => x.id === 'B').displayValue, '1', 'ebcdic display renders F1 as "1"');
  eq(ctx.fields.find(x => x.id === 'C').displayValue, 'A', 'legacy text alias renders raw byte');
});

test('read-bitmap reports a truncated secondary bitmap without advancing the cursor', () => {
  S.ddlTree = {};
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: [],
    parse_spec_binary: [{ 'read-bitmap': { field: 'BMP', encoding: 'binary' } }],
  };
  const ctx = meExecParseSpec(item, Uint8Array.from([0x80, 0, 0, 0, 0, 0, 0, 0]));
  eq(ctx.cursor, 0, 'cursor stays put on secondary-bitmap truncation');
  eq(ctx.fields.length, 1, 'one error row emitted');
  eq(ctx.fields[0].id, 'BMP', 'error is attributed to the bitmap field');
  assert.ok(ctx.fields[0].error.includes('claims secondary'), 'secondary-bitmap truncation surfaces a specific error');
});

test('read-bitmap also holds the cursor on truncated ASCII-hex secondary bitmaps', () => {
  S.ddlTree = {};
  S.inputFormat = 'ascii';
  const item = {
    ddl_bindings: [],
    parse_spec_ascii: [{ 'read-bitmap': { field: 'BMP', encoding: 'ascii-hex' } }],
  };
  const ctx = meExecParseSpec(item, Buffer.from('8000000000000000'));
  eq(ctx.cursor, 0, 'cursor stays put on ASCII-hex secondary-bitmap truncation');
  eq(ctx.fields.length, 1, 'one error row emitted');
  eq(ctx.fields[0].id, 'BMP', 'error is attributed to the bitmap field');
  assert.ok(ctx.fields[0].error.includes('claims secondary'), 'ASCII-hex truncation reports the same specific error');
});

test('empty parse_spec falls back to read-ddl ANY and uses the default parseSpecUsed label', () => {
  S.ddlTree = { VOL: { SV: { 'DEFAULTDDL': `
    DEF REC.
      02 A PIC X(1).
      02 B PIC X(1).
    END REC.
  ` } } };
  S.inputFormat = 'ascii';
  const item = {
    ddl_bindings: ['VOL/SV/DEFAULTDDL/REC'],
    parse_spec_ascii: [],
    parse_spec_binary: [],
  };
  const ctx = meExecParseSpec(item, Buffer.from('AB'));
  eq(ctx.parseSpecUsed, 'default', 'empty spec reports the default variant');
  deepEq(ctx.fields.map(x => x.id), ['A', 'B'], 'default fallback reads every bound DDL field');
});

test('ASCII parse_spec variant wins for ASCII input, binary variant otherwise', () => {
  S.ddlTree = {};
  S.inputFormat = 'ascii';
  const item = {
    ddl_bindings: [],
    parse_spec_binary: [{ 'read-fixed': { length: 1, as: 'BIN' } }],
    parse_spec_ascii: [{ 'read-fixed': { length: 1, as: 'ASC' } }],
  };
  eq(meExecParseSpec(item, Buffer.from('X')).parseSpecUsed, 'ascii', 'ASCII variant used');
  S.inputFormat = 'hex';
  eq(meExecParseSpec(item, Buffer.from('X')).parseSpecUsed, 'binary', 'binary variant used');
});

test('falls back to ASCII parse_spec when binary input has no binary variant', () => {
  S.ddlTree = {};
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: [],
    parse_spec_ascii: [{ 'read-fixed': { length: 1, as: 'ASC' } }],
  };
  const ctx = meExecParseSpec(item, Buffer.from('X'));
  eq(ctx.parseSpecUsed, 'ascii (fallback)', 'ASCII fallback used');
  deepEq(ctx.fields.map(x => x.id), ['ASC'], 'ASCII fallback emitted expected field');
});

// ── read of a repeated (OCCURS) field/group by canonical id ──────────────────
console.log('\nread of OCCURS field/group by canonical id');

const SRVCS_DDL = `DEF PSTM-REC.
  02 NUM-SERVICES  PIC 9(2).
  02 SRVCS OCCURS 30 TIMES.
    04 TYP           PIC X(2).
    04 TRAN-PROFILE  PIC X.
END
`;

test('read "SRVCS" in read-while consumes one group occurrence per call', () => {
  S.ddlTree = { VOL: { SV: { PSTMDDL: SRVCS_DDL } } };
  S.inputFormat = 'ascii';
  const item = {
    ddl_bindings: ['VOL/SV/PSTMDDL'],
    parse_spec_ascii: [
      { 'read-ddl': { until: 'NUM-SERVICES' } },
      { 'read-while': { while: { type: 'regex', length: 2, pattern: '^[A-Za-z*]{2}$' },
                        body: [{ read: 'SRVCS' }] } },
    ],
  };
  const ctx = meExecParseSpec(item, Buffer.from('02AB1CD2'));
  const errs = ctx.fields.filter(f => f.error).map(f => f.error);
  deepEq(errs, [], 'no errors');
  deepEq(ctx.fields.map(f => [f.id, f.value]), [
    ['NUM-SERVICES', '02'],
    ['SRVCS[01].TYP', 'AB'], ['SRVCS[01].TRAN-PROFILE', '1'],
    ['SRVCS[02].TYP', 'CD'], ['SRVCS[02].TRAN-PROFILE', '2'],
  ], 'two occurrences read in order');
});

test('parse-spec lint id set includes canonical (occurrence-stripped) ids', () => {
  S.ddlTree = { VOL: { SV: { PSTMDDL: SRVCS_DDL } } };
  const ids = mePsKnownDDLIds({ ddl_bindings: ['VOL/SV/PSTMDDL'] });
  eq(ids.has('SRVCS'), true, 'canonical group id');
  eq(ids.has('SRVCS.TYP'), true, 'canonical leaf id');
  eq(ids.has('SRVCS[01].TYP'), true, 'raw occurrence id still valid');
  eq(ids.has('NUM-SERVICES'), true, 'plain id');
});

// ── Field Map unresolved-TYPE counter ─────────────────────────────────────────
console.log('\nField Map unresolved-TYPE counter');

test('cross-file TYPE refs are not counted as unresolved', () => {
  const mainDDL  = 'DEF MAINREC.\n  02 PLAIN PIC X(2).\n  02 XREF TYPE FOOTYPE.\nEND\n';
  const typesDDL = 'DEF FOOTYPE.\n  02 A PIC X(5).\nEND\n';
  S.ddlTree = { VOL: { SV: { MAIN: mainDDL, TYPES: typesDDL } } };
  const r = meFmCountUnresolved('VOL/SV/MAIN/MAINREC');
  eq(r?.count, 0, 'no unresolved items when the TYPE lives in another file');
});

test('a genuinely missing TYPE ref is still counted', () => {
  const mainDDL = 'DEF MAINREC.\n  02 PLAIN PIC X(2).\n  02 XREF TYPE NOWHERE.\nEND\n';
  S.ddlTree = { VOL: { SV: { MAIN: mainDDL } } };
  const r = meFmCountUnresolved('VOL/SV/MAIN/MAINREC');
  eq(r?.count, 1, 'missing TYPE counted');
  eq(r?.sample?.[0]?.includes('XREF'), true, 'sample names the field');
});

// ── Default format specs ──────────────────────────────────────────────────────
console.log('\ndefault format specs');

test('defaults: Base24 POS @4 = "02" (ATM stays "01"); all ISO 8583 vols = SWITCH', () => {
  storage.removeItem('up_format_specs');   // sandbox storage → defaults path
  const specs = domEl._fmtGetData().specs;
  const lit4 = label => specs.find(s => s.label === label)
    .recognizers.find(r => r.type === 'literal' && r.offset === 4).value;
  eq(lit4('Base24 POS Generic'), '02', 'POS @4 literal');
  eq(lit4('Base24 ATM Generic'), '01', 'ATM @4 literal');
  deepEq(specs.filter(s => s.name === 'ISO').map(s => s.vol),
    ['SWITCH', 'SWITCH', 'SWITCH'], 'ISO 8583 Standard/BIC/Switch vol');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  process.exit(1);
}
