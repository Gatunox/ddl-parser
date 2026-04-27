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
  get: (_, k) => {
    if (k === 'addEventListener') return () => {};
    if (k === 'removeEventListener') return () => {};
    if (k === 'getElementById') return () => domEl;
    if (k === 'querySelectorAll') return () => [];
    if (k === 'classList') return { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
    if (k === 'style') return {};
    if (typeof k === 'string') return () => domEl;
    return domEl;
  },
});

const sandbox = vm.createContext({
  // Core JS globals
  console, setTimeout: () => {}, clearTimeout: () => {}, setInterval: () => {},
  clearInterval: () => {}, requestAnimationFrame: () => {}, cancelAnimationFrame: () => {},
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  Math, JSON, Array, Object, Map, Set, WeakMap, WeakSet, RegExp,
  String, Number, Boolean, Symbol, Date, Promise, Error,
  // DOM stubs
  document: domEl,
  window:   domEl,
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

// ── picSize ──────────────────────────────────────────────────────────────────
console.log('\npicSize');
test('PIC X(5) → 5', () => eq(picSize('X(5)'), 5));
test('PIC 9(4) → 4', () => eq(picSize('9(4)'), 4));
test('PIC X(3) COMP → 2 (COMP rounds up to half-word)', () => eq(picSize('9(4)', 'COMP'), 2));
test('PIC S9(7) COMP-3 → 4 (packed)', () => eq(picSize('S9(7)', 'COMP-3'), 4));
test('PIC X → 1', () => eq(picSize('X'), 1));

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

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  process.exit(1);
}
