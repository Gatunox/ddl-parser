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
// The app's own source text. Declared here, beside `html`, because several
// source-level tripwires live above the section that used to declare it.
const APP_SRC = match[1];

// DOM stubs — pure logic functions never call these; they are only used inside
// UI handlers which are never invoked during tests.
const domStub = new Proxy({}, {
  get: () => domStub,
  apply: () => domStub,
  construct: () => domStub,
});
// Tests that need a real element for one specific id register it here; every other
// id still gets the catch-all proxy.
const elStubs = Object.create(null);
const auditTrace = [];

// The target is a function so the stub is both callable (el.focus()) and chainable
// (document.body.classList.add). Returning a bare arrow for unknown keys — as this
// did originally — breaks any chain of two or more property reads. Assigned values
// are kept in a side store so the function's own props (name, length, call) never
// leak through as element properties.
const domElStore = new Map();
const domEl = new Proxy(function () {}, {
  get: (target, k) => {
    if (domElStore.has(k)) return domElStore.get(k);
    if (k === 'addEventListener') return () => {};
    if (k === 'removeEventListener') return () => {};
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
  // renderFieldTable measures a column once; nothing under test reads the result.
  getComputedStyle: () => new Proxy({}, { get: () => '' }),
  // Enough of the Worker plumbing for _auditBeginLoad to run to completion, with
  // an ordering trace so a test can assert what happened before the scan started.
  Blob: function () {},
  URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
  Worker: function () {
    auditTrace.push('worker-created');
    return { postMessage: () => auditTrace.push('postMessage'), terminate: () => {},
             onmessage: null, onerror: null };
  },
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
_t.parseMessage       = parseMessage;
_t.parseHPEISOMessage = parseHPEISOMessage;
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
_t.migrateOverrides   = window._migrateSpecOverrides;
_t.psHelp             = _PS_HELP;
_t.psCommonAttrs      = _PS_COMMON_ATTRS;
_t.psCommonExamples   = _PS_COMMON_EXAMPLES;
_t.mePsHelpExAttrs    = _mePsHelpExAttrs;
_t.mePsHelpRunExample = _mePsHelpRunExample;
_t.mePsHelpExampleHtml = _mePsHelpExampleHtml;
_t.meItemVlgIdentifier = _meItemVlgIdentifier;
_t.meContentLooksWrong = _meContentLooksWrong;
_t.meFieldOvrAnnotation = _meFieldOvrAnnotation;
_t.meHtmlOverrides     = _meHtmlOverrides;
_t.mePsLintWarns       = _mePsLintWarns;
_t.meItemBitmapIsSynthetic = _meItemBitmapIsSynthetic;
_t.fmtDefaultSpecs     = window._fmtDefaultSpecs;
_t.meFmRowHtml         = _meFmRowHtml;
_t.meState             = () => _meState;
_t.setMeState          = v => { _meState = v; };
_t.fmtTestSpecs       = window._fmtTestSpecs;
_t.meExecParseSpec    = _meExecParseSpec;
_t.meParseFileWithSpec = _meParseFileWithSpec;
// Parse-flow routing — which parser a recognized message is sent to.
_t.meSpecNeedsBinding       = _meSpecNeedsBinding;
_t.meSpecHasNoParseSpec     = _meSpecHasNoParseSpec;
_t.meParseWithChosenBinding = _meParseWithChosenBinding;
_t.meWinningSpec            = _meWinningSpec;
_t.bestDDLMatch             = bestDDLMatch;
_t.fmtSpecByName            = window._fmtSpecByName;
_t.mePsKnownDDLIds    = _mePsKnownDDLIds;
_t.meFmCountUnresolved = _meFmCountUnresolved;
_t.meExtractCommentDEs = _meExtractCommentDEs;
_t.meComputeAutoOrderAnchors = _meComputeAutoOrderAnchors;
_t.meBindingTargetDef = _meBindingTargetDef;
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
// Render-time application of a spec's field_overrides, and the type converter it
// calls. renderFieldTable mutates the fields it is given, so the override
// behaviour is observable without inspecting the HTML it returns.
_t.renderFieldTable   = renderFieldTable;
_t.meReadApplyTypeOverride = _meReadApplyTypeOverride;
_t.setSpecLookup      = fn => { window._fmtSpecByName = fn; };
_t.auditBeginLoad     = _auditBeginLoad;
`;

try {
  vm.runInContext(appSrc, sandbox, { timeout: 5000 });
} catch (e) {
  console.error('FATAL: app script failed to initialize:', e.message);
  process.exit(1);
}

const {
  picSize, typeSize, buildDDLDocFields, expandTypeRefs,
  parseDDLSections, parseHPEDDL, isHPEDDLText, parseFlatMessage, parseMessage, parseHPEISOMessage,
  parseSimpleDDL, validateDDLErrors, normalizeDataType, validateFieldContent, buildRedefSkipSet,
  detectFormat, isHexAsciiLine, hexAsciiStartCol, extractBytes,
  stripJsonc, migrateSpec, migrateOverrides, fmtTestSpecs, psHelp, psCommonAttrs,
  psCommonExamples, mePsHelpExAttrs, mePsHelpRunExample, mePsHelpExampleHtml,
  meItemVlgIdentifier,
  meContentLooksWrong, meFieldOvrAnnotation, meHtmlOverrides, mePsLintWarns, fmtDefaultSpecs, meItemBitmapIsSynthetic,
  meFmRowHtml, meState, setMeState,
  meExecParseSpec: _rawExecParseSpec, meParseFileWithSpec: _rawParseFileWithSpec,
  mePsKnownDDLIds, meFmCountUnresolved, meExtractCommentDEs,
  meComputeAutoOrderAnchors, getDDLFromPath, S, P,
  meWalkDEFields: _rawWalkDEFields,
  renderFieldTable, meReadApplyTypeOverride, setSpecLookup: _rawSetSpecLookup, auditBeginLoad,
} = sandbox._t;

// A spec reaches the engine only after the app has loaded it, and loading folds
// de_map / var_length_groups / field_overrides into `overrides`. Folding at the
// door here models that, and keeps the legacy shapes under test — that is the
// half of the collapse that can actually lose a user's saved config.
//
// Deliberately migrateOverrides, NOT migrateSpec: the latter also renames
// parse-spec blocks and normalizes legacy type names, which several tests feed
// on purpose to prove those paths. The fold is idempotent, so a test that
// migrates its own literal is unaffected.
const meExecParseSpec     = (item, ...rest) => _rawExecParseSpec(migrateOverrides(item), ...rest);
const meParseFileWithSpec = (item, ...rest) => _rawParseFileWithSpec(migrateOverrides(item), ...rest);
const setSpecLookup       = fn => _rawSetSpecLookup((...a) => migrateOverrides(fn(...a)));
const meWalkDEFields      = (defs, item, ...rest) => _rawWalkDEFields(defs, migrateOverrides(item), ...rest);

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

// ── One DE anchor renumbers everything after it ──────────────────────────────
// The BIC case: the DDL declares DE-64 then DE-66, because DE-65 does not exist.
// Anchoring the ONE field that breaks the run must renumber the whole tail —
// having to override every element afterwards would make the feature useless.
console.log('\nDE anchors — one override, the rest follow');

const DE_GAP_DDL = `DEF REC.
  02 BMP PIC X(8).
  02 F62 PIC X(2).
  02 F63 PIC X(2).
  02 F64 PIC X(2).
  02 F66 PIC X(2).
  02 F67 PIC X(2).
  02 F68 PIC X(2).
END REC.
`;
const deRows = overrides => {
  S.ddlTree = { V: { S: { D: DE_GAP_DDL } } };
  const item = { ddl_bindings: ['V/S/D/REC'], overrides,
    parse_spec_binary: [{ 'read-bitmap': { field: 'BMP', length: 8 } },
                        { 'read-bitmap-fields': 'BMP' }] };
  const defs = sandbox._t.meCollectBindingDefs([getDDLFromPath('V/S/D/REC')]);
  const rows = meWalkDEFields(defs, item);
  const out = {};
  for (const r of rows) if (/^F\d+$/.test(r.id)) out[r.id] = r;
  return out;
};

test('anchoring one field renumbers every element after it', () => {
  const r = deRows({ F62: { de: 62 } });
  deepEq([r.F62.de, r.F63.de, r.F64.de], [62, 63, 64], 'the run continues from the anchor');
  eq(r.F66.de, 65, 'and keeps counting straight through the gap — hence the second anchor');
  eq(r.F68.de, 67, 'tail follows');
});

test('a second anchor closes the DE-65 gap without touching any other field', () => {
  const r = deRows({ F62: { de: 62 }, F66: { de: 66 } });
  deepEq([r.F62.de, r.F63.de, r.F64.de], [62, 63, 64], 'unchanged before the gap');
  deepEq([r.F66.de, r.F67.de, r.F68.de], [66, 67, 68],
    'everything after the second anchor renumbers on its own — no per-field overrides');
});

test('an anchored row is marked, and carries the DE it replaced', () => {
  const r = deRows({ F62: { de: 62 }, F66: { de: 66 } });
  eq(r.F66.anchored, true, 'F66 is flagged as anchored');
  eq(r.F66.naturalDE, 65, 'and reports the 65 it would otherwise have been');
  eq(r.F67.anchored, false, 'a field that merely follows on is NOT flagged');
  eq(r.F67.naturalDE, null, 'and has nothing to report');
});

// ── Badges never change the mouse cursor ─────────────────────────────────────
// Reported three times: hovering a badge turned the pointer into "?", which
// reads as broken or disabled. A badge is an annotation, not its own control —
// it inherits whatever cursor its row has.
console.log('\nbadges — no cursor:help anywhere');

test('no rule in the app sets cursor:help', () => {
  const src = require('fs').readFileSync('./source.html', 'utf8');
  // Comments are blanked first — the rule is written down next to the CSS it
  // governs, and the words explaining it are not a violation of it. Newlines
  // are preserved so reported line numbers still point at the real source.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, m => m.replace(/[^\n]/g, ' '));
  const hits = code.split('\n')
    .map((l, i) => ({ n: i + 1, l }))
    .filter(x => /cursor\s*:\s*help/.test(x.l))
    .map(x => `${x.n}: ${x.l.trim().slice(0, 80)}`);
  eq(hits.join('\n'), '', 'cursor:help must not appear — badges inherit the row cursor');
});

// ── "bytes": narrow what the TYPE reads, without moving the field ────────────
console.log('\noverrides — "bytes" narrows the type\'s view of a field');

const DDL_BYTES = `DEF REC.
  02 MSGTYPE PIC X(4).
  02 TAIL PIC X(2).
END REC.
`;
// MSGTYPE holds 02 00 30 20; the MTI is the first two bytes.
const bytesCase = (ovr, extra) => {
  S.ddlTree = { V: { S: { D: DDL_BYTES } } };
  S.inputFormat = 'hex';
  const overrides = Object.assign({}, extra);
  if (ovr && Object.keys(ovr).length) overrides.MSGTYPE = ovr;
  return meExecParseSpec(
    { ddl_bindings: ['V/S/D/REC'], overrides,
      parse_spec_binary: [{ 'read-ddl': 'ANY' }] },
    Uint8Array.from([0x02, 0x00, 0x30, 0x20, 0x41, 0x42]));
};

test('hex-char on a PIC X(4) renders all 4 bytes — the behaviour "bytes" exists to correct', () => {
  const f = bytesCase({ type: 'hex-char' }).fields.find(x => x.id === 'MSGTYPE');
  eq(f.value, '02003020', 'all four bytes rendered as 8 hex characters');
});

test('"bytes": 2 makes the field 2 bytes — it is read as if the DDL said PIC X(2)', () => {
  const ctx = bytesCase({ type: 'hex-char', bytes: 2 });
  const f = ctx.fields.find(x => x.id === 'MSGTYPE');
  eq(f.value, '0200', 'only the MTI');
  eq(f.endByte - f.startByte + 1, 2, 'the field itself is now 2 bytes, not 4');
});

test('"bytes" alone re-sizes the field, with no type override at all', () => {
  const f = bytesCase({ bytes: 2 }).fields.find(x => x.id === 'MSGTYPE');
  eq(f.endByte - f.startByte + 1, 2, 'length override applies on its own');
  eq(f.rawHex, '0200', 'and only those bytes are read');
});

test('"bytes" LARGER than declared is legitimate — the DDL understated the field', () => {
  // MSGTYPE is PIC X(4) at offset 0; asking for 5 reads one byte into TAIL.
  const f = bytesCase({ bytes: 5 }).fields.find(x => x.id === 'MSGTYPE');
  eq(f.endByte - f.startByte + 1, 5, 'field grew past its declared 4 bytes');
  eq(f.rawHex, '0200302041', 'and read the fifth byte, which belongs to TAIL');
});

test('growth is still bounded by the message — it cannot read past the end', () => {
  // TAIL is PIC X(2) at offset 4 and the message is 6 bytes, so there is nothing
  // to grow into. Reading stops at the end rather than inventing bytes.
  const f = bytesCase({}, { TAIL: { bytes: 9 } }).fields.find(x => x.id === 'TAIL');
  eq(f.rawHex.length / 2, 2, 'clamped to the 2 bytes that exist');
});

test('shrinking a field frees its leftover bytes for the NEXT field to read', () => {
  // MSGTYPE is PIC X(4) holding 02 00 30 20; cut it to 2 and the 30 20 that
  // frees must reach TAIL, not be skipped because the DDL says TAIL starts at 4.
  const ctx = bytesCase({ type: 'hex-char', bytes: 2 });
  const tail = ctx.fields.find(x => x.id === 'TAIL');
  eq(tail.startByte, 2, 'TAIL moved up to where MSGTYPE now ends');
  eq(tail.rawHex, '3020', 'and reads the two bytes MSGTYPE gave back');
});

test('growing a field pushes the ones after it along', () => {
  const ctx = bytesCase({ bytes: 5 });
  const tail = ctx.fields.find(x => x.id === 'TAIL');
  eq(tail.startByte, 5, 'TAIL starts one byte later than declared');
});

test('with no bytes override, every field sits exactly where the DDL declares', () => {
  const ctx = bytesCase({ type: 'hex-char' });
  const tail = ctx.fields.find(x => x.id === 'TAIL');
  eq(tail.startByte, 4, 'unchanged');
  eq(tail.value, 'AB', 'and reads its declared bytes');
});

test('the type sees the overridden length, so a fixed-width type can now fit', () => {
  eq(bytesCase({ type: 'uint16-be', bytes: 2 }).fields.find(x => x.id === 'MSGTYPE' && !x.error).value,
     '512', '0x0200 = 512, no length-mismatch error');
});

test('an explicit "bytes" outranks the size a fixed-width type would imply', () => {
  // uint16-be would make the field 2; "bytes": 3 says 3, and the user's explicit
  // number wins. No error either way — an override is never ignored.
  const ctx = bytesCase({ type: 'uint16-be', bytes: 3 });
  const f = ctx.fields.find(x => x.id === 'MSGTYPE' && !x.error);
  eq(ctx.fields.some(x => x.id === 'MSGTYPE' && x.error), false, 'no error row');
  eq(f.endByte - f.startByte + 1, 3, '"bytes" set the length, not the type');
  eq(f.value, '512', 'uint16-be still decodes from the head of those bytes');
});

test('a fixed-width type alone sets the length, like editing the DDL to that type', () => {
  const ctx = bytesCase({ type: 'uint16-be' });          // MSGTYPE is PIC X(4)
  const f = ctx.fields.find(x => x.id === 'MSGTYPE' && !x.error);
  eq(f.endByte - f.startByte + 1, 2, 'uint16-be makes it 2 bytes');
  const tail = ctx.fields.find(x => x.id === 'TAIL');
  eq(tail.startByte, 2, 'and TAIL moves up to follow it');
});

test('display runs after the length and type, on the overridden bytes', () => {
  const f = bytesCase({ type: 'hex-char', bytes: 2, display: 'hex' }).fields.find(x => x.id === 'MSGTYPE');
  eq(f.value, '0200', 'type applied to the 2 overridden bytes');
  // 0x0200, not 0x02003020 — the formatter saw the overridden length.
  eq(f.displayValue, '0x0200', 'display formatted those same bytes, not the declared 4');
});

// ── Overrides collapse: de_map + var_length_groups + field_overrides → one map ──
// The three arrays became a single `overrides` map keyed by canonical field id.
// These lock the fold itself: everything else in this file exercises it only
// indirectly, through the door-migration the harness applies.
console.log('\noverrides — the three arrays fold into one map');

test('the fold moves every array into overrides and removes the arrays', () => {
  const spec = migrateOverrides({
    field_overrides: [{ field: 'A', type: 'uint-be', display: 'hex' }],
    de_map: [{ field: 'B', de: 7 }],
    var_length_groups: [{ group: 'G', len: 'G.LEN' }],
  });
  deepEq(spec.overrides.A, { type: 'uint-be', display: 'hex' }, 'type + display land on one entry');
  eq(spec.overrides.B.de, 7, 'DE anchor lands on its field');
  eq(spec.overrides.G.vlg, 'G.LEN', 'explicit LEN leaf is kept');
  eq('field_overrides' in spec, false, 'field_overrides removed');
  eq('de_map' in spec, false, 'de_map removed');
  eq('var_length_groups' in spec, false, 'var_length_groups removed');
});

test('one field carrying all four kinds of override collapses to a single entry', () => {
  const spec = migrateOverrides({
    field_overrides: [{ field: 'F', type: 'ascii', display: 'hex' }],
    de_map: [{ field: 'F', de: 3 }],
    var_length_groups: [{ group: 'F', len: null }],
  });
  eq(Object.keys(spec.overrides).length, 1, 'one key, not three');
  deepEq(spec.overrides.F, { type: 'ascii', display: 'hex', de: 3, vlg: true }, 'all four merged');
});

test('VLG len null and the legacy bare-string entry both mean "first leaf"', () => {
  const a = migrateOverrides({ var_length_groups: [{ group: 'G', len: null }] });
  const b = migrateOverrides({ var_length_groups: ['G'] });
  eq(a.overrides.G.vlg, true, '{group, len:null} → true');
  eq(b.overrides.G.vlg, true, 'legacy bare string → true');
});

test('occurrence indices are stripped from every key, and from the LEN leaf', () => {
  const spec = migrateOverrides({
    field_overrides: [{ field: 'M[02].N', type: 'binary' }],
    de_map: [{ field: 'TOP[01]', de: 4 }],
    var_length_groups: [{ group: 'G[01]', len: 'G[01].LEN' }],
  });
  eq(spec.overrides['M.N'].type, 'binary', 'field id canonicalized');
  eq(spec.overrides['TOP'].de, 4, 'DE anchor id canonicalized');
  eq(spec.overrides['G'].vlg, 'G.LEN', 'group AND its LEN leaf canonicalized');
});

test('entries that carry nothing are dropped rather than left as noise', () => {
  const spec = migrateOverrides({ field_overrides: [{ field: 'EMPTY' }, { field: 'REAL', type: 'ascii' }] });
  eq('EMPTY' in spec.overrides, false, 'an entry with no settings is not stored');
  eq(spec.overrides.REAL.type, 'ascii', 'a real entry survives');
});

test('the fold is idempotent and never clobbers an already-migrated map', () => {
  const once  = migrateOverrides({ de_map: [{ field: 'A', de: 2 }] });
  const twice = migrateOverrides(JSON.parse(JSON.stringify(once)));
  // Compared as JSON: objects built inside the VM sandbox and objects built
  // here have different Object prototypes, which deepStrictEqual counts as a
  // difference even when every key and value matches.
  eq(JSON.stringify(twice.overrides), JSON.stringify(once.overrides), 'running it again changes nothing');
  const mixed = migrateOverrides({ overrides: { A: { type: 'ascii' } }, de_map: [{ field: 'A', de: 9 }] });
  deepEq(mixed.overrides.A, { type: 'ascii', de: 9 }, 'an old array merges INTO an existing entry');
});

test('a spec with no override config of any kind gets an empty map, not junk', () => {
  const spec = migrateOverrides({ name: 'X' });
  deepEq(spec.overrides, {}, 'empty map');
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
  // dataType keeps the DECLARED type — the Type/Description column shows
  // "<declared> ↩ <override>", so clobbering it lost the original.
  eq(len.dataType, 'PIC X(2)', 'declared type is preserved, not replaced by the override');
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
  eq(item.overrides['L2'].type, 'uint-le', 'legacy uint16-le migrated to uint-le');
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

// ── PSTM-style OCCURS: the declared count field wins over any heuristic ──────
const PSTM_DDL = `DEF PSTM.
  02 TYP          PIC X(4).
  02 USER-FLG     PIC X.
  02 NUM-SERVICES PIC 9(2).
  02 SRVCS        OCCURS 30 TIMES.
    04 TAG        PIC X(2).
    04 VAL        PIC X(3).
  END
END
`;
// 5 services (5 bytes each) then trailing data that LOOKS like more services.
const pstmBytes = (n, trailing) => {
  const tags = ['CK', 'SV', 'CC', 'LN', 'MM', 'AA', 'BB'];
  let s = '0210' + '1' + String(n).padStart(2, '0');
  for (let i = 0; i < n; i++) s += tags[i] + String(i + 1).padStart(3, '0');
  return [...(s + trailing)].map(c => c.charCodeAt(0));
};

test('OCCURS count field (NUM-SERVICES) bounds the DDL walk, not the trailing data', () => {
  S.ddlTree = { VOL: { SV: { PSTM: PSTM_DDL } } };
  S.inputFormat = 'hex';
  // Trailing user data is long and letter-heavy — the old '& ' distance
  // heuristic inflated the count from 5 to 8+ and ate all of it.
  const bytes = pstmBytes(5, 'USERDATAHEREANDMORE& TK01');
  const item = { ddl_bindings: ['VOL/SV/PSTM/PSTM'], parse_spec_binary: [{ 'read-ddl': 'ANY' }] };
  const ctx = meExecParseSpec(item, Uint8Array.from(bytes), { format: 'hex', rawBytes: bytes });
  const occ = new Set(ctx.fields.filter(f => /^SRVCS/.test(f.id))
    .map(f => (/\[(\d+)\]/.exec(f.id) || [])[1]).filter(Boolean));
  eq(occ.size, 5, 'exactly NUM-SERVICES occurrences read, not 30 and not the heuristic count');
  const svcEnd = 4 + 1 + 2 + 5 * 5;
  eq(ctx.fields.filter(f => /^SRVCS/.test(f.id)).every(f => f.endByte < svcEnd), true,
     'no service row reaches past the services region');
});

test('[REGRESSION] OCCURS count field governs even when read-ddl "until" never matches', () => {
  // The default PSTM spec says until:"NUM-SERVICES". When the DDL nests that
  // field (HDR.NUM-SERVICES) the id never matches, so read-ddl walks the WHOLE
  // definition — which used to emit all 30 declared services and swallow the
  // user data and token area behind them.
  S.ddlTree = { VOL: { SV: { PSTM: `DEF PSTM.
  02 TYP          PIC X(4).
  02 USER-FLG     PIC X.
  02 HDR.
    04 NUM-SERVICES PIC 9(2).
  02 SRVCS        OCCURS 30 TIMES.
    04 TAG        PIC X(2).
    04 VAL        PIC X(3).
  END
END
` } } };
  S.inputFormat = 'hex';
  const bytes = pstmBytes(5, 'U'.repeat(60) + '& TK01');
  const item = { ddl_bindings: ['VOL/SV/PSTM/PSTM'], parse_spec_binary: [
    { 'read-ddl': { until: 'NUM-SERVICES' } },       // never matches — field is HDR.NUM-SERVICES
    { repeat: { count: 'HDR.NUM-SERVICES', body: [{ read: 'SRVCS' }] } },
  ] };
  const ctx = meExecParseSpec(item, Uint8Array.from(bytes), { format: 'hex', rawBytes: bytes });
  const occ = new Set(ctx.fields.filter(f => /^SRVCS/.test(f.id))
    .map(f => (/\[(\d+)\]/.exec(f.id) || [])[1]).filter(Boolean));
  eq(occ.size, 5, 'nested count field still bounds the walk to 5, not the declared 30');
});

test('read-while: max resolves from a count field, capping a guard that would over-read', () => {
  S.ddlTree = { VOL: { SV: { PSTM: PSTM_DDL } } };
  S.inputFormat = 'ascii';
  const bytes = pstmBytes(5, 'USERDATAHERE& TK01');
  const spec = max => ({ ddl_bindings: ['VOL/SV/PSTM/PSTM'], parse_spec_binary: [
    { 'read-ddl': { until: 'NUM-SERVICES' } },
    { 'read-while': { while: { type: 'regex', length: 2, pattern: '^[A-Za-z*]{2}$' },
                      ...(max ? { max } : {}), body: [{ read: 'SRVCS' }] } },
  ] });
  const count = ctx => new Set(ctx.fields.filter(f => /^SRVCS/.test(f.id))
    .map(f => (/\[(\d+)\]/.exec(f.id) || [])[1]).filter(Boolean)).size;
  const loose = meExecParseSpec(spec(null), Uint8Array.from(bytes), { format: 'ascii', rawBytes: bytes });
  eq(count(loose) > 5, true, 'guard alone keeps matching letter-ish trailing data');
  const capped = meExecParseSpec(spec('NUM-SERVICES'), Uint8Array.from(bytes), { format: 'ascii', rawBytes: bytes });
  eq(count(capped), 5, 'max: "NUM-SERVICES" stops the loop at the declared count');
});

test('read-while: an iteration running past the message end is rolled back', () => {
  S.ddlTree = { VOL: { SV: { PSTM: PSTM_DDL } } };
  S.inputFormat = 'ascii';
  // Trailing 'ABCDE' is letter-ish but only 5 bytes — the guard matches, yet a
  // full 5-byte service straddles the end on the following iteration.
  const bytes = pstmBytes(5, 'ABCDEFG');
  const item = { ddl_bindings: ['VOL/SV/PSTM/PSTM'], parse_spec_binary: [
    { 'read-ddl': { until: 'NUM-SERVICES' } },
    { 'read-while': { while: { type: 'regex', length: 2, pattern: '^[A-Za-z*]{2}$' }, body: [{ read: 'SRVCS' }] } },
  ] };
  const ctx = meExecParseSpec(item, Uint8Array.from(bytes), { format: 'ascii', rawBytes: bytes });
  eq(ctx.cursor <= bytes.length, true, 'cursor never runs past the payload');
  eq(ctx.fields.every(f => f.endByte == null || f.endByte < bytes.length), true,
     'no field claims bytes beyond the message');
});

test('[REGRESSION] read-fixed refuses a length that overruns the payload', () => {
  // PSTM shape: USER-FLG='1' but the record carries NO user data — the token
  // eye-catcher "& " sits where the length would be. Read as a 2-byte length
  // that is 0x2620 = 9760, which used to run the cursor ~9.7k bytes past the
  // end of a 23-byte message, silently, destroying the token area.
  S.ddlTree = { VOL: { SV: { PS: `DEF PSTM.
  02 TYP          PIC X(4).
  02 USER-FLG     PIC X.
END
` } } };
  S.inputFormat = 'hex';
  const bytes = [...'0210' + '1' + '& TK01'].map(c => c.charCodeAt(0));
  const item = { ddl_bindings: ['VOL/SV/PS/PSTM'], parse_spec_binary: [
    { 'read-ddl': 'ANY' },
    { when: { field: 'USER-FLG', is: '1', then: [
      { 'read-fixed': { length: 2, as: 'UD.LEN' } },
      { 'read-fixed': { length: 'UD.LEN', as: 'UD.BUF' } } ] } },
  ] };
  const ctx = meExecParseSpec(item, Uint8Array.from(bytes), { format: 'hex', rawBytes: bytes });
  eq(ctx.cursor <= bytes.length, true, 'cursor never runs past the payload');
  const err = ctx.fields.find(f => f.error && /exceeds the/.test(f.error));
  eq(!!err, true, 'the impossible length is reported instead of silently consumed');
  eq(ctx.fields.some(f => f.id === 'UD.BUF' && !f.error), false, 'no phantom buffer field is emitted');
});

test('[REGRESSION] read-length-prefix refuses a prefix longer than the payload', () => {
  S.ddlTree = { VOL: { SV: { LP: `DEF R.
  02 HDR PIC X(2).
END
` } } };
  S.inputFormat = 'hex';
  // uint16 prefix 0x2620 (9760) with only a few bytes behind it
  const bytes = [0x41, 0x42, 0x26, 0x20, 0x54, 0x4B];
  const item = { ddl_bindings: ['VOL/SV/LP/R'], parse_spec_binary: [
    { 'read-ddl': 'ANY' },
    { 'read-length-prefix': { prefix: 'uint16-be', as: 'BUF' } },
  ] };
  const ctx = meExecParseSpec(item, Uint8Array.from(bytes), { format: 'hex', rawBytes: bytes });
  eq(ctx.cursor <= bytes.length, true, 'cursor stays inside the payload');
  eq(ctx.fields.some(f => f.error && /only \d+ remain/.test(f.error)), true, 'over-long prefix reported');
  // eom:true is an explicit clamp and must still be allowed to truncate quietly
  const eomItem = { ...item, parse_spec_binary: [
    { 'read-ddl': 'ANY' },
    { 'read-length-prefix': { prefix: 'uint16-be', as: 'BUF', eom: true } },
  ] };
  const eomCtx = meExecParseSpec(eomItem, Uint8Array.from(bytes), { format: 'hex', rawBytes: bytes });
  eq(eomCtx.fields.some(f => f.id === 'BUF' && !f.error), true, 'eom:true still clamps to end without erroring');
});

test('bitmap display renders raw bytes as 0/1 bits grouped every 4', () => {
  S.ddlTree = { VOL: { SV: { 'BMDDL': `
    DEF REC.
      02 SEG-MAP TYPE BINARY 32.
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: ['VOL/SV/BMDDL/REC'],
    field_overrides: [{ field: 'SEG-MAP', display: 'bitmap' }],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }],
  };
  const ctx = meExecParseSpec(item, Uint8Array.from([0xC0, 0x40, 0x00, 0x00]));
  const f = ctx.fields.find(x => x.id === 'SEG-MAP');
  eq(f.displayValue, '1100 0000 0100 0000 0000 0000 0000 0000', 'C0400000 → bit string, 4-bit groups');
  eq(f.displayOverride, 'bitmap', 'display override marker set');
  // Any type, not just BINARY — the RAW bytes are rendered: PIC X "0" = 0x30.
  S.ddlTree = { VOL: { SV: { 'BMX': `
    DEF REC.
      02 FLAG PIC X.
    END REC.
  ` } } };
  const ctx2 = meExecParseSpec({
    ddl_bindings: ['VOL/SV/BMX/REC'],
    field_overrides: [{ field: 'FLAG', display: 'bitmap' }],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }],
  }, Uint8Array.from([0x30]));
  eq(ctx2.fields.find(x => x.id === 'FLAG').displayValue, '0011 0000', 'PIC X ASCII "0" (0x30) → "0011 0000"');
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

// BEHAVIOUR CHANGE: a stored override used to be REJECTED when its type needed
// more bytes than the DDL declared — an error row, original value untouched.
// An override is now an edit to the DDL, so it always wins: the type states the
// field's size, the field is read at that size, and the rest of the record
// shifts. Nothing is silently ignored.
test('a stored type override that needs more bytes RESIZES the field instead of erroring', () => {
  S.ddlTree = { VOL: { SV: { 'BADOVR': `
    DEF REC.
      02 ONE PIC X(1).
      02 TWO PIC X(1).
      02 THREE PIC X(1).
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const item = {
    ddl_bindings: ['VOL/SV/BADOVR/REC'],
    overrides: { ONE: { type: 'uint16-be' } },   // 2 bytes, on a 1-byte field
    parse_spec_binary: [{ 'read-ddl': 'ANY' }],
  };
  const ctx = meExecParseSpec(item, Uint8Array.from([0x01, 0x02, 0x03]));
  const one = ctx.fields.find(x => x.id === 'ONE' && !x.error);
  eq(ctx.fields.some(x => x.id === 'ONE' && x.error), false, 'no "override ignored" row');
  eq(one.value, '258', '0x0102 decoded as uint16-be — the override was honoured');
  eq(one.typeOverride, 'uint16-be', 'and marked as overridden');
  eq(one.endByte - one.startByte + 1, 2, 'the field took the 2 bytes its type needs');
  const two = ctx.fields.find(x => x.id === 'TWO' && !x.error);
  eq(two.startByte, 2, 'TWO shifted along, exactly as if the DDL had declared 2 bytes');
});

test('an INLINE parse-spec type is still length-checked — it never re-sizes a field', () => {
  S.ddlTree = { VOL: { SV: { 'INLBAD': `
    DEF REC.
      02 ONE PIC X(1).
    END REC.
  ` } } };
  S.inputFormat = 'hex';
  const ctx = meExecParseSpec({
    ddl_bindings: ['VOL/SV/INLBAD/REC'],
    parse_spec_binary: [{ read: { field: 'ONE', type: 'uint16-be' } }],
  }, Buffer.from('A'));
  const err = ctx.fields.find(x => x.id === 'ONE' && x.error);
  assert.ok(err && err.error.includes('override ignored'),
    'an inline type is part of the traversal, not a DDL edit, so it must still fit');
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
  eq(num.dataType, 'PIC X(2)', 'declared type preserved; the override is recorded separately');
  eq(num.typeOverride, 'uint16-le', 'field records the inline override that was applied');
});

test('bitmap-fields honors DE anchors from item.de_map when mapping set bits', () => {
  S.ddlTree = { VOL: { SV: { 'BITDDL': `
    DEF REC.
      02 BMP PIC X(16).
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
      { 'read-bitmap-fields': 'BMP' },
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
      { 'read-bitmap-fields': 'BMP' },
    ],
    parse_spec_binary: [],
  };
  // UI walker view: HDR and BMP unnumbered; PAN group anchored to DE-2
  // (terminal, owns its leaves); ALT-VIEW (REDEFINES) skipped; AMT = DE-3.
  const rows = meWalkDEFields(
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

test('a REDEFINES child group does not split its parent\'s DE (DATA-ELEMENT-37 case)', () => {
  S.ddlTree = { VOL: { SV: { 'D37DDL': `
    DEF REC.
      02 BMP PIC X(16).
      02 DATA-ELEMENT-37.
        04 DATA PIC X(12).
        04 TLR REDEFINES DATA.
          06 TRAN PIC X(6).
          06 DEV PIC X(6).
      02 DATA-ELEMENT-38 PIC X(6).
    END REC.
  ` } } };
  const item = {
    ddl_bindings: ['VOL/SV/D37DDL/REC'],
    parse_spec_binary: [
      { 'read-bitmap': { field: 'BMP', encoding: 'ascii-hex' } },
      { 'read-bitmap-fields': 'BMP' },
    ],
  };
  const rows = meWalkDEFields(
    sandbox._t.meCollectBindingDefs([sandbox._t.getDDLFromPath('VOL/SV/D37DDL/REC')]), item);
  const row = id => rows.find(r => r.id === id);
  eq(row('DATA-ELEMENT-37')?.de, 1, 'group owns the DE (terminal despite the redef child)');
  eq(row('DATA-ELEMENT-37')?.isTerminal, true, 'redef child group does not break terminal status');
  eq(row('DATA-ELEMENT-37.DATA')?.de ?? null, null, 'DATA carries no DE of its own');
  eq(row('DATA-ELEMENT-37.DATA')?.underTerminal, true, 'DATA sits under the terminal group');
  eq(row('DATA-ELEMENT-37.TLR')?.de ?? null, null, 'REDEFINES wrapper carries no DE');
  eq(row('DATA-ELEMENT-37.TLR.TRAN')?.de ?? null, null, 'redef leaf carries no DE');
  eq(row('DATA-ELEMENT-38')?.de, 2, 'next field numbers straight after the group');
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
  const rows = meWalkDEFields(defs, { ddl_bindings: ['VOL/SV/NESTDDL/REC'] });
  const ids = rows.map(r => r.id);
  // Full expansion: every occurrence is its own row.
  eq(ids.filter(id => /\.NUM$/.test(id)).length, 10, '2 (MULT) × 5 (INFO) = 10 NUM rows shown');
  assert.ok(ids.includes('ACCT.MULT[02].INFO[05].NUM'), 'both nesting dimensions expanded');
  assert.ok(ids.includes('ACCT.MULT[02]'), 'outer occurrence 2 group row present');
  // A data element is a TOP-LEVEL field: only ACCT owns a DE; every nested
  // group/leaf (any occurrence) is sub-structure and carries none.
  const de = id => rows.find(r => r.id === id)?.de;
  assert.ok(de('ACCT') != null, 'top-level element owns the DE');
  assert.ok(de('ACCT.MULT[01].INFO[01]') == null, 'nested group carries no DE');
  assert.ok(de('ACCT.MULT[02].INFO[01]') == null, 'non-representative occurrence carries no DE');
  assert.ok(de('ACCT.MULT[02]') == null, 'non-representative group carries no DE');
});

test('a composite element (nested sub-groups) consumes exactly ONE DE', () => {
  S.ddlTree = { VOL: { SV: { COMP: `
    DEF ISOMSG.
      02 BMP PIC X(16).
      02 DATA-ELEMENT-62.
        04 LEN PIC 9(3).
        04 DATA.
          06 PART1 PIC X(5).
          06 PART2 PIC X(5).
      02 DATA-ELEMENT-63 PIC X(4).
    END
  ` } } };
  const item = {
    ddl_bindings: ['VOL/SV/COMP/ISOMSG'], de_map: [],
    parse_spec_binary: [{ 'read-bitmap': { field: 'BMP', encoding: 'ascii-hex' } }, { 'read-bitmap-fields': 'BMP' }],
  };
  const rows = meWalkDEFields(
    sandbox._t.meCollectBindingDefs([sandbox._t.getDDLFromPath('VOL/SV/COMP/ISOMSG')]), item);
  const de = id => rows.find(r => r.id === id)?.de ?? null;
  eq(de('DATA-ELEMENT-62'), 1, 'composite element owns one DE');
  eq(de('DATA-ELEMENT-62.LEN'), null, 'nested leaf carries no DE');
  eq(de('DATA-ELEMENT-62.DATA'), null, 'nested group carries no DE');
  eq(de('DATA-ELEMENT-62.DATA.PART1'), null, 'deep leaf carries no DE');
  eq(de('DATA-ELEMENT-63'), 2, 'next element numbers immediately after — no inflation');
  eq(rows.filter(r => r.de !== null).length, 2, 'exactly one DE per top-level element');
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
      { 'read-bitmap-fields': 'BMP' },
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
      { 'read-bitmap-fields': 'BMP' },
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

// ── OCCURS inside a REDEFINES overlay ─────────────────────────────────────────
console.log('\nOCCURS inside a REDEFINES overlay (DDL Doc sizing)');

test('OCCURS growth inside a REDEFINES overlay does not shift outer siblings', () => {
  const ddl = `DEF STM.
  02 RQST PIC X(480).
  02 T-8W REDEFINES RQST.
    04 DATA-AREA PIC X(280).
    04 OPTIONS-AREA REDEFINES DATA-AREA.
      08 ITEM OCCURS 8 TIMES.
        16 ID PIC X(02).
        16 CODIGO PIC X(04).
        16 DESC PIC X(29).
    04 FILLER PIC X(80).
END
`;
  const sec = parseDDLSections(ddl)[0];
  const { fields, totalSize } = buildDDLDocFields(sec.items, null);
  const get = qn => fields.find(f => f.qualName === qn);
  eq(get('T-8W').size, 360, 'T-8W = DATA-AREA 280 + FILLER 80');
  eq(get('T-8W.FILLER').offset, 280, 'FILLER not shifted by ITEM OCCURS 8');
  eq(get('T-8W.OPTIONS-AREA').size, 280, 'overlay sized from 8 × 35');
  eq(get('T-8W.OPTIONS-AREA.ITEM').size, 280, 'ITEM group = 8 × 35');
  eq(totalSize, 480, 'record total stays RQST size');
});

// ── Auto Order: DE extraction from DDL comments ───────────────────────────────
console.log('\nAuto Order — comment DE extraction');

test('extracts "Bit map position = NN" (and the postion typo) from comment blocks', () => {
  const ddl = `DEF ISOMSG.
* Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
* eiusmod tempor. BIt map postion = 39. Excepteur sint occaecat
* cupidatat non proident.
    02 DATA-ELEMENT-39   PIC X(2).
* Bit map position: 41
    02 DATA-ELEMENT-41   PIC X(8).
    02 NO-COMMENT-FLD    PIC X(1).
* pos of something else = 7 (must not match)
    02 UNRELATED         PIC X(1).
END
`;
  const m = meExtractCommentDEs(ddl, 'ISOMSG');
  eq(m.get('DATA-ELEMENT-39'), 39, 'typo "postion" tolerated');
  eq(m.get('DATA-ELEMENT-41'), 41, 'colon separator tolerated');
  eq(m.has('NO-COMMENT-FLD'), false, 'field without comment DE not mapped');
  eq(m.has('UNRELATED'), false, 'non-bitmap comment ignored');
});

test('comment block binds to the NEXT declaration only; last match wins; DEF scoping', () => {
  const ddl = `DEF OTHERDEF.
* Bit map position = 99
    02 WRONG-SCOPE PIC X(1).
END
DEF TARGET.
* Bit map position = 5
* correction: Bit map position = 6
    02 FLD-A.
      04 CHILD PIC X(2).
* inline style
    02 FLD-B PIC X(3). ! Bit map position = 8 !
    02 FLD-C PIC X(3).
END
`;
  const m = meExtractCommentDEs(ddl, 'TARGET');
  eq(m.has('WRONG-SCOPE'), false, 'other DEF sections are skipped');
  eq(m.get('FLD-A'), 6, 'last match in the block wins');
  eq(m.has('CHILD'), false, 'buffer resets after a declaration');
  eq(m.get('FLD-B'), 8, 'inline comment on the declaration line describes that field');
  eq(m.has('FLD-C'), false, 'no leak to the following field');
});

test('Auto Order anchors only fields whose DE differs from natural extrapolation', () => {
  // Natural DE = 1,2,3,4,5. Comments: A=1 (match), B=2 (match), C=5 (jump),
  // D=none, E=6. Only C and E should be anchored; A/B stay natural (no blue).
  const rows = [
    { id: 'A', naturalDE: 1, commentDE: 1 },
    { id: 'B', naturalDE: 2, commentDE: 2 },
    { id: 'C', naturalDE: 3, commentDE: 5 },
    { id: 'D', naturalDE: 4, commentDE: null },
    { id: 'E', naturalDE: 5, commentDE: 6 },
  ];
  // A,B match natural → no anchor. C jumps 3→5 → anchor. D extrapolates to 6.
  // E's expected is 7 (after D), comment 6 ≠ 7 → anchor. So C and E only.
  const anchors = meComputeAutoOrderAnchors(rows);
  deepEq(anchors, [{ field: 'C', de: 5 }, { field: 'E', de: 6 }],
    'only fields that break the running sequence are anchored');
});

test('Auto Order: all-jumped comments anchor every matched field', () => {
  const rows = [
    { id: 'TRACK2', naturalDE: 1, commentDE: 35 },
    { id: 'TRACK3', naturalDE: 2, commentDE: 36 },
    { id: 'GAP',    naturalDE: 3, commentDE: null },
    { id: 'TRACK1', naturalDE: 4, commentDE: 45 },
  ];
  const anchors = meComputeAutoOrderAnchors(rows);
  // TRACK2: 1→35 anchor. TRACK3: expected 36 == comment 36 → NO anchor.
  // GAP: expected 37. TRACK1: expected 37 != 45 → anchor.
  deepEq(anchors, [{ field: 'TRACK2', de: 35 }, { field: 'TRACK1', de: 45 }],
    'contiguous comment run needs one anchor; the gap breaks continuity');
});

// ── DE cap at 128 + definition-scoped bindings ────────────────────────────────
console.log('\nDE cap at 128 + definition-scoped bindings');

test('DE numbering caps at 128; an anchor pulls the sequence back into range', () => {
  let ddl = 'DEF BIGISO.\n    02 BMP PIC X(16).\n';
  for (let i = 1; i <= 140; i++) ddl += `    02 FLD-${String(i).padStart(3, '0')} PIC X(2).\n`;
  ddl += 'END\n';
  S.ddlTree = { VOL: { SV: { BIG: ddl } } };
  const mkItem = de_map => ({
    ddl_bindings: ['VOL/SV/BIG/BIGISO'], de_map,
    parse_spec_binary: [{ 'read-bitmap': { field: 'BMP', encoding: 'ascii-hex' } }, { 'read-bitmap-fields': 'BMP' }],
  });
  const defs = sandbox._t.meCollectBindingDefs([sandbox._t.getDDLFromPath('VOL/SV/BIG/BIGISO')]);
  // Natural: fields 129/140 exceed the 128-bit bitmap → no DE, flagged overflow.
  let rows = meWalkDEFields(defs, mkItem([]));
  const row = (rs, id) => rs.find(r => r.id === id);
  eq(row(rows, 'FLD-128').de, 128, 'DE-128 still assigned');
  eq(row(rows, 'FLD-129').de, null, 'DE-129 does not exist');
  eq(row(rows, 'FLD-129').deOverflow, true, 'overflow flagged');
  eq(row(rows, 'FLD-129').deSeq, 129, 'uncapped sequence kept for Auto Order');
  // Anchoring FLD-100 back to DE-60 brings the tail into range again.
  rows = meWalkDEFields(defs, mkItem([{ field: 'FLD-100', de: 60 }]));
  eq(row(rows, 'FLD-100').de, 60, 'anchor applied');
  eq(row(rows, 'FLD-129').de, 89, 'post-anchor field back inside 1-128');
  eq(row(rows, 'FLD-140').de, 100, 'tail numbered normally after the anchor');
});

test('a 4-part binding whose DEF does not exist resolves to null (no whole-file fallthrough)', () => {
  S.ddlTree = { VOL: { SV: { MULTI: 'DEF AA.\n  02 F1 PIC X(2).\nEND\nDEF BB.\n  02 F2 PIC X(3).\nEND\n' } } };
  eq(sandbox._t.getDDLFromPath('VOL/SV/MULTI/AA')?.defs?.length, 1, 'existing DEF resolves scoped');
  eq(sandbox._t.getDDLFromPath('VOL/SV/MULTI/NOPE'), null, 'missing DEF is a missing binding, not the whole file');
});

test('Auto Order resolves a whole-file binding to the DEF declaring the bitmap field', () => {
  const file = `DEF HELPERS.
* Bit map position = 99
  02 SOME-TYPE PIC X(4).
END
DEF ISOMSG.
  02 PBIT-MAP PIC X(16).
* Bit map position = 2
  02 DATA-ELEMENT-2 PIC X(2).
END
`;
  S.ddlTree = { VOL: { SV: { F: file } } };
  const item = { parse_spec_binary: [{ 'read-bitmap': { field: 'PBIT-MAP', encoding: 'ascii-hex' } }, { 'read-bitmap-fields': 'PBIT-MAP' }] };
  const t = sandbox._t.meBindingTargetDef('VOL/SV/F', item);
  eq(t?.defName, 'ISOMSG', 'DEF containing the bitmap field wins');
  eq(t?.multi, 2, 'multi-DEF file reported');
  eq(t?.names.has('DATA-ELEMENT-2'), true, 'scope covers the record fields');
  eq(t?.names.has('SOME-TYPE'), false, 'other definitions excluded from scope');
  // 4-part binding: named DEF wins regardless of bitmap
  const t2 = sandbox._t.meBindingTargetDef('VOL/SV/F/HELPERS', item);
  eq(t2?.defName, 'HELPERS', '4-part binding names its DEF');
  eq(t2?.multi, null, 'no multi note for an explicit DEF');
});

test('multi-DEF file: binding one DEF parses ONLY that DEF (fields, DEs, comments)', () => {
  // Three definitions in ONE file. HDR-DEF and TRAILER-DEF carry decoy
  // fields and decoy "Bit map position" comments that must never leak into
  // the bound ISOMSG scope.
  const file = `DEF HDR-DEF.
* Bit map position = 90 (decoy)
  02 HDR-A PIC X(4).
  02 HDR-B PIC X(4).
END
DEF ISOMSG.
  02 PBIT-MAP PIC X(16).
* Bit map position = 2
  02 DATA-ELEMENT-2 PIC X(19).
* Bit map position = 44
  02 DATA-ELEMENT-44.
    04 LEN PIC 9(2).
    04 DATA.
      06 PART1 PIC X(10).
      06 PART2 PIC X(10).
* Bit map position = 53
  02 DATA-ELEMENT-53 PIC X(16).
END
DEF TRAILER-DEF.
* Bit map position = 91 (decoy)
  02 TR-A PIC X(9).
END
`;
  S.ddlTree = { VOL: { SV: { F: file } } };
  const item = {
    ddl_bindings: ['VOL/SV/F/ISOMSG'], de_map: [],
    parse_spec_binary: [{ 'read-bitmap': { field: 'PBIT-MAP', encoding: 'ascii-hex' } }, { 'read-bitmap-fields': 'PBIT-MAP' }],
  };
  // 1. The compiled defs contain ONLY the bound DEF's fields.
  const r = sandbox._t.getDDLFromPath('VOL/SV/F/ISOMSG');
  const roots = new Set(r.defs.map(d => d.id.split('.')[0]));
  deepEq([...roots].sort(), ['DATA-ELEMENT-2', 'DATA-ELEMENT-44', 'DATA-ELEMENT-53', 'PBIT-MAP'],
    'field list holds only the bound DEF');
  // 2. DE rows: one per top-level element of the bound DEF, nothing else.
  const rows = meWalkDEFields(sandbox._t.meCollectBindingDefs([r]), item);
  deepEq(rows.filter(x => x.de !== null).map(x => `${x.id}=DE-${x.de}`),
    ['DATA-ELEMENT-2=DE-1', 'DATA-ELEMENT-44=DE-2', 'DATA-ELEMENT-53=DE-3'],
    'exactly one DE per top-level element of the bound DEF');
  // 3. Comment extraction scoped to the bound DEF — decoys invisible.
  const m = meExtractCommentDEs(file, 'ISOMSG');
  deepEq([...m.entries()].sort(), [['DATA-ELEMENT-2', 2], ['DATA-ELEMENT-44', 44], ['DATA-ELEMENT-53', 53]],
    'only the bound DEF\'s comments extracted');
  eq(m.has('HDR-A'), false, 'decoy before the DEF ignored');
  eq(m.has('TR-A'), false, 'decoy after the DEF ignored');
  // 4. The minimal anchor set from those comments.
  const anchors = meComputeAutoOrderAnchors(rows.filter(x => x.deSeq != null).map(x =>
    ({ id: x.id, naturalDE: x.deSeq, commentDE: m.get(x.id) ?? null })));
  deepEq(anchors, [
    { field: 'DATA-ELEMENT-2', de: 2 },
    { field: 'DATA-ELEMENT-44', de: 44 },
    { field: 'DATA-ELEMENT-53', de: 53 },
  ], 'anchors computed from bound-DEF comments only');
});

// ── Line-item clauses: any clause, any order ──────────────────────────────────
console.log('\nline-item clauses — any clause, any order');

test('every manual clause is accepted as the FIRST token after the name', () => {
  const lines = [
    '02 X1 AS "alias" PIC X(2).',
    '02 X2 USAGE COMP PIC 9(4).',
    '02 X3 EDIT-PIC "ZZ9" PIC 9(3).',
    '02 X4 HELP "text" PIC X(2).',
    '02 X5 JUSTIFIED RIGHT PIC X(4).',
    '02 X6 MUST BE 1 THRU 9 PIC 9(1).',
    '02 X7 NULL " " PIC X(2).',
    '02 X8 SPI-NULL 255 PIC X(2).',
    '02 X9 SQLNULLABLE PIC X(2).',
    '02 X10 TACL STRING PIC X(2).',
    '02 X11 VALUE 5 PIC 9(1).',
    '02 X12 UPSHIFT PIC X(3).',
  ];
  for (const l of lines) {
    const { errors } = validateDDLErrors('DEF T.\n  ' + l + '\nEND\n');
    const spaceErr = errors.find(e => e.includes('illegal space'));
    eq(spaceErr || null, null, 'no false space-in-name for: ' + l);
  }
  // A REAL space in a name must still be caught.
  const bad = validateDDLErrors('DEF T.\n  02 BAD NAME PIC X(2).\nEND\n');
  eq(bad.errors.some(e => e.includes('illegal space')), true, 'genuine space still detected');
});

test('clause order is free: PIC … OCCURS … REDEFINES (prod pattern) sizes and parses', () => {
  const ddl = `DEF ZOO.
  02 BASE          PIC X(6).
  02 TAIL-REDEF    PIC X(2) OCCURS 3 TIMES REDEFINES BASE.
  02 MID-REDEF     PIC X(2) REDEFINES BASE OCCURS 3 TIMES.
  02 OCC-FIRST     OCCURS 3 TIMES PIC X(2).
  02 LAST          PIC X(2).
END
`;
  const { errors, warnings } = validateDDLErrors(ddl);
  deepEq(errors, [], 'validator clean');
  deepEq(warnings || [], [], 'no warnings');
  const { fields, totalSize } = buildDDLDocFields(parseDDLSections(ddl)[0].items, null);
  const get = qn => fields.find(f => f.qualName === qn);
  eq(get('TAIL-REDEF').offset, 0, 'tail REDEFINES anchors to the target');
  eq(get('TAIL-REDEF').size, 6, 'OCCURS multiplies the redefining leaf (2×3)');
  eq(get('MID-REDEF').size, 6, 'clause order irrelevant');
  eq(get('OCC-FIRST').offset, 6, 'sequential field after the redef target');
  eq(get('LAST').offset, 12, 'layout cursor unaffected by the overlays');
  eq(totalSize, 14, 'record total');
});

test('leaf REDEFINES with OCCURS: size check multiplies the occurs, in either clause order', () => {
  const mk = line => 'DEF Z.\n  02 BASE PIC X(4).\n  ' + line + '\n  02 AFTER PIC X(2).\nEND\n';
  for (const line of [
    '02 OV PIC X(2) OCCURS 3 TIMES REDEFINES BASE.',
    '02 OV PIC X(2) REDEFINES BASE OCCURS 3 TIMES.',
  ]) {
    const r = validateDDLErrors(mk(line));
    eq(r.errors.some(e => /REDEFINES size mismatch/.test(e) && e.includes('6 byte') && e.includes('only 4 byte')),
      true, 'oversized overlay (2×3 over 4) errors for: ' + line);
  }
  // Exact fit (2×2 over 4) must stay silent in both orders.
  for (const line of [
    '02 OV PIC X(2) OCCURS 2 TIMES REDEFINES BASE.',
    '02 OV PIC X(2) REDEFINES BASE OCCURS 2 TIMES.',
  ]) {
    const r = validateDDLErrors(mk(line));
    deepEq(r.errors, [], 'exact-fit overlay clean for: ' + line);
  }
});

test('repeated FILLER items all survive: layout, Field Map defs, and DE slots', () => {
  const ddl = `DEF ZOO3.
  02 BMP        PIC X(16).
  02 A          PIC X(2).
  02 FILLER     PIC X(3).
  02 B          PIC X(2).
  02 FILLER     PIC X(5).
  02 C          PIC X(2) HELP "Sentence ends here.".
  02 D          PIC X(2).
END
`;
  const { errors, warnings } = validateDDLErrors(ddl);
  deepEq(errors, [], 'validator clean (incl. quoted period inside HELP)');
  deepEq(warnings || [], [], 'no warnings');
  S.ddlTree = { VOL: { SV: { Z: ddl } } };
  const merged = sandbox._t.meCollectBindingDefs([sandbox._t.getDDLFromPath('VOL/SV/Z/ZOO3')]);
  deepEq(merged.map(d => `${d.id}@${d.offset}`),
    ['BMP@0', 'A@16', 'FILLER@18', 'B@21', 'FILLER@23', 'C@28', 'D@30'],
    'both FILLERs survive the id+offset dedup');
  const item = { ddl_bindings: ['VOL/SV/Z/ZOO3'], de_map: [],
    parse_spec_binary: [{ 'read-bitmap': { field: 'BMP', encoding: 'ascii-hex' } }, { 'read-bitmap-fields': 'BMP' }] };
  const rows = meWalkDEFields(merged, item);
  // FILLER is padding: it neither owns nor advances the DE counter.
  deepEq(rows.filter(r => r.de !== null).map(r => `${r.id}=DE-${r.de}`),
    ['A=DE-1', 'B=DE-2', 'C=DE-3', 'D=DE-4'],
    'FILLERs are transparent to DE numbering');
  deepEq(rows.filter(r => r.id === 'FILLER').map(r => r.de), [null, null],
    'FILLER rows carry no DE');
});

test('manual grammar: quoted PIC strings, TIMES-less OCCURS, INDEXED BY, EXTERNAL/NOVALUE/NOT', () => {
  const ddl = `DEF T.
  02 P1 PIC "X(5)".
  02 P2 PICTURE "9(3)V99".
  02 BASE PIC X(4).
  02 OV PIC X(2) OCCURS 2 REDEFINES BASE.
  02 O2 PIC X(2) OCCURS 4 TIMES INDEXED BY IX.
  02 E1 EXTERNAL PIC X(2).
  02 E2 NOVALUE PIC 9(2).
  02 E3 NOT SQLNULLABLE PIC X(2).
END
`;
  const v = validateDDLErrors(ddl);
  deepEq(v.errors, [], 'no errors — quoted PICs, optional TIMES, INDEXED BY, and the extra first-position keywords are all legal');
  deepEq(v.warnings || [], [], 'no warnings — the 2×2 overlay exactly fits its 4-byte target');
  const { fields } = buildDDLDocFields(parseDDLSections(ddl)[0].items, null);
  const get = qn => fields.find(f => f.qualName === qn);
  eq(get('P1').size, 5, 'PIC "X(5)" unquoted and sized');
  eq(get('P2').size, 5, 'PICTURE "9(3)V99" = 5 bytes');
  eq(get('O2').size, 8, 'OCCURS 4 TIMES INDEXED BY sized ×4');
  eq(get('OV').size, 4, 'TIMES-less OCCURS multiplies (2×2)');
});

test('TIMES-less OCCURS reaches the validator size check (was invisible to it)', () => {
  const r = validateDDLErrors('DEF T.\n  02 BASE PIC X(4).\n  02 OV PIC X(2) OCCURS 3 REDEFINES BASE.\nEND\n');
  eq(r.errors.some(e => /REDEFINES size mismatch/.test(e) && e.includes('6 byte')), true,
    'oversized overlay detected without the TIMES keyword');
});

test('kitchen sink: every ignorable clause with unquoted args on ONE field beside a real OCCURS', () => {
  // Unquoted clause arguments can never collide with clause keywords — DDL's
  // reserved-word rule forbids user names from being keywords, so keyword-
  // anchored extraction stays sound no matter how many clauses pile up.
  const ddl = 'DEF T.\n'
    + '  02 K PIC 9(2) JUSTIFIED RIGHT LN"fr_CA.ISO88591" MUST BE 1 THRU 12 '
    + 'SPI-NULL 255 NOT SQLNULLABLE TACL TSTAMP UPSHIFT EXTERNAL VALUE 5 '
    + 'OCCURS 2 TIMES INDEXED BY IX HEADING "month nbr".\n'
    + '  02 L PIC X(3).\nEND\n';
  const v = validateDDLErrors(ddl);
  deepEq(v.errors, [], 'no errors');
  deepEq(v.warnings || [], [], 'no warnings');
  const { fields, totalSize } = buildDDLDocFields(parseDDLSections(ddl)[0].items, null);
  const k = fields.find(f => f.qualName === 'K');
  eq(k.size, 4, 'PIC 9(2) × OCCURS 2 survives twelve sibling clauses');
  eq(k.occurs, 2, 'occurs intact');
  eq(k.desc, 'month nbr', 'heading still extracted');
  eq(fields.find(f => f.qualName === 'L').offset, 4, 'layout cursor exact');
  eq(totalSize, 7, 'record total exact');
});

test('metadata clauses are inert: keywords inside strings and EDIT-PIC never corrupt PIC/OCCURS/REDEFINES', () => {
  const ddl = `DEF T.
  02 BASE PIC X(6).
  02 A EDIT-PIC "ZZ9" PIC 9(3).
  02 B HEADING "OCCURS 5 TIMES" PIC X(2).
  02 C HELP "REDEFINES BASE" PIC X(2).
  02 D PIC X(2) HEADING "h" OCCURS 3 TIMES JUSTIFIED RIGHT REDEFINES BASE.
  02 E VALUE "PIC 9(9)" PIC X(4).
END
`;
  const v = validateDDLErrors(ddl);
  deepEq(v.errors, [], 'no validator errors');
  deepEq(v.warnings || [], [], 'no warnings');
  const { fields, totalSize } = buildDDLDocFields(parseDDLSections(ddl)[0].items, null);
  const get = qn => fields.find(f => f.qualName === qn);
  eq(get('A').size, 3, 'EDIT-PIC argument does not hijack the real PIC');
  eq(get('B').size, 2, 'no phantom OCCURS from a HEADING string');
  eq(get('B').occurs, 1, 'occurs stays 1');
  eq(get('B').desc, 'OCCURS 5 TIMES', 'the string still feeds the description verbatim');
  eq(get('C').isRedefines, false, 'no phantom REDEFINES from a HELP string');
  eq(get('D').size, 6, 'interleaved metadata does not disturb real OCCURS×REDEFINES');
  eq(get('D').offset, 0, 'D still overlays BASE');
  eq(get('E').size, 4, 'no PIC hijack from a VALUE string');
  eq(totalSize, 17, 'record total intact');
});

test('FILLER clause rules per the manual: mandatory size, noncomputational, no forbidden clauses', () => {
  const check = line => validateDDLErrors('DEF T.\n  02 A PIC X(2).\n  ' + line + '\nEND\n');
  // Legal forms (from the manual's FILLER Clause examples)
  for (const line of [
    '02 FILLER PIC X(6).',
    '02 FILLER TYPE CHARACTER 6.',
    '02 FILLER PIC 9(6).',
    '02 FILLER PIC X(2) OCCURS 3 TIMES.',
  ]) {
    deepEq(check(line).errors, [], 'legal: ' + line);
  }
  // Illegal forms
  const cases = [
    ['02 FILLER.',                        /PICTURE or TYPE/],
    ['02 FILLER PIC 9(4) COMP.',          /computational/],
    ['02 FILLER TYPE BINARY 16.',         /numeric TYPE/],
    ['02 FILLER PIC X(2) REDEFINES A.',   /cannot REDEFINES/],
    ['02 FILLER PIC X(2) HEADING "h".',   /HEADING/],
    ['02 FILLER PIC X(2) KEYTAG 0.',      /KEYTAG/],
    ['02 FILLER PIC X(2) MUST BE 1.',     /MUST BE/],
    ['02 FILLER PIC X(2) UPSHIFT.',       /UPSHIFT/],
  ];
  for (const [line, re] of cases) {
    eq(check(line).errors.some(e => re.test(e)), true, 'flagged: ' + line);
  }
  // SPI-NULL is NOT in the prohibited list — the NULL check must not false-flag it.
  eq(check('02 FILLER PIC X(2) SPI-NULL 255.').errors.length, 0, 'SPI-NULL allowed on FILLER');
});

test('PIC scaling and scaled binary size correctly', () => {
  const ddl = 'DEF T.\n  02 E PIC 9(5)P.\n  02 F TYPE BINARY 16,2.\n  02 G PIC S9(4)V9.\nEND\n';
  const { fields } = buildDDLDocFields(parseDDLSections(ddl)[0].items, null);
  const get = qn => fields.find(f => f.qualName === qn);
  eq(get('E').size, 5, 'P scaling position stores no byte');
  eq(get('F').size, 2, 'scaled BINARY 16,2 is still 2 bytes');
  eq(get('G').size, 6, 'S9(4)V9 = separate sign + 5 digits');
});

// ── KEYTAG clause ─────────────────────────────────────────────────────────────
console.log('\nKEYTAG clause');

test('KEYTAG on a group or leaf does not trigger the space-in-name error', () => {
  const ddl = `RECORD PARTINFO.
  02 PARTKEY KEYTAG "pn".
    04 PARTNUM   PIC 9(4) KEYTAG 0 HEADING "Part".
    04 PARTNAME  PIC X(18).
  02 INVENTORY PIC 9(3)S.
  02 LOCATION  PIC X(3) DISPLAY "loc".
END
`;
  const { errors } = validateDDLErrors(ddl);
  const spaceErrs = errors.filter(e => e.includes('illegal space in name'));
  deepEq(spaceErrs, [], 'no false space-in-name errors');
});

test('a real space in a field name is still flagged', () => {
  const { errors } = validateDDLErrors('DEF R.\n  02 BAD NAME PIC X(2).\nEND\n');
  eq(errors.some(e => e.includes('illegal space in name')), true, 'space still detected');
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

// ── Message / File detection split ────────────────────────────────────────────
console.log('\nmessage vs file detection order');

test('message specs always rank first; file specs are only consulted for records with a filename', () => {
  const bytes = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
  domEl._fmtSave([
    { name: 'FIL', label: 'Any-name file', kind: 'file',                        // deliberately FIRST in the list
      recognizers: [{ type: 'filename', pattern: '*' }],
      parse_spec_binary: [{ 'read-to-end': { as: 'DATA' } }] },
    { name: 'MSG', label: 'Hello message', recognizers: [{ type: 'regex', pattern: '^HELLO' }] },
  ]);
  deepEq(domEl._detectOrderIdxs(domEl._fmtGetData().specs), [1, 0], 'messages rank before files');
  eq(domEl._fmtDetect(bytes('HELLO WORLD'), {})?.type, 'MSG',
     'message spec wins even though the any-name file spec is listed first');
  eq(domEl._fmtDetect(bytes('SOMETHING ELSE'), {}), null,
     'record without a wrapper filename can never be a file — file specs skipped');
  eq(domEl._fmtDetect(bytes('SOMETHING ELSE'), { filename: '$D.SV.ANYFILE' })?.type, 'FIL',
     'same bytes WITH a filename fall through to the file specs');
  storage.removeItem('up_format_specs');
  domEl._fmtLoad();
});

test('startup sync: field-overlay fills missing default fields, adds missing entities, no resurrection', () => {
  storage.removeItem('up_format_default_seen');
  storage.removeItem('up_format_sync_ver');
  storage.setItem('up_format_specs', JSON.stringify({ specs: [
    { name: 'CUST', label: 'My Custom', recognizers: [] },
    // ISO 8583 Standard exists but WITHOUT a parse_spec (an old saved copy).
    { name: 'ISO', label: 'ISO 8583 Standard', recognizers: [{ type: 'literal', offset: 0, encoding: 'ascii', value: 'ISO' }] },
  ] }));
  domEl._fmtSyncDefaults();
  let specs = JSON.parse(storage.getItem('up_format_specs')).specs;
  const byLabel = l => specs.find(s => s.label === l);
  eq(!!byLabel('My Custom'), true, 'saved custom entity kept');
  eq(!!byLabel('Segmented File'), true, 'a missing built-in default entity is added');
  // Field-overlay: the missing parse_spec is filled from the default…
  eq(Array.isArray(byLabel('ISO 8583 Standard').parse_spec_binary)
     && byLabel('ISO 8583 Standard').parse_spec_binary.length > 0, true, 'missing parse_spec filled from default');
  // …but the saved recognizers are preserved (your data wins on what you set).
  eq(byLabel('ISO 8583 Standard').recognizers.length, 1, 'saved recognizers preserved, not overwritten');
  const count1 = specs.length;
  // Idempotent within the sync version.
  domEl._fmtSyncDefaults();
  eq(JSON.parse(storage.getItem('up_format_specs')).specs.length, count1, 'same sync version → no-op');
  // New sync version + a deleted default: the seen marker keeps it deleted.
  storage.removeItem('up_format_sync_ver');
  const trimmed = { specs: JSON.parse(storage.getItem('up_format_specs')).specs.filter(s => s.label !== 'NDC') };
  storage.setItem('up_format_specs', JSON.stringify(trimmed));
  domEl._fmtSyncDefaults();
  eq(JSON.parse(storage.getItem('up_format_specs')).specs.some(s => s.label === 'NDC'), false,
    'a deleted default is not resurrected');
  storage.removeItem('up_format_specs');
  storage.removeItem('up_format_default_seen');
  storage.removeItem('up_format_sync_ver');
  domEl._fmtLoad();
});

test('a file spec can refine with extra identifiers, but the filename recognizer is mandatory', () => {
  const bytes = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
  domEl._fmtSave([
    // Two versions of the same file: same name pattern, told apart by content
    { name: 'RPTV2', label: 'Report v2', kind: 'file',
      recognizers: [{ type: 'filename', pattern: '$DATA.SUB.RPT*' }, { type: 'regex', pattern: '^V2' }],
      parse_spec_binary: [{ 'read-to-end': { as: 'DATA' } }] },
    { name: 'RPTV1', label: 'Report v1', kind: 'file',
      recognizers: [{ type: 'filename', pattern: '$DATA.SUB.RPT*' }],
      parse_spec_binary: [{ 'read-to-end': { as: 'DATA' } }] },
    // Invalid: kind file but NO filename recognizer — must never match
    { name: 'BAD', label: 'No filename id', kind: 'file',
      recognizers: [{ type: 'regex', pattern: '^ZZ' }],
      parse_spec_binary: [{ 'read-to-end': { as: 'DATA' } }] },
  ]);
  const fname = { filename: '$DATA.SUB.RPT01' };
  eq(domEl._fmtDetect(bytes('V2 CONTENT'), fname)?.type, 'RPTV2', 'version condition refines the same filename');
  eq(domEl._fmtDetect(bytes('OLD CONTENT'), fname)?.type, 'RPTV1', 'falls to the plain filename match otherwise');
  eq(domEl._fmtDetect(bytes('ZZ DATA'), { filename: '$X.Y.OTHER' }), null,
     'a file spec without a filename recognizer never matches, even when its content condition passes');
  storage.removeItem('up_format_specs');
  domEl._fmtLoad();
});

test('an inert file spec (no binding, no parse spec) never claims records', () => {
  const bytes = new Uint8Array([0x41, 0x42]);
  domEl._fmtSave([
    // Catch-all placeholder with nothing to parse — must be skipped entirely
    { name: 'PLACE', label: 'Placeholder', kind: 'file', recognizers: [{ type: 'filename', pattern: '*' }] },
    { name: 'REAL', label: 'Real file', kind: 'file', recognizers: [{ type: 'filename', pattern: '$A.B.C' }],
      parse_spec_binary: [{ 'read-to-end': { as: 'DATA' } }] },
  ]);
  eq(domEl._fmtDetect(bytes, { filename: '$A.B.C' })?.type, 'REAL',
     'inert catch-all is skipped; the actionable spec wins');
  eq(domEl._fmtDetect(bytes, { filename: '$X.Y.OTHER' }), null,
     'a filename only the inert spec would match resolves to nothing');
  storage.removeItem('up_format_specs');
  domEl._fmtLoad();
});

test('file spec matches by wrapper filename; a specific pattern refuses records without one', () => {
  const bytes = new Uint8Array([0x41, 0x42]);
  domEl._fmtSave([
    { name: 'MSG', label: 'msg', recognizers: [{ type: 'regex', pattern: '^ZZZ' }] },
    { name: 'RPT', label: 'Report file', kind: 'file', recognizers: [{ type: 'filename', pattern: '$DATA.SUB.RPT*' }],
      parse_spec_binary: [{ 'read-to-end': { as: 'DATA' } }] },
  ]);
  eq(domEl._fmtDetect(bytes, { filename: '$DATA.SUB.RPT01' })?.type, 'RPT', 'filename pattern matches');
  eq(domEl._fmtDetect(bytes, {}), null, 'no filename on the record → file spec does not claim it');
  storage.removeItem('up_format_specs');
  domEl._fmtLoad();
});

// ── Segmented file parsing (seg-map / segment-fields) ────────────────────────
console.log('\nsegmented file parsing (seg-map / segment-fields)');

const SEG_DDL = `DEF FILE-DUMMY.
  02 SEG0 TYPE BASE-SEGMENT.
  02 SEG1 TYPE ATM-SEGMENT.
  02 SEG5 TYPE POS-SEGMENT.
  02 SEG11 TYPE XX-SEGMENT.
END

DEF BASE-SEGMENT.
  02 B1 PIC X(4).
  02 B2 PIC X(2).
END

DEF ATM-SEGMENT.
  02 A1 PIC X(3).
END

DEF POS-SEGMENT.
  02 P1 PIC X(5).
END

DEF XX-SEGMENT.
  02 X1 PIC X(2).
END
`;

const segItem = value => ({
  name: 'SEGF', kind: 'file', ddl_bindings: ['V/S/SEGFILE/FILE-DUMMY'],
  parse_spec_binary: [
    { 'read-bitmap': value !== undefined ? { bits: 32, value } : { bits: 32 } },
    { 'read-segment-fields': {} },
  ],
});
const segBytes = s => [...s].map(c => c.charCodeAt(0));

// ── File-read seg map: the map is a BINARY 32 field inside SEG0 (Base24 SEG-MAP,
//    or FIID-SEG-MAP on a 6.0 IDF) — read from the record, not supplied. ──
const SEGMAP_FILE_DDL = `DEF FILEMAP.
  02 SEG0 TYPE BASE-SEG.
  02 SEG1 TYPE ATM-SEG.
  02 SEG5 TYPE POS-SEG.
  02 SEG11 TYPE XX-SEG.
END

DEF BASE-SEG.
  02 LGTH TYPE BINARY 16.
  02 SEG-MAP-R.
    04 LW TYPE BINARY 16.
    04 RW TYPE BINARY 16.
  02 SEG-MAP REDEFINES SEG-MAP-R TYPE BINARY 32.
  02 FIID-SEG-MAP TYPE BINARY 32.
  02 B1 PIC X(4).
END

DEF ATM-SEG.
  02 A1 PIC X(3).
END

DEF POS-SEG.
  02 P1 PIC X(5).
END

DEF XX-SEG.
  02 X1 PIC X(2).
END
`;
// Build a FILEMAP record for present segments 0,1,11 (map 0xC0100000). The 4-byte
// map fills SEG-MAP-R (off 2) and/or FIID-SEG-MAP (off 6); the rest is ASCII.
const u32b = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const fileMapBytes = ({ segMap = 0, fiidSegMap = 0 }) => [
  0x00, 0x13,                 // LGTH = 19
  ...u32b(segMap),            // SEG-MAP-R / SEG-MAP  (off 2)
  ...u32b(fiidSegMap),        // FIID-SEG-MAP          (off 6)
  ...segBytes('AAAA'),        // SEG0.B1               (off 10)
  ...segBytes('CCC'),         // SEG1.A1
  ...segBytes('XX'),          // SEG11.X1
];
const fileMapItem = field => ({
  name: 'FMAP', kind: 'file', ddl_bindings: ['V/S/SEGMAPF/FILEMAP'],
  parse_spec_binary: [{ 'read-bitmap': { field } }, { 'read-segment-fields': field }],
});

test('seg-map + segment-fields: only present segments read, mapped by trailing number', () => {
  S.ddlTree = { V: { S: { SEGFILE: SEG_DDL } } };
  // C0100000 → binary 1100 0000 0001 0000 … → bits 0, 1, 11 (SEG5 absent)
  const ctx = meExecParseSpec(segItem('C0100000'), segBytes('AAAABBCCCXX'));
  const ids = ctx.fields.map(f => f.id);
  deepEq(ids, ['SEG-MAP', 'SEG0.B1', 'SEG0.B2', 'SEG1', 'SEG11'], 'field sequence skips SEG5');
  eq(ctx.fields.some(f => f.error), false, 'no errors');
  const by = ctx.fieldsById;
  eq(by['SEG-MAP'].value, 'C0100000', 'map echoed as hex');
  eq(by['SEG-MAP'].valueLength, 0, 'map consumes no payload bytes');
  eq(by['SEG-MAP'].description.includes('0, 1, 11'), true, 'present SEGs listed');
  eq(by['SEG1'].startByte, 6, 'SEG1 starts right after SEG0 (SEG5 gone from the wire)');
  eq(by['SEG1'].value, 'CCC', 'SEG1 bytes');
  eq(by['SEG11'].startByte, 9, 'SEG11 follows SEG1');
  eq(by['SEG11'].value, 'XX', 'SEG11 bytes');
  eq(ctx.cursor, 11, 'whole payload consumed');
});

test('seg-map accepts a binary-digit value; equivalent to the hex form', () => {
  S.ddlTree = { V: { S: { SEGFILE: SEG_DDL } } };
  const ctx = meExecParseSpec(segItem('1100 0000 0001 0000 0000 0000 0000 0000'), segBytes('AAAABBCCCXX'));
  deepEq(ctx.fields.map(f => f.id), ['SEG-MAP', 'SEG0.B1', 'SEG0.B2', 'SEG1', 'SEG11'], 'same result as C0100000');
  eq(ctx.fields.some(f => f.error), false, 'no errors');
});

test('ad-hoc override beats the spec value; leftover bytes are flagged', () => {
  S.ddlTree = { V: { S: { SEGFILE: SEG_DDL } } };
  // Spec says C0100000 but the override narrows to SEG0+SEG1 only.
  const ctx = meExecParseSpec(segItem('C0100000'), segBytes('AAAABBCCCXX'), { segMapOverride: 'C0000000' });
  deepEq(ctx.fields.filter(f => !f.error).map(f => f.id), ['SEG-MAP', 'SEG0.B1', 'SEG0.B2', 'SEG1'], 'override wins');
  eq(ctx.fieldsById['SEG-MAP'].description.includes('ad-hoc'), true, 'source labelled ad-hoc');
  const err = ctx.fields.find(f => f.error);
  eq(err?.error?.includes('2 unparsed byte(s)'), true, 'leftover bytes flagged');
  eq(err?.error?.includes('SEG5'), true, 'absent segments listed as candidates');
});

test('canonical form: read-bitmap declared mode (bits/value) + read-segment-fields reference', () => {
  S.ddlTree = { V: { S: { SEGFILE: SEG_DDL } } };
  const item = {
    name: 'SEGF', kind: 'file', ddl_bindings: ['V/S/SEGFILE/FILE-DUMMY'],
    parse_spec_binary: [
      { 'read-bitmap': { field: 'FIID-SEG-MAP', encoding: 'ascii-hex', bits: 32, value: 'C0100000' } },
      { 'read-segment-fields': 'FIID-SEG-MAP' },
    ],
  };
  const ctx = meExecParseSpec(item, segBytes('AAAABBCCCXX'));
  deepEq(ctx.fields.map(f => f.id), ['FIID-SEG-MAP', 'SEG0.B1', 'SEG0.B2', 'SEG1', 'SEG11'],
    'bits/value flips read-bitmap to declared mode; read-segment-fields resolves the reference');
  eq(ctx.fields.some(f => f.error), false, 'no errors');
  eq(ctx.fieldsById['FIID-SEG-MAP'].valueLength, 0, 'declared mode consumes no payload bytes');
  // "11000000" is 8 chars of 0/1 — hex-LENGTH for a 32-bit map, so auto-detect
  // would silently read it as hex 0x11000000. encoding:"ascii-bits" rejects it.
  const binItem = { ...item, parse_spec_binary: [
    { 'read-bitmap': { field: 'M', encoding: 'ascii-bits', bits: 32, value: '11000000' } },
    { 'read-segment-fields': 'M' },
  ] };
  const bad = meExecParseSpec(binItem, segBytes('AAAABB'));
  eq(bad.fields[0]?.error?.includes('encoding "ascii-bits"'), true,
     'declared ascii-bits encoding refuses an 8-char value instead of mis-reading it as hex');
});

test('ascii-bits value with spaces every 4 chars parses identically to ascii-hex', () => {
  S.ddlTree = { V: { S: { SEGFILE: SEG_DDL } } };
  const spaced = {
    name: 'SEGF', kind: 'file', ddl_bindings: ['V/S/SEGFILE/FILE-DUMMY'],
    parse_spec_binary: [
      // C0100000 = 1100 0000 0001 0000 … → bits 0, 1, 11 (SEG0, SEG1, SEG11)
      { 'read-bitmap': { field: 'M', encoding: 'ascii-bits', bits: 32,
                         value: '1100 0000 0001 0000 0000 0000 0000 0000' } },
      { 'read-segment-fields': 'M' },
    ],
  };
  const ctx = meExecParseSpec(spaced, segBytes('AAAABBCCCXX'));
  deepEq(ctx.fields.map(f => f.id), ['M', 'SEG0.B1', 'SEG0.B2', 'SEG1', 'SEG11'],
    'spaces are ignored; same segments as the C0100000 hex form');
  eq(ctx.fields.some(f => f.error), false, 'no errors');
});

test('legacy block names + mid-session encodings are auto-migrated on load (no runtime aliases)', () => {
  S.ddlTree = { V: { S: { SEGFILE: SEG_DDL } } };
  const spec = migrateSpec({
    name: 'SEGF', kind: 'file', ddl_bindings: ['V/S/SEGFILE/FILE-DUMMY'],
    parse_spec_binary: [
      { 'seg-map': { field: 'FIID-SEG-MAP', bits: 32, value: 'C0100000', encoding: 'hex' } },
      { 'segment-fields': 'FIID-SEG-MAP' },
    ],
    parse_spec_binary_source:
      '[ { "read-bitmap": { "field": "B", "encoding": "hex" } }, { "bitmap-fields": "B" }, { "seg-map": {} }, { "segment-fields": {} } ]',
  });
  // Arrays: block keys renamed in place; declared "hex" → "ascii-hex"
  deepEq(spec.parse_spec_binary.map(b => Object.keys(b)[0]),
    ['read-bitmap', 'read-segment-fields'], 'seg-map → read-bitmap, segment-fields → read-segment-fields');
  eq(spec.parse_spec_binary[0]['read-bitmap'].bits, 32, 'declared-map attrs preserved');
  eq(spec.parse_spec_binary[0]['read-bitmap'].encoding, 'ascii-hex', 'declared hex → ascii-hex in array');
  // Source text: block names rewritten; wire-mode "hex" is canonical and preserved
  eq(/"seg-map"|"segment-fields"|"bitmap-fields"/.test(spec.parse_spec_binary_source), false,
    'no legacy block-name tokens remain in the source');
  eq(spec.parse_spec_binary_source.includes('"read-bitmap-fields"'), true, 'bitmap-fields → read-bitmap-fields in source');
  eq(/"encoding"\s*:\s*"hex"/.test(spec.parse_spec_binary_source), true, 'wire-mode "hex" preserved in source (now canonical)');
  // A source seg-map with no bits/value still becomes read-bitmap in text
  eq((spec.parse_spec_binary_source.match(/"read-bitmap"/g) || []).length, 2, 'both read-bitmap and the ex-seg-map present');
  // Declared "binary" migrates to "ascii-bits"; wire "binary" is left alone;
  // wire "ascii-hex" migrates to the canonical "hex"; declared "hex" → "ascii-hex".
  const encSpec = migrateSpec({ parse_spec_binary: [
    { 'read-bitmap': { field: 'W', encoding: 'binary' } },                       // wire → stays binary
    { 'read-bitmap': { field: 'D', bits: 32, value: '1'.repeat(32), encoding: 'binary' } }, // declared → ascii-bits
    { 'read-bitmap': { field: 'H', encoding: 'ascii-hex' } },                    // wire → hex
    { 'read-bitmap': { field: 'DH', bits: 32, value: 'C0100000', encoding: 'hex' } }, // declared → ascii-hex
  ] });
  eq(encSpec.parse_spec_binary[0]['read-bitmap'].encoding, 'binary', 'wire binary (raw bytes) untouched');
  eq(encSpec.parse_spec_binary[1]['read-bitmap'].encoding, 'ascii-bits', 'declared binary → ascii-bits');
  eq(encSpec.parse_spec_binary[2]['read-bitmap'].encoding, 'hex', 'wire ascii-hex → hex (canonical)');
  eq(encSpec.parse_spec_binary[3]['read-bitmap'].encoding, 'ascii-hex', 'declared hex → ascii-hex');
  // And the migrated spec executes correctly through the canonical names only
  const ctx = meExecParseSpec(spec, segBytes('AAAABBCCCXX'));
  eq(ctx.fields.some(f => f.id === 'SEG1' && !f.error), true, 'migrated spec parses the present segments');
});

test('source migration: wire-mode read-bitmap "ascii-hex" → "hex"; declared-mode "ascii-hex" kept', () => {
  const spec = migrateSpec({
    parse_spec_binary_source:
      '[ { "read-bitmap": { "field": "W", "encoding": "ascii-hex" } }, ' +
      '{ "read-bitmap": { "field": "D", "encoding": "ascii-hex", "bits": 32, "value": "C0100000" } } ]',
  });
  const src = spec.parse_spec_binary_source;
  eq(/"field": "W", "encoding": "hex"/.test(src), true, 'wire ascii-hex → hex in source');
  eq(/"field": "D", "encoding": "ascii-hex"/.test(src), true, 'declared-mode ascii-hex kept in source');
});

test('a stray legacy block name is NOT executed (aliases removed)', () => {
  S.ddlTree = { V: { S: { SEGFILE: SEG_DDL } } };
  // Bypass migration: feed the executor an un-migrated legacy name directly.
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: [],
    parse_spec_binary: [{ 'bitmap-fields': 'NOPE' }] }, segBytes('AA'));
  eq(ctx.fields[0]?.error?.includes('not recognized'), true, 'legacy name is unknown to the executor');
});

test('main-flow adapter: engine fields gain rawBytes; score is the errorless ratio', () => {
  S.ddlTree = { V: { S: { SEGFILE: SEG_DDL } } };
  const r = meParseFileWithSpec(segItem('C0100000'), segBytes('AAAABBCCCXX'));
  eq(r.score, 1, 'clean parse scores 1');
  deepEq(r.fields.find(f => f.id === 'SEG1').rawBytes, [0x43, 0x43, 0x43], 'rawBytes decoded for the renderer');
  // Truncated payload → error rows → score drops below the 0.95 warning bar
  const bad = meParseFileWithSpec(segItem('C0100000'), segBytes('AAAABB'));
  eq(bad.score < 0.95, true, 'errors depress the score');
});

test('seg-map without any value, and with a malformed value, error clearly', () => {
  S.ddlTree = { V: { S: { SEGFILE: SEG_DDL } } };
  const noVal = meExecParseSpec(segItem(undefined), segBytes('AAAABB'));
  eq(noVal.fields[0]?.error?.includes('no value'), true, 'missing value reported');
  const bad = meExecParseSpec(segItem('ZZZZ'), segBytes('AAAABB'));
  eq(bad.fields[0]?.error?.includes('hex chars or'), true, 'malformed value reported');
});

test('file-read: SEG-MAP read from the record (Base24 <6.0) drives segment selection', () => {
  S.ddlTree = { V: { S: { SEGMAPF: SEGMAP_FILE_DDL } } };
  const bytes = fileMapBytes({ segMap: 0xC0100000 });   // bits 0,1,11 → SEG0,SEG1,SEG11
  const ctx = meExecParseSpec(fileMapItem('SEG-MAP'), bytes, { format: 'hex', rawBytes: bytes });
  eq(ctx.fields.some(f => f.error), false, 'no errors');
  const map = ctx.fieldsById['SEG-MAP'];
  eq(map.value, 'C0100000', 'map echoed as hex from the file bytes');
  eq([...map.segSet].sort((a, b) => a - b).join(','), '0,1,11', 'segSet decoded from the record');
  eq(map.description.includes('read from file'), true, 'labelled read-from-file');
  // REDEFINES map — the DDL's OWN field row (SEG0.SEG-MAP), emitted as an
  // overlay at its declared position, never as element 1 of the results.
  const row = ctx.fields.find(f => f.id === 'SEG0.SEG-MAP');
  eq(!!row, true, 'SEG0.SEG-MAP row present exactly as the DDL declares it');
  eq(ctx.fields.indexOf(row), 3, 'placed right after SEG-MAP-R.RW (LGTH, LW, RW, SEG-MAP)');
  eq(row.startByte, 2, 'row carries the real start offset');
  eq(row.endByte, 5, 'row carries the real end offset');
  eq(row.isRedefines, true, 'overlay row is marked REDEFINES');
  eq(row.description.includes('SEGs present: 0, 1, 11'), true, 'map annotation on the DDL field row');
  // Display overrides reach the REDEFINES row like any other field.
  const ctxB = meExecParseSpec({ ...fileMapItem('SEG-MAP'),
    field_overrides: [{ field: 'SEG0.SEG-MAP', display: 'bitmap' }] },
    bytes, { format: 'hex', rawBytes: bytes });
  eq(ctxB.fields.find(f => f.id === 'SEG0.SEG-MAP').displayValue,
     '1100 0000 0001 0000 0000 0000 0000 0000', 'bitmap display override applies to the SEG-MAP overlay row');
  const segsRead = [...new Set(ctx.fields.filter(f => !f.error && /^SEG\d+/.test(f.id)).map(f => f.id.match(/^SEG(\d+)/)[1]))];
  deepEq(segsRead, ['0', '1', '11'], 'SEG5 skipped (bit clear)');
  eq(ctx.fieldsById['SEG1'].value, 'CCC', 'SEG1 payload');
  eq(ctx.fieldsById['SEG11'].value, 'XX', 'SEG11 payload');
  eq(ctx.cursor, bytes.length, 'whole record consumed');
});

test('file-read: FIID-SEG-MAP read from the record (6.0 IDF) drives segment selection', () => {
  S.ddlTree = { V: { S: { SEGMAPF: SEGMAP_FILE_DDL } } };
  const bytes = fileMapBytes({ fiidSegMap: 0xC0100000 });  // SEG-MAP zeroed; map on FIID-SEG-MAP
  const ctx = meExecParseSpec(fileMapItem('FIID-SEG-MAP'), bytes, { format: 'hex', rawBytes: bytes });
  eq(ctx.fields.some(f => f.error), false, 'no errors');
  eq(ctx.fieldsById['FIID-SEG-MAP'].value, 'C0100000', 'map read from the FIID-SEG-MAP field bytes');
  // Plain field map — its own row (at its position) carries the annotation;
  // no extra synthetic row is emitted.
  const row = ctx.fields.find(f => f.id === 'SEG0.FIID-SEG-MAP');
  eq(row.description.includes('SEGs present: 0, 1, 11'), true, 'field row annotated with the decoded map');
  eq([...row.segSet].join(','), '0,1,11', 'segSet attached to the field row');
  eq(ctx.fields.filter(f => /FIID-SEG-MAP/.test(f.id)).length, 1, 'no duplicate map row');
  eq(ctx.fields.findIndex(f => f.id === 'SEG0.FIID-SEG-MAP'), 4, 'row sits at its declared position (after LGTH, LW, RW, SEG-MAP overlay)');
  eq(ctx.fieldsById['SEG1'].value, 'CCC', 'SEG1 payload');
  eq(ctx.fieldsById['SEG11'].value, 'XX', 'SEG11 payload');
});

test('file-read: all-zeros map errors (the 6.0 signal) — no silent fallback', () => {
  S.ddlTree = { V: { S: { SEGMAPF: SEGMAP_FILE_DDL } } };
  const bytes = fileMapBytes({ segMap: 0, fiidSegMap: 0 });
  const ctx = meExecParseSpec(fileMapItem('SEG-MAP'), bytes, { format: 'hex', rawBytes: bytes });
  const err = ctx.fields.find(f => f.error);
  eq(err?.error?.includes('all zeros'), true, 'all-zeros map surfaced as an error');
  eq(ctx.fields.some(f => f.segSet), false, 'no seg map established, so no segments read');
});

test('wire read-bitmap: strict field resolution — top-level short name or fully qualified path', () => {
  // BIC-style merged DDL: the ISO layout nested under a group, so the bitmap's
  // id is ISOPSEM.PRI-BIT-MAP (no top-level PRI-BIT-MAP exists).
  S.ddlTree = { V: { S: { BICW: `DEF BICW.
  02 ISOPSEM.
    03 TYP PIC X(4).
    03 PRI-BIT-MAP PIC X(16).
  02 TRAILER PIC X(2).
END
` } } };
  const mk = field => ({ name: 'BW', ddl_bindings: ['V/S/BICW/BICW'],
    parse_spec_binary: [{ 'read-bitmap': { field, encoding: 'ascii-hex' } }] });
  const bytes = segBytes('0000000000000000');   // 16 hex chars → primary only
  const ok = meExecParseSpec(mk('ISOPSEM.PRI-BIT-MAP'), bytes);
  eq(ok.fields.some(f => f.error), false, 'fully qualified path resolves');
  eq(ok.fields[0].id, 'ISOPSEM.PRI-BIT-MAP', 'row keeps the declared id');
  const bad = meExecParseSpec(mk('PRI-BIT-MAP'), bytes);
  eq(bad.fields[0]?.error?.includes('not found in the bound DDL'), true,
     'bare leaf name rejected when the field is nested — must use the qualified path');
  // No bindings resolved → nothing to validate against; reads generically.
  const unbound = meExecParseSpec({ name: 'NB', ddl_bindings: [],
    parse_spec_binary: [{ 'read-bitmap': { field: 'ANY-MAP', encoding: 'ascii-hex' } }] }, bytes);
  eq(unbound.fields.some(f => f.error), false, 'unbound spec is not blocked');
});

test('file-read: the SEG-MAP input still overrides the on-file map', () => {
  S.ddlTree = { V: { S: { SEGMAPF: SEGMAP_FILE_DDL } } };
  const bytes = fileMapBytes({ segMap: 0xC0100000 });   // file says 0,1,11
  // Override to SEG0 only → SEG1 & SEG11 become leftover bytes.
  const ctx = meExecParseSpec(fileMapItem('SEG-MAP'), bytes, { format: 'hex', rawBytes: bytes, segMapOverride: '80000000' });
  eq(ctx.fieldsById['SEG-MAP'].description.includes('ad-hoc'), true, 'override path taken, not the file bytes');
  eq([...ctx.fieldsById['SEG-MAP'].segSet].join(','), '0', 'override narrows to SEG0');
  const err = ctx.fields.find(f => f.error);
  eq(err?.error?.includes('unparsed byte'), true, 'the un-mapped segments are flagged as leftover');
});

// ── Parse-flow routing: WHICH parser handles a recognized message ────────────
// These are integration tests, not unit tests. The costliest bug this codebase
// has had was not wrong parsing logic — it was the plain-paste flow never
// calling the parse-spec engine at all, so a spec's `repeat count` block never
// ran and a legacy heuristic silently produced the fields. Unit tests could not
// see it. These assert the ROUTING DECISION and count which parser actually
// executed, so that class of drift fails loudly.
console.log('\nparse-flow routing (which parser ran)');

const {
  meSpecNeedsBinding, meSpecHasNoParseSpec, meParseWithChosenBinding,
  meWinningSpec, fmtSpecByName,
} = sandbox._t;

// PSTM-shaped DDL matching the real BASE24 layout well enough to exercise the
// shipped PSTM parse_spec (read-ddl until NUM-SERVICES → repeat → when → tokens).
const ROUTE_DDL = `DEFINITION PSTM.
  02 TYP           PIC X(4).
  02 PROD-ID       PIC X(2).
  02 USER-FLG      PIC X.
  02 NUM-SERVICES  TYPE BINARY 16.
  02 SRVCS         OCCURS 30 TIMES.
    04 SRVC-CDE    PIC X(2).
    04 SRVC-DATA   PIC X(10).
END
`;
// 5 services declared, then user data, then the token area.
function routeBytes() {
  const b = [], p = s => { for (const c of s) b.push(c.charCodeAt(0)); };
  p('0210'); p('02'); p('0');          // USER-FLG '0' → skip the user-data branch
  b.push(0x00, 5);
  for (const t of ['CK', 'SV', 'CC', 'LN', 'MM']) { p(t); p('SERVICEDAT'); }
  p('& '); p('TK01');
  return b;
}
// Count which parser executes by intercepting both entry points in the sandbox.
function withParserCounters(fn) {
  const origEngine = sandbox._meParseFileWithSpec;
  const origLegacy = sandbox.bestDDLMatch;
  const calls = { engine: 0, legacy: 0 };
  sandbox._meParseFileWithSpec = function (...a) { calls.engine++; return origEngine.apply(this, a); };
  sandbox.bestDDLMatch        = function (...a) { calls.legacy++; return origLegacy.apply(this, a); };
  try { return { calls, result: fn() }; }
  finally { sandbox._meParseFileWithSpec = origEngine; sandbox.bestDDLMatch = origLegacy; }
}
const routeSegCount = fields => new Set(fields.filter(f => /^SRVCS/.test(f.id))
  .map(f => (/\[(\d+)\]/.exec(f.id) || [])[1]).filter(Boolean)).size;

test('routing: classification of the shipped specs (needs-binding / no-parse-spec)', () => {
  // PSTM ships WITH a parse_spec and WITHOUT a ddl_binding — it must be flagged
  // as needing one, which is what forces the DDL picker instead of a silent
  // downgrade to the legacy walk.
  eq(meSpecNeedsBinding({ type: 'PSTM', label: 'PSTM' }), true, 'PSTM needs a binding');
  eq(meSpecHasNoParseSpec({ type: 'PSTM', label: 'PSTM' }), false, 'PSTM does have a parse_spec');
  // ISO 8583 Standard ships bound — it must NOT prompt.
  eq(meSpecNeedsBinding({ type: 'ISO', label: 'ISO 8583 Standard' }), false, 'bound spec needs nothing');
  // Base24 Generic ships with recognizers only — recognized but unparseable.
  eq(meSpecHasNoParseSpec({ type: 'B24', label: 'Base24 Generic' }), true, 'Base24 Generic has no parse_spec');
  // An unrecognized/legacy-regex winner resolves to no spec at all.
  eq(meSpecHasNoParseSpec({ type: 'UNKNOWN', label: 'Unknown' }), false, 'UNKNOWN is not a spec');
  eq(meSpecNeedsBinding({ type: 'UNKNOWN', label: 'Unknown' }), false, 'UNKNOWN never prompts');
});

test('routing: unbound spec + picked DDL → ENGINE runs the parse_spec, not the legacy walk', () => {
  // This is the production PSTM scenario: recognized, no binding, user picks a
  // DDL from the scores popup. The pick must FILL the binding and the spec's
  // own parse_spec must execute — that is what reads NUM-SERVICES services.
  S.ddlTree = { POS: { SV: { PSTM: ROUTE_DDL } } };
  S.inputFormat = 'hex';
  const bytes = routeBytes();
  const { calls, result } = withParserCounters(() =>
    meParseWithChosenBinding({ type: 'PSTM', label: 'PSTM' },
      { ddlPath: 'POS/SV/PSTM', defName: 'PSTM' }, bytes, { format: 'hex', rawBytes: bytes }));
  eq(!!result, true, 'routing returns an engine result, so the caller uses it');
  eq(calls.engine >= 1, true, 'the parse-spec engine executed');
  eq(calls.legacy, 0, 'the legacy DDL walk was NOT used');
  eq(routeSegCount(result.fields), 5, 'the spec\'s repeat block read exactly NUM-SERVICES services');
});

test('routing: a spec\'s OWN binding wins and never prompts', () => {
  // With a binding present the picker answer is irrelevant — passing chosen=null
  // (what the MATCH short-circuit does) must still parse.
  S.ddlTree = { POS: { SV: { PSTM: ROUTE_DDL } } };
  S.inputFormat = 'hex';
  const spec = fmtSpecByName('PSTM');
  const orig = spec.ddl_bindings;
  spec.ddl_bindings = ['POS/SV/PSTM/PSTM'];
  try {
    eq(meSpecNeedsBinding({ type: 'PSTM', label: 'PSTM' }), false, 'a bound spec no longer needs a binding');
    const bytes = routeBytes();
    const { calls, result } = withParserCounters(() =>
      meParseWithChosenBinding({ type: 'PSTM', label: 'PSTM' }, null, bytes, { format: 'hex', rawBytes: bytes }));
    eq(!!result, true, 'parses with no DDL chosen at all');
    eq(calls.engine >= 1, true, 'engine executed');
    eq(calls.legacy, 0, 'legacy not used');
    eq(routeSegCount(result.fields), 5, 'five services');
  } finally { spec.ddl_bindings = orig; }
});

test('routing: falls back to legacy only when there is genuinely nothing to run', () => {
  S.ddlTree = { POS: { SV: { PSTM: ROUTE_DDL } } };
  S.inputFormat = 'hex';
  const bytes = routeBytes();
  // (a) unbound spec and NO DDL chosen → nothing to walk → caller keeps legacy
  eq(meParseWithChosenBinding({ type: 'PSTM', label: 'PSTM' }, null, bytes, { format: 'hex', rawBytes: bytes }),
     null, 'unbound + unchosen yields no engine result');
  // (b) a spec with no parse_spec at all → never routed to the engine
  eq(meParseWithChosenBinding({ type: 'B24', label: 'Base24 Generic' },
     { ddlPath: 'POS/SV/PSTM', defName: 'PSTM' }, bytes, { format: 'hex', rawBytes: bytes }),
     null, 'no parse_spec → no engine result');
  // (c) an unrecognized message never routes to the engine
  eq(meParseWithChosenBinding({ type: 'UNKNOWN', label: 'Unknown' },
     { ddlPath: 'POS/SV/PSTM', defName: 'PSTM' }, bytes, { format: 'hex', rawBytes: bytes }),
     null, 'UNKNOWN → no engine result');
});

test('routing: an engine run that yields nothing usable does not displace legacy', () => {
  // Guard against the opposite failure: routing to the engine and ending up with
  // an empty/error-only result would be worse than the legacy walk.
  S.ddlTree = { POS: { SV: { PSTM: ROUTE_DDL } } };
  S.inputFormat = 'hex';
  const spec = fmtSpecByName('PSTM');
  const orig = spec.ddl_bindings;
  spec.ddl_bindings = ['POS/SV/NOPE/NOPE'];      // binding that cannot resolve
  try {
    const r = meParseWithChosenBinding({ type: 'PSTM', label: 'PSTM' }, null,
      routeBytes(), { format: 'hex', rawBytes: routeBytes() });
    eq(r, null, 'unusable engine output is rejected so the caller keeps the legacy result');
  } finally { spec.ddl_bindings = orig; }
});

// ── Parse-spec engine ≡ legacy extraction (migration equivalence) ─────────────
console.log('\nparse-spec engine vs legacy extraction equivalence');

const ISO_DDL = `DEF TESTISO.
  02 START-OF-TEXT PIC X(3).
  02 TYP PIC X(4).
  02 PRI-BIT-MAP PIC X(16).
  02 SEC-BIT-MAP PIC X(16).
  02 PAN.
    03 PAN-LEN PIC 9(2).
    03 PAN-DATA PIC X(19).
  02 PROC-CODE PIC X(6).
  02 TRAN-AMT PIC X(12).
END
`;
const ISO_SPEC = {
  name: 'TISO', ddl_bindings: ['ZZISO/SV/T/TESTISO'],
  parse_spec_binary: [
    { 'read-ddl': { binding: 0, from: 'START-OF-TEXT', until: 'TYP' } },
    { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'ascii-hex' } },
    { 'read-bitmap-fields': 'PRI-BIT-MAP' },
  ],
};
// Build a primary-bitmap ISO message with DEs {2:PAN LLVAR, 3, 4} present.
const buildIso = panLen => {
  const bmp = [0,0,0,0,0,0,0,0];
  for (const b of [2,3,4]) bmp[Math.floor((b-1)/8)] |= (0x80 >> ((b-1)%8));
  const bmpHex = bmp.map(x => x.toString(16).padStart(2,'0').toUpperCase()).join('');
  const digits = n => '0123456789'.repeat(Math.ceil(n/10)).slice(0,n);
  const s = 'ISO' + '0210' + bmpHex
    + String(panLen).padStart(2,'0') + digits(panLen)   // PAN LLVAR: LEN + data
    + digits(6) + digits(12);                            // PROC-CODE, TRAN-AMT (fixed)
  return [...s].map(c => c.charCodeAt(0) & 0xFF);
};

test('engine read-bitmap-fields honors LLVAR length prefix, matching legacy parseHPEISOMessage', () => {
  S.ddlTree = { ZZISO: { SV: { T: ISO_DDL } } };
  S.inputFormat = 'ascii';
  const defs = getDDLFromPath('ZZISO/SV/T/TESTISO').defs;
  for (const panLen of [8, 5, 19]) {          // partial and full-length PAN
    const bytes = buildIso(panLen);
    const legacy = parseHPEISOMessage(bytes, defs, bytes);
    const engine = meExecParseSpec(ISO_SPEC, bytes).fields.filter(f => !f.error);
    eq(engine.length, legacy.length, `PAN=${panLen}: same field count`);
    for (let i = 0; i < legacy.length; i++) {
      const L = legacy[i], E = engine[i];
      eq(E.id, L.id, `PAN=${panLen} #${i}: id`);
      eq(E.startByte, L.startByte, `PAN=${panLen} field ${L.id}: offset`);
      eq(E.value ?? '', L.value ?? '', `PAN=${panLen} field ${L.id}: value`);
    }
    // The variable field really did shrink to the LEN prefix (not declared max 19)
    const panData = engine.find(f => f.id === 'PAN.PAN-DATA');
    eq(panData.valueLength, panLen, `PAN=${panLen}: DATA consumed exactly LEN bytes`);
  }
});

test('engine read-ddl flat walk matches legacy parseFlatMessage — incl. TYPE BINARY across formats', () => {
  const FLAT = `DEF FLATREC.
  02 A PIC X(4).
  02 B PIC 9(2).
  02 GRP.
    03 G1 PIC X(3).
    03 G2 PIC X(2).
  02 BIN2 TYPE BINARY 16.
  02 BIN8 TYPE BINARY 64.
  02 C PIC X(5).
END
`;
  S.ddlTree = { ZZ: { S: { F: FLAT } } };
  const defs = getDDLFromPath('ZZ/S/F/FLATREC').defs;
  // A(4) B(2) G1(3) G2(2) BIN2(2) BIN8(8) C(5) = 26 bytes; BIN fields carry
  // non-printable bytes (0x00, 0xFF) so binary decode actually differs by format.
  const bytes = [
    ...[...'ABCD12XYZ12'].map(c=>c.charCodeAt(0)&0xFF),
    0x00, 0xFF,                                   // BIN2
    0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,      // BIN8
    ...[...'HELLO'].map(c=>c.charCodeAt(0)&0xFF),
  ];
  const spec = { name: 'F', ddl_bindings: ['ZZ/S/F/FLATREC'], parse_spec_binary: [{ 'read-ddl': { binding: 0 } }] };
  for (const fmt of ['ascii', 'netard-ascii', 'hexascii', 'netard-dump', 'hex']) {
    S.inputFormat = fmt;
    const legacy = parseFlatMessage(bytes, defs, bytes);
    const engine = meExecParseSpec(spec, bytes, { format: fmt, rawBytes: bytes }).fields.filter(f => !f.error);
    eq(engine.length, legacy.length, `[${fmt}] same field count`);
    for (let i = 0; i < legacy.length; i++) {
      eq(engine[i].id, legacy[i].id, `[${fmt}] #${i} id`);
      eq(engine[i].startByte, legacy[i].startByte, `[${fmt}] ${legacy[i].id} offset`);
      eq(engine[i].value ?? '', legacy[i].value ?? '', `[${fmt}] ${legacy[i].id} value`);
    }
  }
});

// ── Manual override: no spec config, and provenance says so ───────────────────
// Regression cover for v1.1.2.397–.404. Manual override parses strictly per the
// selected DDL and prints "Identify · Recognizers · Parse-specs — not used", but
// specs are looked up by NAME and manual override labels the message with the
// DDL's DEF name — so a DEF sharing a name with a spec (BASE/STM/DDLFSTM/STM vs
// the "STM" spec) silently inherited that spec's field_overrides at render time.
// Shipped broken twice: the first fix flagged only 2 of the 3 assembly sites.

const OVR_SPEC = { name: 'STM', field_overrides: [{ field: 'TYP', type: 'binary' }] };
function ovrMsg(manual) {
  return {
    msgType: { type: 'STM', label: 'STM' }, manualOverride: manual,
    bytes: [], raw: '', tokens: [],
    fields: [{ id: 'TYP', name: 'TYP', dataType: 'PIC 9(4)', offset: 0, length: 4,
               value: '0210', rawHex: '30323130', rawBytes: [0x30, 0x32, 0x31, 0x30] }],
  };
}

console.log('\nmanual override — spec field_overrides must not leak into rendering');

test('manual override: a same-named spec does NOT override the field', () => {
  setSpecLookup(() => OVR_SPEC);
  const m = ovrMsg(true);
  renderFieldTable(m);
  const typ = m.fields[0];
  eq(typ.value, '0210', 'value stays as the DDL parsed it');
  eq(typ.typeOverride, undefined, 'no type override recorded');
  eq(typ.dataType, 'PIC 9(4)', 'declared type untouched');
});

test('normal parse: the same spec DOES override the field (guard is not too wide)', () => {
  setSpecLookup(() => OVR_SPEC);
  const m = ovrMsg(false);
  renderFieldTable(m);
  const typ = m.fields[0];
  eq(typ.value, '0x30323130', 'converted by the binary override');
  eq(typ.typeOverride, 'binary', 'override recorded');
  eq(typ.dataType, 'PIC 9(4)', 'declared type preserved alongside the override');
});

// ── An overridden field is judged by the override, not by the DDL ───────────
// The declared type is deliberately kept on the field so the Type column can
// show "declared ↩ override". The content-vs-type check went on reading it, so
// every field whose override made its bytes legal stayed red anyway.

console.log('\ncontent validation follows the type override');

// PIC 9(4) — declared digits — holding bytes that are NOT digits. Exactly the
// case someone overrides the type to explain.
function ovrBadBytesMsg(type) {
  return {
    msgType: { type: 'STM', label: 'STM' }, manualOverride: false,
    bytes: [], raw: '', tokens: [],
    fields: [{ id: 'TYP', name: 'TYP', dataType: 'PIC 9(4)', offset: 0, length: 4,
               value: '', rawHex: '00131A2B', rawBytes: [0x00, 0x13, 0x1A, 0x2B] }],
  };
}
// renderFieldTable writes to the DOM rather than returning markup, so the rule
// itself is the unit under test — renderFieldTable is still run first, because
// that is what puts the override onto the field.
function ovrRendered(spec) {
  setSpecLookup(() => spec);
  const m = ovrBadBytesMsg();
  renderFieldTable(m);
  setSpecLookup(() => null);
  return m.fields[0];
}

test('without an override, non-digit bytes in a PIC 9 are still flagged', () => {
  assert.ok(meContentLooksWrong(ovrRendered(null)), 'the check still does its job');
});

test('a hex-char override stops the field being painted red', () => {
  const f = ovrRendered({ name: 'STM', field_overrides: [{ field: 'TYP', type: 'hex-char' }] });
  eq(f.typeOverride, 'hex-char', 'the override was applied');
  eq(f.dataType, 'PIC 9(4)', 'and the declared type is still there for the annotation');
  assert.ok(!meContentLooksWrong(f), 'but the bytes are judged as hex, which is what the user said they are');
});

test('an ascii override still expects printable bytes', () => {
  // ascii maps to X, not to B: overriding to ascii is a claim ABOUT the bytes,
  // so a control byte is still worth flagging.
  const f = ovrRendered({ name: 'STM', field_overrides: [{ field: 'TYP', type: 'ascii' }] });
  eq(f.typeOverride, 'ascii', 'the override was applied');
  assert.ok(meContentLooksWrong(f), '0x00 is not printable ASCII');
});

// ── The row annotation describes what was APPLIED, not what was configured ──
// The "↩ type as DISPLAY" annotation and its tooltip were built only from the
// spec's stored overrides map. An override carried INLINE in the parse-spec has
// no entry there, so a bitmap displayed as "bitmap-list" from the spec rendered
// the formatted value with nothing saying why it looked like that.

console.log('\nrow annotation follows the applied override');

test('an override applied by the engine annotates the row', () => {
  const f = { id: 'PRI-BIT-MAP', displayOverride: 'bitmap-list' };
  deepEq(meFieldOvrAnnotation(f, null), { type: null, display: 'bitmap-list' },
    'the field records what was applied — the stored map never saw it');
});

test('the stored map still annotates when the field carries nothing', () => {
  // The render-time path: a legacy/manual parse where overrides are applied by
  // the renderer, so the field has not been through the engine.
  const f = { id: 'TYP' };
  deepEq(meFieldOvrAnnotation(f, { type: 'hex-char', display: 'hex' }),
    { type: 'hex-char', display: 'hex' }, 'falls back to the configured map');
});

test('what was applied wins over what was configured', () => {
  // Inline beats the panel in the engine, so the annotation has to agree —
  // otherwise the row would name an override that did not run.
  const f = { id: 'TYP', typeOverride: 'hex-char' };
  eq(meFieldOvrAnnotation(f, { type: 'binary' }).type, 'hex-char',
    'the row names the override that actually ran');
});

test('a REDEFINES overlay is never flagged', () => {
  assert.ok(!meContentLooksWrong({ dataType: 'PIC 9(4)', isRedefines: true, rawBytes: [0x00] }),
     'it re-views bytes already judged where they were read');
});

test('manual override: a display override is skipped too, not just the type', () => {
  setSpecLookup(() => ({ name: 'STM', field_overrides: [{ field: 'TYP', display: 'amount' }] }));
  const m = ovrMsg(true);
  renderFieldTable(m);
  eq(m.fields[0].displayOverride, undefined, 'no display override applied');
  eq(m.fields[0].displayValue, undefined, 'no formatted value produced');
  setSpecLookup(() => null);
});

// Structural tripwire for the mistake that shipped: a manual-override path added
// without the flag. Every "Manual override mode" progress step must be followed by
// a message assembly that marks the message AND records its provenance.
test('every manual-override path flags the message and sets parsedBy', () => {
  const STEP = '_parseProgressStep(`Manual override mode';
  const idxs = [];
  for (let i = html.indexOf(STEP); i !== -1; i = html.indexOf(STEP, i + 1)) idxs.push(i);
  assert.ok(idxs.length >= 3,
    `expected at least 3 manual-override sites, found ${idxs.length} — did the notice text change?`);
  idxs.forEach((start, n) => {
    const region = html.slice(start, idxs[n + 1] ?? start + 9000);
    const line   = html.slice(0, start).split('\n').length;
    assert.ok(region.includes('manualOverride: true'),
      `manual-override site at source.html:${line} does not set manualOverride: true — ` +
      `its message will inherit a same-named spec's field_overrides`);
    assert.ok(region.includes("parsedBy: 'manual override'"),
      `manual-override site at source.html:${line} does not set parsedBy — ` +
      `the Parse Results provenance field renders empty instead of "manual override"`);
  });
});

test('the spec lookup that feeds field_overrides is guarded on manualOverride', () => {
  const i = html.indexOf('window._fmtSpecByName(msg.msgType.type)');
  assert.ok(i !== -1, 'spec lookup not found — was it renamed?');
  const stmt = html.slice(html.lastIndexOf('const _msgSpec', i), i);
  assert.ok(stmt.includes('!msg.manualOverride'),
    'the _msgSpec lookup must be skipped in manual override mode');
});

// ── Type overrides: hex family, and the declared type survives ────────────────
// v1.1.2.394–.395. Renamed with no aliases at the user's request; hex-char is the
// TAL binary^hexchar conversion (00 13 -> "0013"), which nothing else provided.

console.log('\ntype overrides — hex family');

test('hex-char renders raw bytes as hex characters (TAL binary^hexchar)', () => {
  eq(meReadApplyTypeOverride({ rawHex: '0013' }, 'hex-char').value, '0013', '00 13 -> "0013"');
  eq(meReadApplyTypeOverride({ rawHex: '4354' }, 'hex-char').value, '4354', '43 54 -> "4354"');
});

test('hex-ascii-decimal reads hex digits held as ASCII text', () => {
  eq(meReadApplyTypeOverride({ rawHex: '30304646' }, 'hex-ascii-decimal').value, '255', '"00FF" -> 255');
});

test('hex-ebcdic-decimal reads hex digits held as EBCDIC text', () => {
  eq(meReadApplyTypeOverride({ rawHex: 'F0F0C6C6' }, 'hex-ebcdic-decimal').value, '255', '"00FF" -> 255');
});

test('the old hex names are gone — no aliases, no silent fallback', () => {
  for (const dead of ['hex-ascii', 'hex-ebcdic', 'hex-decimal']) {
    eq(meReadApplyTypeOverride({ rawHex: '30304646' }, dead).value, undefined,
       `"${dead}" must not convert`);
  }
});

test('a type override never replaces the declared DDL type', () => {
  const out = meReadApplyTypeOverride({ rawHex: '0013' }, 'uint16-be');
  assert.ok(!('dataType' in out),
    'returning dataType clobbered the declared type, which is what made the ' +
    'override column read "binary ↩ binary" instead of "PIC 9(4) ↩ binary"');
});

// ── Audit: errors belong to the file that produced them ──────────────────────
// v1.1.2.396. The virtual list builds its spacer once and never wipes siblings,
// so a scan error stayed visible under the records of the NEXT file opened.

console.log('\naudit — scan errors do not outlive their file');

// Behavioural, not textual: an earlier version of this test only asserted the
// clearing code was PRESENT, and still passed when the statement was neutered.
test('_auditBeginLoad removes stale error rows, before the scan starts', () => {
  auditTrace.length = 0;
  const removed = [];
  const selectors = [];
  const rows = [1, 2, 3].map(n => ({
    remove: () => { removed.push(n); auditTrace.push('remove-' + n); },
  }));
  const own = {
    querySelectorAll: sel => { selectors.push(sel); return /audit-error-msg/.test(sel) ? rows : []; },
  };
  // Only querySelectorAll is real; everything else behaves like the catch-all stub.
  elStubs.auditRecordList = new Proxy(own, { get: (t, k) => (k in t ? t[k] : domEl[k]) });
  try {
    auditBeginLoad({ name: 'next.log', size: 4096 });
    eq(removed.length, 3, 'every stale error row from the previous file is removed');
    const started = auditTrace.indexOf('worker-created');
    const cleared = auditTrace.indexOf('remove-1');
    assert.ok(cleared !== -1, 'clearing must actually execute, not merely be present');
    assert.ok(started === -1 || cleared < started,
      'clearing must precede the worker, so it covers a clean scan and an error alike');
    assert.ok(selectors.some(s => /audit-error-msg/.test(s) && !s.includes(':scope')),
      'the selector must not be :scope-limited — nested error rows must clear too');
  } finally {
    delete elStubs.auditRecordList;
  }
});

// ── The three "X ↩ Y" annotations share one colour scheme ────────────────────
// v1.1.2.398–.402. Field column, Type/Description and DDL Doc each rendered this
// pair differently; two stacked opacity over an already-dimmed colour, compounding
// to roughly .46 and reading as a third, muddier blue.

console.log('\nREDEFINES / override annotations — one scheme in all three panels');

function cssRule(sel) {
  const i = html.indexOf('\n' + sel + ' ');
  const j = html.indexOf('\n' + sel + '{');
  const at = i !== -1 ? i : j;
  assert.ok(at !== -1, `CSS rule for "${sel}" not found`);
  return html.slice(at, html.indexOf('}', at) + 1);
}

test('left of the arrow and the arrow itself are the REDEFINES accent-blue', () => {
  const BLUE = 'rgba(var(--accent-rgb),.65)';
  for (const sel of ['.c-ovr-orig', '.c-ovr-arrow', '.c-ovr-as', '.c-redef-mark', '.ddl-doc-redef-note']) {
    const rule = cssRule(sel).replace(/0\.65/g, '.65').replace(/,\s+/g, ',');
    assert.ok(rule.includes(BLUE.replace(/,\s+/g, ',')), `${sel} must use ${BLUE}`);
  }
});

test('right of the arrow is the column dimmed white in all three panels', () => {
  for (const sel of ['.c-ovr-new', '.c-redef-tgt', '.ddl-doc-redef-tgt']) {
    assert.ok(cssRule(sel).includes('var(--text-dim)'), `${sel} must use var(--text-dim)`);
  }
});

test('no annotation stacks opacity on top of an already-dimmed colour', () => {
  for (const sel of ['.c-redef-mark', '.ddl-doc-redef-note', '.c-ovr-orig', '.c-ovr-arrow']) {
    assert.ok(!/opacity\s*:/.test(cssRule(sel)),
      `${sel} must not set opacity — it compounds with the rgba alpha`);
  }
});

test('the declared type matches a REDEFINES field name in weight, not just colour', () => {
  assert.ok(/font-weight:\s*700/.test(cssRule('.c-ovr-orig')),
    '.c-ovr-orig must be 700 like td.c-id, or the same rgba reads as a different blue');
  assert.ok(/font-weight:\s*700/.test(cssRule('td.c-id')), 'td.c-id is the reference weight');
});

// ── min-length / max-length: the attribute the help documented ──────────────
// The evaluators read `length`; the in-app help said `value`. Anyone following
// the help got length=0, so min-length passed everything and max-length blocked
// everything — silently, since a recognizer only returns a boolean.

console.log('\nrecognizers — min-length / max-length');

test('min-length and max-length work with `length`', () => {
  const b = Buffer.from('ABCDEFGHIJ');            // 10 bytes
  const pass = n => fmtTestSpecs([{ name: 'X', recognizers: [n] }], b)[0].passed;
  eq(pass({ type: 'min-length', length: 5 }),  true,  '10 >= 5');
  eq(pass({ type: 'min-length', length: 20 }), false, '10 >= 20 is false');
  eq(pass({ type: 'max-length', length: 20 }), true,  '10 <= 20');
  eq(pass({ type: 'max-length', length: 5 }),  false, '10 <= 5 is false');
});

test('`value` is accepted too, as the help had documented', () => {
  const b = Buffer.from('ABCDEFGHIJ');
  const pass = n => fmtTestSpecs([{ name: 'X', recognizers: [n] }], b)[0].passed;
  eq(pass({ type: 'min-length', value: 5 }),  true,  'min-length honours value');
  eq(pass({ type: 'min-length', value: 20 }), false, 'and still discriminates');
  eq(pass({ type: 'max-length', value: 5 }),  false,
     'max-length with value=5 must REJECT a 10-byte message — writing it per the ' +
     'old help silently blocked every message instead');
  eq(pass({ type: 'max-length', value: 20 }), true, 'and accept within the limit');
});

// ── Explicit positioning: the "at" attribute ─────────────────────────────────
// Every block accepts it, resolved once in the dispatcher. Default (absent) must
// stay exactly as before — the baseline corpus covers that side.

console.log('\nparse-spec positioning — "at"');

const AT_MSG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ01';        // 28 bytes, index 0 = 'A'
function atRun(blocks) {
  S.ddlTree = {}; S.inputFormat = 'hex';
  return meExecParseSpec({ name: 'X', type: 'X', ddl_bindings: [], parse_spec_binary: blocks },
                         Buffer.from(AT_MSG));
}
const atVal = (ctx, id) => ctx.fields.find(f => f.id === id);

test('absolute "at" counts from 0', () => {
  const ctx = atRun([{ 'read-fixed': { length: 3, as: 'A', at: 10 } }]);
  eq(atVal(ctx, 'A').value, 'KLM', 'byte 10 is "K" — 0-based, matching DDL Doc and the raw dump');
  eq(atVal(ctx, 'A').startByte, 10, 'reported offset is the absolute position');
});

test('"at" seeks: the next block continues after the positioned read', () => {
  const ctx = atRun([{ 'read-fixed': { length: 3, as: 'A', at: 10 } },
                     { 'read-fixed': { length: 2, as: 'B' } }]);
  eq(atVal(ctx, 'B').value, 'NO', 'continues at 13, not back at 0');
  eq(ctx.cursor, 15, 'cursor left after the second read');
});

test('"peek" restores the cursor so sequential flow is undisturbed', () => {
  const ctx = atRun([{ 'read-fixed': { length: 3, as: 'A' } },
                     { 'read-fixed': { length: 3, as: 'B', at: 20, peek: true } },
                     { 'read-fixed': { length: 2, as: 'C' } }]);
  eq(atVal(ctx, 'B').value, 'UVW', 'peeked read still happens at 20');
  eq(atVal(ctx, 'C').value, 'DE', 'and the next block carries on from 3, where A ended');
});

test('relative "at": after a field, with offset and from:start', () => {
  const after = atRun([{ 'read-fixed': { length: 3, as: 'A' } },
                       { 'read-fixed': { length: 2, as: 'B', at: { field: 'A' } } }]);
  eq(atVal(after, 'B').value, 'DE', 'defaults to just past the anchor');
  const off = atRun([{ 'read-fixed': { length: 2, as: 'A' } },
                     { 'read-fixed': { length: 2, as: 'B', at: { field: 'A', offset: 5 } } }]);
  eq(atVal(off, 'B').value, 'HI', 'offset moves on from the anchor end');
  const start = atRun([{ 'read-fixed': { length: 4, as: 'A' } },
                       { 'read-fixed': { length: 2, as: 'B', at: { field: 'A', from: 'start', offset: 1 } } }]);
  eq(atVal(start, 'B').value, 'BC', 'from:start measures from the anchor first byte');
  const back = atRun([{ 'read-fixed': { length: 4, as: 'A' } },
                      { 'read-fixed': { length: 2, as: 'B', at: { field: 'A', offset: -3 } } }]);
  eq(atVal(back, 'B').value, 'BC', 'negative offset reads backwards');
});

test('"at" works on blocks that are not reads', () => {
  const sk = atRun([{ skip: { length: 2, at: 10 } }, { 'read-fixed': { length: 3, as: 'A' } }]);
  eq(atVal(sk, 'A').value, 'MNO', 'skip honours it — proving it is dispatcher-wide, not per block');
  const te = atRun([{ 'read-to-end': { as: 'R', at: 24 } }]);
  eq(atVal(te, 'R').value, 'YZ01', 'read-to-end honours it');
});

test('a bad "at" reports why, instead of reading from a wrong offset', () => {
  const cases = [
    [{ 'read-fixed': { length: 2, as: 'A', at: 999 } },                     'past the end'],
    [{ 'read-fixed': { length: 2, as: 'A', at: -1 } },                      'whole byte position'],
    [{ 'read-fixed': { length: 2, as: 'A', at: { field: 'GHOST' } } },      'has not been read yet'],
  ];
  for (const [blk, needle] of cases) {
    const ctx = atRun([blk]);
    const err = ctx.fields.find(f => f.error);
    assert.ok(err, `expected an error for ${JSON.stringify(blk)}`);
    assert.ok(err.error.includes(needle), `error should mention "${needle}", got: ${err.error}`);
    eq(ctx.fields.filter(f => !f.error).length, 0, 'and nothing is read');
  }
});

// ── read-bitmap with an explicit width ───────────────────────────────────────
console.log('\nread-bitmap — width stated by the spec');

test('an explicit length reads a bitmap the DDL never declares', () => {
  S.ddlTree = { V: { S: { D: `DEF REC.\n  02 PAYLOAD PIC X(4).\nEND REC.\n` } } };
  S.inputFormat = 'hex';
  const ctx = meExecParseSpec({ name: 'X', type: 'X', ddl_bindings: ['V/S/D/REC'],
    parse_spec_binary: [{ 'read-bitmap': { field: 'WIRE-MAP', length: 4 } }] },
    Uint8Array.from([0x40, 0x00, 0x00, 0x00, 0x41, 0x42]));
  const bm = ctx.fields[0];
  eq(bm.error, undefined, 'no "not found in the bound DDL" — the width waives that check');
  deepEq(Array.from(bm.bitSet).sort((a, b) => a - b), [2], 'bit 2 set');
  eq(ctx.cursor, 4, 'consumed exactly the stated width');
});

test('an explicit width turns off the ISO-only bit rules', () => {
  S.ddlTree = {}; S.inputFormat = 'hex';
  const mk = attrs => meExecParseSpec({ name: 'X', type: 'X', ddl_bindings: [],
    parse_spec_binary: [{ 'read-bitmap': attrs }] },
    Uint8Array.from([0xC0, 0x00, 0x00, 0x00, 0x11, 0x22, 0x33, 0x44,
                     0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC]));
  const sized = mk({ field: 'M', length: 4 });
  deepEq(Array.from(sized.bitSet ?? sized.fields[0].bitSet).sort((a, b) => a - b), [1, 2],
    'bit 1 is real data on a non-ISO map, not the secondary-bitmap flag');
  eq(sized.cursor, 4, 'and bit 0 does not silently double the read');
});

// ── read-tlv: ASCII TLV — the shape production ISO 8583 actually carries ────
// "0002" "0005" "HELLO": a fixed-width tag and a fixed-width DECIMAL length,
// both written as characters, then that many characters of value. Neither
// existing mode fits — "binary" reads big-endian lengths, and "ascii-hex"
// hex-decodes the whole buffer, which turns HELLO into garbage.

console.log('\nread-tlv — ASCII TLV (text tag, decimal length, text value)');

const ATLV_DDL = `DEFINITION MSG.
  02 DE-48 PIC X(25).
  02 CARD-TYPE.
    04 TAG  PIC X(4).
    04 LEN  PIC X(4).
    04 DATA PIC X(5).
END
`;
// "0002" "0005" "HELLO" "0003" "0004" "VISA"  = 28 chars
const ATLV_BUF = '0002' + '0005' + 'HELLO' + '0003' + '0004' + 'VISA';
function atlvRun(tlvAttrs) {
  S.ddlTree = { V: { S: { D: ATLV_DDL } } };
  S.inputFormat = 'hex';
  const b = [];
  for (const c of ATLV_BUF) b.push(c.charCodeAt(0));
  return meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    parse_spec_binary: [{ read: 'DE-48' }, { 'read-tlv': tlvAttrs }] }, b);
}
const atlvField = (ctx, id) => ctx.fields.find(f => f.id === id && !f.error);

test('an ASCII TLV buffer frames on characters and a decimal length', () => {
  const ctx = atlvRun({ field: 'DE-48', encoding: 'ascii', tag_length: 4, length_length: 4 });
  eq(atlvField(ctx, 'DE-48.0002').value, 'HELLO', 'the value is text, read as-is');
  eq(atlvField(ctx, 'DE-48.0003').value, 'VISA',  'and the second triple follows it');
});

test('the tag is known by its characters, not by a hex rendering of them', () => {
  // "0002" as hex would be "30303032" — a key no one would ever write in a spec.
  const ctx = atlvRun({ field: 'DE-48', encoding: 'ascii', tag_length: 4, length_length: 4 });
  assert.ok(atlvField(ctx, 'DE-48.0002'), 'the row is named for the tag the message carries');
  assert.ok(!ctx.fields.some(f => /30303032/.test(f.id)), 'not for its bytes');
});

test('the length is decimal characters, not a big-endian integer', () => {
  // "0005" as big-endian bytes is 0x30303035 — astronomically wrong. The old
  // modes had no way to say "these four characters are the number five".
  const ctx = atlvRun({ field: 'DE-48', encoding: 'ascii', tag_length: 4, length_length: 4 });
  eq(atlvField(ctx, 'DE-48.0002').valueLength, 5, 'five characters, because "0005" says five');
});

test('ASCII TLV rows report where they sit in the message', () => {
  // Nothing is decoded in this mode, so offsets map 1:1 and there is no excuse
  // for a blank Bytes column.
  const ctx = atlvRun({ field: 'DE-48', encoding: 'ascii', tag_length: 4, length_length: 4 });
  const f = atlvField(ctx, 'DE-48.0002');
  eq(f.startByte, 8,  'HELLO starts after the 4-char tag and 4-char length');
  eq(f.endByte,  12,  'and runs five characters');
});

test('a non-numeric length is reported, not silently read as zero', () => {
  const ctx = atlvRun({ field: 'DE-48', encoding: 'ascii', tag_length: 4, length_length: 2 });
  const err = ctx.fields.find(f => f.error && /not a decimal number/.test(f.error));
  assert.ok(err, `expected a clear error, got: ${JSON.stringify(ctx.fields.filter(f => f.error))}`);
});

test('tags maps an ASCII tag into its DDL element', () => {
  // The half of the block that would have silently done nothing if the tag key
  // were still built as hex: no error, just anonymous rows and no mapping.
  const ctx = atlvRun({ field: 'DE-48', encoding: 'ascii', tag_length: 4, length_length: 4,
                        tags: { '0002': { field: 'CARD-TYPE' } }, unknown: 'emit' });
  eq(atlvField(ctx, 'CARD-TYPE.DATA').value, 'HELLO', 'the value lands in the named element');
  eq(atlvField(ctx, 'CARD-TYPE.TAG').value,  '0002',  'and the DDL declares a TAG leaf, so it is kept');
  eq(atlvField(ctx, 'CARD-TYPE.LEN').value,  '0005',  'as is the length');
  assert.ok(atlvField(ctx, 'DE-48.0003'), 'the unmapped tag is still emitted');
});

// ── read-tlv: fixed-width rows carry byte positions, like BER ───────────────

test('fixed-width TLV rows report byte positions, exactly as the BER path does', () => {
  // The values always parsed; only WHERE they came from was missing, so the
  // Bytes column was blank and a tag could not be found in the raw dump.
  const ddl = 'DEFINITION MSG.\n  02 BUF PIC X(12).\nEND\n';
  S.ddlTree = { V: { S: { D: ddl } } };
  S.inputFormat = 'hex';
  const b = [0x9F,0x26,0x04,0x11,0x22,0x33,0x44,0x9F,0x36,0x02,0x00,0x01];
  const run = attrs => meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    parse_spec_binary: [{ read: 'BUF' }, { 'read-tlv': attrs }] }, b);
  const fixed = run({ field: 'BUF', tag_length: 2, length_length: 1, encoding: 'binary' });
  const ber   = run({ field: 'BUF', ber: true });
  const pos = (ctx, id) => { const f = ctx.fields.find(x => x.id === id); return [f.startByte, f.endByte]; };
  deepEq(pos(fixed, 'BUF.9F26'), [3, 6], 'fixed-width now knows where the value is');
  deepEq(pos(fixed, 'BUF.9F26'), pos(ber, 'BUF.9F26'), 'and agrees with BER on the same bytes');
});

// ── read-tlv: BER framing and tag → DDL element mapping ─────────────────────
console.log('\nread-tlv — BER framing and tag mapping');

const EMV_DDL = `DEF REC.
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
// 9F26 (2-byte tag) len 08, 9F36 (2-byte tag) len 02, then 82 — a ONE-byte tag.
const EMV_BYTES = Uint8Array.from([
  0x40, 0, 0, 0, 0, 0, 0, 0,
  0x9F, 0x26, 0x08, 1, 2, 3, 4, 5, 6, 7, 8,
  0x9F, 0x36, 0x02, 0x12, 0x34,
  0x82, 0x02, 0x58, 0x00,
]);
function emvRun(tlvAttrs) {
  S.ddlTree = { V: { S: { D: EMV_DDL } } };
  S.inputFormat = 'hex';
  return meExecParseSpec({ name: 'X', type: 'X', ddl_bindings: ['V/S/D/REC'],
    parse_spec_binary: [
      { 'read-bitmap': { field: 'BITMAP', length: 8 } },
      { 'read-bitmap-fields': { bitmap: 'BITMAP', de: {
          '2': { field: 'EMV-ELEMENT', blocks: [{ 'read-tlv': tlvAttrs }] } } } },
    ] }, EMV_BYTES);
}

test('BER framing handles a 1-byte tag after 2-byte tags', () => {
  const ctx = emvRun({ ber: true, tags: { '9F26': { field: 'ARQC' } }, unknown: 'emit' });
  const ids = ctx.fields.map(f => f.id);
  assert.ok(ids.includes('EMV-ELEMENT.ARQC.DATA'), 'the mapped 2-byte tag is filed');
  assert.ok(ids.some(i => /\.82$/.test(i)),
    'the 1-byte 82 tag is framed correctly — a fixed tag_length of 2 would swallow it and ' +
    'mis-frame every triple after it');
  eq(ctx.fields.some(f => f.error), false, 'and nothing errors');
});

test('a tag fills its element LEN and DATA leaves', () => {
  const ctx = emvRun({ ber: true, tags: { '9F26': { field: 'ARQC' } }, unknown: 'skip' });
  const len  = ctx.fields.find(f => f.id === 'EMV-ELEMENT.ARQC.LEN');
  const data = ctx.fields.find(f => f.id === 'EMV-ELEMENT.ARQC.DATA');
  assert.ok(len && data, 'both leaves emitted');
  eq(data.rawHex, '0102030405060708', 'value bytes land in DATA');
  eq(data.startByte, 11, 'offsets stay absolute in the message');
});

test('the DDL decides whether the tag is stored — no store_tag attribute', () => {
  const ctx = emvRun({ ber: true,
    tags: { '9F26': { field: 'ARQC' }, '9F36': { field: 'ATC' } }, unknown: 'skip' });
  const ids = ctx.fields.map(f => f.id);
  assert.ok(!ids.includes('EMV-ELEMENT.ARQC.TAG'),
    'ARQC declares no TAG leaf, so the tag is not stored — the element already identifies it');
  const atcTag = ctx.fields.find(f => f.id === 'EMV-ELEMENT.ATC.TAG');
  assert.ok(atcTag, 'ATC declares a TAG leaf, so it is stored');
  eq(atcTag.rawHex, '9F36', 'and it holds the actual tag');
});

test('names inside a "de" entry resolve within that element', () => {
  // "ARQC" alone is not a DDL id — only EMV-ELEMENT.ARQC.* exist as leaves, and
  // the group itself is never compiled, so this only works if the resolver
  // recognises a group by the prefix on its children.
  const ctx = emvRun({ ber: true, tags: { '9F26': { field: 'ARQC' } }, unknown: 'skip' });
  assert.ok(ctx.fields.some(f => f.id === 'EMV-ELEMENT.ARQC.DATA'),
    'the short name resolved against the DE element');
});

test('a "de" entry cannot read past its element into the next DE', () => {
  // The window is 4 bytes; the block asks for 12. The engine must stop at the
  // boundary and say so, rather than let DE-56 be consumed by DE-55's blocks.
  S.ddlTree = { V: { S: { D: EMV_DDL } } };
  S.inputFormat = 'hex';
  const ctx = meExecParseSpec({ name: 'X', type: 'X', ddl_bindings: ['V/S/D/REC'],
    parse_spec_binary: [
      { 'read-bitmap': { field: 'BITMAP', length: 8 } },
      { 'read-bitmap-fields': { bitmap: 'BITMAP', de: {
          '2': { field: 'EMV-ELEMENT', length: 4,
                 blocks: [{ 'read-fixed': { length: 12, as: 'GREEDY' } }] } } } },
    ] }, EMV_BYTES);
  assert.ok(ctx.fields.some(f => f.error && /past the element's length/.test(f.error)),
    `overrun must be reported, got: ${JSON.stringify(ctx.fields.filter(f => f.error))}`);
  eq(ctx.cursor, 12, 'and the cursor resumes at the element boundary (8 + 4), so the next DE lines up');
});

test('unknown tags follow the stated policy', () => {
  const emit = emvRun({ ber: true, tags: {}, unknown: 'emit' });
  assert.ok(emit.fields.some(f => /\.9F26$/.test(f.id)), 'emit keeps unmapped tags as their own rows');
  const skip = emvRun({ ber: true, tags: {}, unknown: 'skip' });
  eq(skip.fields.filter(f => /9F26/.test(f.id)).length, 0, 'skip drops them');
  const err = emvRun({ ber: true, tags: {}, unknown: 'error' });
  assert.ok(err.fields.some(f => f.error && f.error.includes('not mapped')), 'error flags them');
});

test('BER long-form lengths (81/82) are decoded, not read as short-form', () => {
  // A length byte >= 0x80 does not hold the length — its low bits say how many
  // FOLLOWING bytes do. 0x81 0x0A means 10; misreading it as short-form yields
  // 129 and frames every later triple wrong. DE-55 above 127 bytes needs this.
  const ddl = `DEF REC.\n  02 BUF PIC X(32).\n  02 ITEM.\n    04 LEN PIC X(2).\n    04 DATA PIC X(16).\nEND REC.\n`;
  S.ddlTree = { V: { S: { D: ddl } } };
  S.inputFormat = 'hex';
  const body = [0x9F, 0x26, 0x81, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const ctx = meExecParseSpec({ name: 'X', type: 'X', ddl_bindings: ['V/S/D/REC'],
    parse_spec_binary: [
      { 'read-fixed': { length: body.length, as: 'BUF' } },
      { 'read-tlv': { field: 'BUF', ber: true, tags: { '9F26': { field: 'ITEM' } } } },
    ] }, Uint8Array.from(body));
  const data = ctx.fields.find(f => f.id === 'ITEM.DATA');
  assert.ok(data, 'the triple was filed into its element');
  eq(data.rawHex, '0102030405060708090A', 'exactly the 10 bytes the long form declared');
  eq(ctx.fields.some(f => f.error), false, 'and the buffer framed cleanly to its end');
});

test('a tag mapped to a missing element is reported, not silently dropped', () => {
  const ctx = emvRun({ ber: true, tags: { '9F26': { field: 'NOT-THERE' } }, unknown: 'skip' });
  const e = ctx.fields.find(f => f.error);
  assert.ok(e && e.error.includes('not found in the DDL'), `expected a clear error, got: ${e && e.error}`);
});

// ── Variable-length groups: the LEN is read in the MESSAGE's encoding ───────
// It used to be read as characters and parseInt'd, with "|| 0" swallowing the
// failure — so on a binary message the length came out 0, the group collapsed to
// nothing, and every field after it shifted, silently.

console.log('\nvariable-length groups — length encoding follows the message');

const VLG_DDL = `DEF MSG.
  02 BITMAP PIC X(8).
  02 EMV.
    04 LEN  PIC X(2).
    04 DATA PIC X(20).
  02 TAIL PIC X(4).
END MSG.
`;
function vlgRun(lenBytes, extraPad = 0) {
  S.ddlTree = { V: { S: { D: VLG_DDL } } };
  S.inputFormat = 'hex';
  const bytes = [0x40, 0, 0, 0, 0, 0, 0, 0,       // bitmap, bit 2 set
                 ...lenBytes,                      // the LEN field
                 0x41, 0x42, 0x43, 0x44, 0x45,     // 5 payload bytes "ABCDE"
                 ...new Array(extraPad).fill(0x2E), // room, when a case needs it
                 0x54, 0x41, 0x49, 0x4C];          // "TAIL"
  return meExecParseSpec({ name: 'X', type: 'X', ddl_bindings: ['V/S/D/MSG'],
    de_map: [{ field: 'EMV', de: 2 }],             // DE numbering comes from Overrides
    parse_spec_binary: [
      { 'read-bitmap': { field: 'BITMAP', length: 8 } },
      { 'read-bitmap-fields': 'BITMAP' },
    ] }, Uint8Array.from(bytes));
}

test('a BINARY length is read as an integer, not as characters', () => {
  // 0x00 0x05 — as characters this is "\\x00\\x05", parseInt gives NaN, and the
  // old "|| 0" turned that into a zero-length group.
  const ctx = vlgRun([0x00, 0x05]);
  const data = ctx.fields.find(f => f.id === 'EMV.DATA');
  assert.ok(data, 'the payload field is emitted');
  eq(data.value, 'ABCDE', 'five bytes, exactly what the binary length said');
  eq(data.valueLength, 5, 'not zero — the group did not collapse');
});

test('an ASCII digit length still works, unchanged', () => {
  const ctx = vlgRun([0x30, 0x35]);                // "05"
  eq(ctx.fields.find(f => f.id === 'EMV.DATA').value, 'ABCDE', 'digits still parse as digits');
});

test('a length past the end of the message is reported, not read off the end', () => {
  const ctx = vlgRun([0x7F, 0xFF]);                // absurd binary length
  const err = ctx.fields.find(f => f.error && /runs past the end/.test(f.error));
  assert.ok(err, `expected a clear error, got: ${JSON.stringify(ctx.fields.filter(f => f.error))}`);
  assert.ok(/binary integer/.test(err.error), 'and it says how the length was read');
});

test('a length beyond the declared payload is flagged but still framed by the wire', () => {
  // Padded so 25 fits in the message — otherwise it trips the end-of-message
  // check first and never reaches the capacity comparison.
  const ctx = vlgRun([0x00, 0x19], 30);           // 25 > DATA's declared 20
  const err = ctx.fields.find(f => f.error && /exceeds the 20 byte/.test(f.error));
  assert.ok(err, `expected a capacity warning, got: ${JSON.stringify(ctx.fields.filter(f => f.error))}`);
});

// ── Which fields ARE data elements is now a choice, not a hardcoded rule ────
// The predicate was "top-level, and not literally named FILLER". So a DDL could
// not exclude its own padding under any other name, and a DE could never sit on
// a nested field — both of which real DDLs need.

console.log('\nDE selection — exclude, include, children');

const DESEL_DDL = `DEFINITION REQMSG.
    02 SDLC-DEST PIC X(2).
    02 MSGTYPE PIC X(4).
    02 PAD-1 PIC X(4).
    02 TRACE PIC X(6).
    02 ADDITIONA.
      04 FIELD-XX.
        06 DATA PIC X(3).
      04 FIELD-YY.
        06 DATA PIC X(3).
    02 SOME PIC X(2).
END.
`;
function deselRows(overrides) {
  S.ddlTree = { V: { S: { D: DESEL_DDL } } };
  const defs = getDDLFromPath('V/S/D/REQMSG').defs;
  return meWalkDEFields(defs, { ddl_bindings: ['V/S/D/REQMSG'], overrides: overrides || {} });
}
const deAt = (rows, id) => (rows.find(r => r.id === id) || {}).de;

test('the default rule is unchanged when nothing is overridden', () => {
  const r = deselRows();
  eq(deAt(r, 'SDLC-DEST'), 1, 'top-level fields number from 1');
  eq(deAt(r, 'PAD-1'),     3, 'padding under any name still counts by default');
  eq(deAt(r, 'ADDITIONA'), 5, 'a top-level group owns one DE');
  eq(deAt(r, 'ADDITIONA.FIELD-XX'), null, 'and its children own none');
});

test('de:false excludes a field AND does not advance the counter', () => {
  // The counter not advancing is the point: an excluded field must not leave a
  // hole, or every DE after it is one too high.
  const r = deselRows({ 'PAD-1': { de: false } });
  eq(deAt(r, 'PAD-1'),  null, 'the padding is not a data element');
  eq(deAt(r, 'TRACE'),  3,    'and the next field takes the number it vacated');
  eq(deAt(r, 'SOME'),   5,    'the tail closes up all the way down');
});

test('de:"children" hands the DE to the group\'s immediate children', () => {
  const r = deselRows({ 'ADDITIONA': { de: 'children' } });
  eq(deAt(r, 'ADDITIONA'),           null, 'the group itself is not a DE');
  eq(deAt(r, 'ADDITIONA.FIELD-XX'),  5,    'its first child is');
  eq(deAt(r, 'ADDITIONA.FIELD-YY'),  6,    'and its second');
  eq(deAt(r, 'ADDITIONA.FIELD-XX.DATA'), null, 'but not the grandchildren');
  eq(deAt(r, 'SOME'), 7, 'numbering continues past the group');
});

test('de:true forces a field in that the default rule excludes', () => {
  const r = deselRows({ 'ADDITIONA.FIELD-YY': { de: true } });
  eq(deAt(r, 'ADDITIONA.FIELD-YY'), 6, 'a nested field can be a data element');
  eq(deAt(r, 'ADDITIONA'), 5, 'without disturbing the group that contains it');
});

test('an anchor number still works', () => {
  const r = deselRows({ 'TRACE': { de: 66 } });
  eq(deAt(r, 'TRACE'), 66, 'the anchor lands');
  eq(deAt(r, 'ADDITIONA'), 67, 'and the tail follows it');
});

test('a selection form is never read as an anchor', () => {
  // +true is 1, so the old coercion turned de:true into "anchor at DE 1" and the
  // forced-in field renumbered the whole tail from 1.
  // (de:false and de:"children" make a row ineligible, so a bogus anchor on
  // them can never fire — only the de:true form can prove this, and it does.)
  const r = deselRows({ 'ADDITIONA.FIELD-YY': { de: true } });
  eq(deAt(r, 'ADDITIONA.FIELD-YY'), 6, 'it takes its place in the sequence, it does not restart it');
  eq(deAt(r, 'SOME'), 7, 'and the tail is undisturbed');
});

test('exclusion and promotion combine, in declaration order', () => {
  const r = deselRows({ 'PAD-1': { de: false }, 'ADDITIONA': { de: 'children' } });
  eq(deAt(r, 'TRACE'), 3, 'the exclusion closes the gap');
  eq(deAt(r, 'ADDITIONA.FIELD-XX'), 4, 'and the promoted children pick up from there');
  eq(deAt(r, 'ADDITIONA.FIELD-YY'), 5, 'in order');
  eq(deAt(r, 'SOME'), 6, 'with the tail continuing');
});

// ── The action bar has to be in the RENDERED panel, not just in the file ────
// It was added to the wrong template — a .replace() whose target string did not
// exist, so it silently did nothing. The CSS and the handlers shipped; the
// markup did not, and grepping the source for the class name "proved" it was
// there. Only rendering proves it.

console.log('\nOverrides panel — the action bar is rendered');

function ovPanelHtml() {
  S.ddlTree = { V: { S: { D: `DEFINITION REQMSG.
    02 MSGTYPE PIC X(4).
    02 PAN-LEN PIC X(2).
    02 PAN PIC X(16).
END.
` } } };
  return meHtmlOverrides({ name: 'X', ddl_bindings: ['V/S/D/REQMSG'], overrides: {},
    parse_spec_binary: [{ 'read-bitmap': { field: 'BM', encoding: 'binary', length: 8 } },
                        { 'read-bitmap-fields': 'BM' }] });
}

test('the rendered Overrides panel contains the action bar', () => {
  const html = ovPanelHtml();
  assert.ok(/id="me-fm-bar"/.test(html), 'the bar is in the rendered markup');
  assert.ok(/id="me-fm-ed"/.test(html),  'and so is its inline editor');
});

test('every action the handler implements is present as a button', () => {
  const html = ovPanelHtml();
  const inMarkup = new Set([...html.matchAll(/data-fmact="([^"]+)"/g)].map(m => m[1]));
  deepEq(['de-off','de-on','de-kids','de-anchor','vlg','bytes','type','display']
    .filter(a => !inMarkup.has(a)), [], 'actions with no button');
  // And nothing left over: a button whose action the handler dropped is a dead
  // control, which is how the whole bar shipped unreachable in the first place.
  deepEq([...inMarkup].filter(a =>
    !['de-off','de-on','de-kids','de-anchor','vlg','bytes','type','display'].includes(a)),
    [], 'buttons with no handler');
});

test('every scrolling surface in the panel reserves its scrollbar gutter', () => {
  // Without it the content jumps sideways the moment a list grows past its
  // max-height, and jumps back when it shrinks.
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  const rule = sel => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*\\}')) || [''])[0];
  const missing = ['.me-tab-body', '.me-fm-table-wrap', '.me-ovl-list', '.me-fm-pane pre']
    .filter(sel => !/scrollbar-gutter:\s*stable/.test(rule(sel)));
  deepEq(missing, [], 'scrolling containers with no reserved gutter');
});

test('no CSS rule is left with a dangling selector list', () => {
  // Removing dead editor CSS matched the LAST line of a multi-line rule — the
  // one carrying the braces — and left the earlier selector lines behind. CSS
  // then merged them into the following rule, so ".me-ovl-sub" and four other
  // classes silently inherited the panel header's border, background and
  // padding. That is how "N fields configured" turned into a boxed chip.
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  const dangling = [];
  for (const line of css.split('\n')) {
    const t = line.trim();
    // A line of selectors ending in a comma must be continued by more selectors
    // or a brace — a blank line after it means the rule body was deleted.
    if (/^[.#a-zA-Z][^{}]*,\s*$/.test(t)) dangling.push(t.slice(0, 60));
  }
  // Continuation lines are fine; what is not is one followed by a BLANK line.
  const lines = css.split('\n');
  const broken = lines.filter((l, i) =>
    /^[.#a-zA-Z][^{}]*,\s*$/.test(l.trim()) && (lines[i + 1] || '').trim() === '')
    .map(l => l.trim().slice(0, 60));
  deepEq(broken, [], 'selector lists with no rule body');
});

test('the value editors open on the field, not on a constant', () => {
  // "Why does DE number always start at 66?" — because it was a placeholder
  // copied from a worked example. A default that ignores the field is noise you
  // have to clear before you can type.
  const src = psFnSource('_meFmSelRow') + psFnSource('_meFmSelOvr');
  assert.ok(/_meFmMultiSel\.values\(\)\.next\(\)\.value/.test(src),
    'the defaults read the selected row');
  const cfg = html.slice(html.indexOf('const _ME_FM_ED'), html.indexOf('let _meFmEdAct'));
  assert.ok(!/def:\s*'66'/.test(cfg) && !/def:\s*'2'/.test(cfg),
    'no hardcoded DE number or byte count');
  for (const act of ['de-anchor', 'bytes', 'type', 'display'])
    assert.ok(new RegExp(`'${act}':[\\s\\S]{0,220}?def: \\(\\) =>`).test(cfg),
      `${act} computes its default from the selection`);
});

test('the old per-field editor is gone, and nothing references it', () => {
  // The action bar replaced it. Leaving the editor in place would mean two ways
  // to set the same override, in two places, with different controls.
  const html = ovPanelHtml();
  for (const gone of ['me-ovl-add-btn', 'me-ovl-edit-host', 'me-ovl-json', 'me-ovl-hint'])
    assert.ok(!html.includes(gone), `${gone} still rendered`);
  for (const fn of ['_meOvlSave', '_meOvlRenderEditor', '_meOvlFromControls', '_meOvlAddFromSelection'])
    assert.ok(!new RegExp('function ' + fn + '\\b').test(html), `${fn} still defined`);
});

test('the panel keeps the overrides list AND gains the two panes', () => {
  // The list is not replaced by the bar — it is the at-a-glance summary of what
  // is configured. The panes are new: what was written, and what it means.
  const html = ovPanelHtml();
  assert.ok(/id="me-ovl-list"/.test(html), 'the existing overrides list is still there');
  assert.ok(/id="me-fm-json"/.test(html),  'the written-overrides pane');
  assert.ok(/id="me-fm-notes"/.test(html), 'and the plain-words pane');
});

test('the action bar wraps rather than overflowing a narrow panel', () => {
  // It was laid out against a full-width prototype page and ran off the side of
  // the real panel, which is a fraction of that width.
  const css = html.match(/\.me-fm-bar\{[^}]*\}/)[0];
  assert.ok(/flex-wrap:\s*wrap/.test(css), 'the bar wraps');
  const seg = html.match(/\.me-fm-seg \.btn\{[^}]*\}/)[0];
  const min = +(seg.match(/min-width:(\d+)px/) || [])[1];
  assert.ok(min > 0 && min <= 70, `uniform but panel-sized, got ${min}px`);
  // And it uses the width it has: packed left, the groups huddled in the first
  // third of the bar with the rest of the panel empty beside them.
  assert.ok(/justify-content:\s*space-between/.test(css),
    'the groups spread across the bar rather than bunching to the left');
});

test('the bar sits above the table, not after it', () => {
  const html = ovPanelHtml();
  assert.ok(html.indexOf('me-fm-bar') < html.indexOf('me-fm-table-wrap'),
    'the bar precedes the field table');
});

// ── A bitmap the DDL does not declare still numbers the DEs ─────────────────
// `read-bitmap` with a `length` states the map's width in the spec precisely
// because the DDL does not declare it. But DE numbering only began on the field
// AFTER a def whose id equalled the bitmap field — an id that, by definition,
// does not exist here. So no field was ever assigned a DE, the Overrides table
// showed nothing, and the only way to get it working was to add a phantom
// `02 PRI-BIT-MAP TYPE BINARY 16.` to the DDL.

console.log('\nDE numbering when the bitmap is not in the DDL');

const NOBMP_DDL = `DEFINITION REQMSG.
    02 SDLC-DEST PIC X(2).
    02 SDLC-ORIGIN PIC X(2).
    02 MSGTYPE PIC X(4).
    02 PAN-LEN PIC X(2).
    02 PAN PIC X(16).
    02 TRACE PIC X(6).
END.
`;
function nobmpRows(spec) {
  S.ddlTree = { V: { S: { D: NOBMP_DDL } } };
  const item = { ddl_bindings: ['V/S/D/REQMSG'], parse_spec_binary: spec };
  const defs = getDDLFromPath('V/S/D/REQMSG').defs;
  return meWalkDEFields(defs, item);
}
const deOf = (rows, id) => (rows.find(r => r.id === id) || {}).de;

test('a synthetic bitmap numbers DEs from after the last field read before it', () => {
  const rows = nobmpRows([
    { read: 'MSGTYPE' },
    { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'binary', length: 16 } },
    { 'read-bitmap-fields': 'PRI-BIT-MAP' },
  ]);
  eq(deOf(rows, 'MSGTYPE'), null, 'the field the spec read before the bitmap is not a DE');
  eq(deOf(rows, 'PAN-LEN'), 1, 'numbering starts on the one after it');
  eq(deOf(rows, 'PAN'),     2, 'and continues');
  eq(deOf(rows, 'TRACE'),   3, 'to the end');
});

test('the fields before the anchor carry no DE at all', () => {
  const rows = nobmpRows([
    { read: 'MSGTYPE' },
    { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'binary', length: 16 } },
    { 'read-bitmap-fields': 'PRI-BIT-MAP' },
  ]);
  eq(deOf(rows, 'SDLC-DEST'), null, 'header fields are not data elements');
  eq(deOf(rows, 'SDLC-ORIGIN'), null, 'nor is the second');
});

test('a bitmap that IS in the DDL still anchors on itself', () => {
  // The behaviour that already worked must not move.
  const ddl = NOBMP_DDL.replace('    02 PAN-LEN', '    02 PRI-BIT-MAP TYPE BINARY 16.\n    02 PAN-LEN');
  S.ddlTree = { V: { S: { D: ddl } } };
  const defs = getDDLFromPath('V/S/D/REQMSG').defs;
  const rows = meWalkDEFields(defs, { ddl_bindings: ['V/S/D/REQMSG'], parse_spec_binary: [
    { read: 'MSGTYPE' },
    { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'binary' } },
    { 'read-bitmap-fields': 'PRI-BIT-MAP' },
  ] });
  eq(deOf(rows, 'MSGTYPE'), null, 'still not a DE');
  eq(deOf(rows, 'PRI-BIT-MAP'), null, 'the bitmap itself is not a DE');
  eq(deOf(rows, 'PAN-LEN'), 1, 'numbering starts after the bitmap, as before');
});

test('a spec that states the map width is not warned about a missing DDL field', () => {
  // The Field Map banner said "DE numbering can't start" — which is now simply
  // untrue, and it told the user to fix a spec that was correct. A declared
  // width means the field is synthetic ON PURPOSE.
  const bmp = { field: 'PRI-BIT-MAP', encoding: 'binary' };
  eq(meItemBitmapIsSynthetic({ parse_spec_binary: [{ 'read-bitmap': { ...bmp, length: 16 } }] }, 'PRI-BIT-MAP'),
     true, 'a wire map with an explicit length');
  eq(meItemBitmapIsSynthetic({ parse_spec_binary: [{ 'read-bitmap': { field: 'SEG-MAP', bits: 32, value: 'C4180000' } }] }, 'SEG-MAP'),
     true, 'a declared segment map');
  eq(meItemBitmapIsSynthetic({ parse_spec_binary: [{ 'read-bitmap': bmp }] }, 'PRI-BIT-MAP'),
     false, 'no width stated — the field really should be in the DDL');
  eq(meItemBitmapIsSynthetic({ parse_spec_binary: [{ 'read-bitmap': { ...bmp, length: 16 } }] }, 'OTHER-MAP'),
     false, 'and the width must belong to the field being asked about');
});

test('a synthetic bitmap with nothing read before it makes every field a DE', () => {
  const rows = nobmpRows([
    { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'binary', length: 16 } },
    { 'read-bitmap-fields': 'PRI-BIT-MAP' },
  ]);
  eq(deOf(rows, 'SDLC-DEST'), 1, 'there is nothing to start after, so numbering starts at the first field');
  eq(deOf(rows, 'SDLC-ORIGIN'), 2, 'and runs on');
});

// ── Parse-spec lint: an inert spec must not look clean ──────────────────────
// The engine takes keys[0] as the block type and ignores every other key, and
// reads attributes by exact name. So a comma outside the braces, or a typo in an
// attribute, parses fine, lints clean, and simply never applies — the block runs
// with the attribute unset and says nothing.

console.log('\nparse-spec lint — stray keys and unknown attributes');

const lintOf = spec => mePsLintWarns({ ddl_bindings: [] }, spec);
const lintHas = (spec, re) => lintOf(spec).some(w => re.test(w));

test('a key outside the block object is reported, not ignored', () => {
  const spec = [{ 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'binary' }, length: 16 }];
  assert.ok(lintHas(spec, /"length" is outside the block/),
    `expected a stray-key warning, got: ${JSON.stringify(lintOf(spec))}`);
});

test('several stray keys are reported together, in the plural', () => {
  const spec = [{ 'read-bitmap': { field: 'B' }, length: 16, peek: true }];
  assert.ok(lintHas(spec, /"length", "peek" are outside the block/),
    `got: ${JSON.stringify(lintOf(spec))}`);
});

test('a misspelled attribute is reported, with the name it probably meant', () => {
  const spec = [{ 'read-bitmap': { field: 'B', encoding: 'binary', lenth: 16 } }];
  assert.ok(lintHas(spec, /"lenth" is not an attribute of read-bitmap.*did you mean "length"/),
    `got: ${JSON.stringify(lintOf(spec))}`);
});

test('an attribute far from any real one is reported without a wrong guess', () => {
  const spec = [{ 'read-fixed': { length: 2, wibbleflorp: 1 } }];
  const w = lintOf(spec).find(x => /wibbleflorp/.test(x));
  assert.ok(w, 'reported');
  assert.ok(!/did you mean/.test(w), `no misleading suggestion: ${w}`);
});

test('the shared positioning attributes are accepted on every block', () => {
  // at / peek are not in any block's own attribute list — they are appended to
  // every block. A naive check would flag them on all fifteen.
  for (const blk of Object.keys(psHelp)) {
    const spec = [{ [blk]: { at: 4, peek: true } }];
    deepEq(lintOf(spec).filter(w => /is not an attribute/.test(w)), [],
      `${blk} rejected at/peek`);
  }
});

test('every spec the app ships lints clean of attribute complaints', () => {
  // The corpus that proves the rule does not fire on real specs — including the
  // legacy names the help does not document.
  const bad = [];
  for (const spec of fmtDefaultSpecs()) {
    for (const key of ['parse_spec_binary', 'parse_spec_ascii']) {
      if (!Array.isArray(spec[key])) continue;
      for (const w of mePsLintWarns({ ddl_bindings: spec.ddl_bindings || [] }, spec[key]))
        if (/is not an attribute|outside the block/.test(w)) bad.push(`${spec.name}/${key}: ${w}`);
    }
  }
  deepEq(bad, [], 'shipped specs tripping the new lint rules');
});

// ── Inline overrides: a spec can carry its own ──────────────────────────────
// The Overrides panel stores them on the item, which is invisible in the spec
// and does not travel with it. A block may now carry the same map inline, so a
// spec is self-contained and a diff shows what changed. Inline wins — the same
// precedence a `read` block's inline `type` already had.

console.log('\ninline overrides on a parse-spec block');

const INL_DDL = `DEFINITION MSG.
  02 MSGTYPE PIC X(4).
  02 TRACE   PIC X(6).
END
`;
function inlRun(spec, item = {}) {
  S.ddlTree = { V: { S: { D: INL_DDL } } };
  S.inputFormat = 'hex';
  const b = [];
  for (const c of '1200' + '000123') b.push(c.charCodeAt(0));
  return meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'], ...item,
    parse_spec_binary: spec }, b);
}
const inlF = (ctx, id) => ctx.fields.find(f => f.id === id && !f.error);

test('a read-ddl block can carry its own overrides', () => {
  const ctx = inlRun([{ 'read-ddl': { overrides: { MSGTYPE: { type: 'hex-char' } } } }]);
  eq(inlF(ctx, 'MSGTYPE').value, '31323030', 'the inline type override was applied');
  eq(inlF(ctx, 'MSGTYPE').typeOverride, 'hex-char', 'and recorded as an override');
  eq(inlF(ctx, 'TRACE').value, '000123', 'a field it does not mention is untouched');
});

test('inline overrides beat the stored ones', () => {
  const ctx = inlRun([{ 'read-ddl': { overrides: { MSGTYPE: { type: 'hex-char' } } } }],
                     { overrides: { MSGTYPE: { type: 'binary' } } });
  eq(inlF(ctx, 'MSGTYPE').typeOverride, 'hex-char', 'the spec wins over the panel');
});

test('the merge is per key, so an inline override does not discard the rest', () => {
  // Inline says how to read it; the panel says how to display it. Both apply —
  // whole-entry replacement would silently drop the display override.
  const ctx = inlRun([{ 'read-ddl': { overrides: { MSGTYPE: { bytes: 2 } } } }],
                     { overrides: { MSGTYPE: { display: 'hex' } } });
  eq(inlF(ctx, 'MSGTYPE').valueLength, 2, 'the inline bytes override re-sized the field');
  eq(inlF(ctx, 'MSGTYPE').displayOverride, 'hex', 'and the stored display override survived');
});

test('an inline bytes override re-lays out the record, like a stored one', () => {
  const ctx = inlRun([{ 'read-ddl': { overrides: { MSGTYPE: { bytes: 2 } } } }]);
  eq(inlF(ctx, 'MSGTYPE').value, '12', 'MSGTYPE takes 2 of its declared 4');
  eq(inlF(ctx, 'TRACE').startByte, 2, 'and the bytes it freed belong to the next field');
});

test('an inline display override formats the value', () => {
  // display is applied by a different helper from type/bytes, so "the map is
  // merged" does not by itself prove this path reads the inline entry.
  const ddl = `DEFINITION MSG.
  02 STAMP PIC X(6).
  02 AMT   PIC 9(8).
END
`;
  S.ddlTree = { V: { S: { D: ddl } } };
  S.inputFormat = 'hex';
  const b = [];
  for (const c of '143005' + '00012345') b.push(c.charCodeAt(0));
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    parse_spec_binary: [{ 'read-ddl': { overrides: {
      STAMP: { display: 'datetime' }, AMT: { display: 'amount' } } } }] }, b);
  const f = id => ctx.fields.find(x => x.id === id);
  eq(f('STAMP').displayValue, '14:30:05', 'datetime formatting applied from the spec');
  eq(f('STAMP').value, '143005', 'and the underlying value is untouched');
  eq(f('AMT').displayValue, '123.45', 'amount too');
  eq(f('AMT').displayOverride, 'amount', 'and the override is recorded for the hover hint');
});

// ── bitmap-list: the map read out as numbers ────────────────────────────────
// A 16-byte map rendered as "0010 0110 …" is faithful and useless — nobody
// counts columns to discover DE 11 is present. And a read-bitmap row was the one
// field that accepted no override at all, which is the row where this is worth
// the most.

const BMPL_DDL = `DEFINITION REQMSG.
    02 SDLC-DEST PIC X(2).
    02 SDLC-ORIGIN PIC X(2).
    02 MSGTYPE PIC X(4).
    02 PAN-LEN PIC X(2).
    02 PAN PIC X(16).
    02 TRACE PIC X(6).
END.
`;
// The reported record, verbatim.
const BMPL_BYTES = (`43 54 00 13 00 00 00 00 60 00 01 51 B8 02 00 30
  20 05 80 20 82 1A 54 01 10 00 00 00 01 00 00 00
  33 34 35 36 37 38 39 31 31 32 33 34 35 36 37 38`).replace(/\s+/g, '').match(/../g).map(h => parseInt(h, 16));
function bmplRun(inline) {
  S.ddlTree = { V: { S: { D: BMPL_DDL } } };
  S.inputFormat = 'hex';
  const bmp = { field: 'PRI-BIT-MAP', encoding: 'binary', length: 16 };
  if (inline) bmp.overrides = { 'PRI-BIT-MAP': { display: 'bitmap-list' } };
  const item = { name: 'X', ddl_bindings: ['V/S/D/REQMSG'], parse_spec_binary: [
    { skip: { length: 9 } }, { read: 'SDLC-DEST' }, { read: 'SDLC-ORIGIN' },
    { read: 'MSGTYPE' }, { 'read-bitmap': bmp } ] };
  if (!inline) item.overrides = { 'PRI-BIT-MAP': { display: 'bitmap-list' } };
  return meExecParseSpec(item, BMPL_BYTES).fields.find(f => f.id === 'PRI-BIT-MAP');
}
const BMPL_EXPECT = 'Bits — 6, 8, 9, 19, 25, 31, 36, 37, 39, 42, 44, 46, 56, 60, 96, 123, 124, 127, 128';

test('a display override reaches a read-bitmap row at all', () => {
  // read-bitmap never applied type or display overrides — it built the row and
  // pushed it. So this was not "bitmap-list is missing", it was "no override of
  // any kind works here".
  const f = bmplRun(false);
  eq(f.displayOverride, 'bitmap-list', 'the override was applied to the bitmap row');
});

test('bitmap-list reads the map out as the bit numbers that are set', () => {
  eq(bmplRun(false).displayValue, BMPL_EXPECT, 'from the Overrides panel');
});

test('the same override works carried inline on the read-bitmap block', () => {
  // Inline overrides were wired into read-ddl and read-bitmap-fields only, so
  // the one block this display exists for silently ignored them. They are now
  // resolved in the dispatcher, for every block.
  eq(bmplRun(true).displayValue, BMPL_EXPECT, 'from the spec itself');
});

test('bitmap-list leaves the raw value alone', () => {
  const f = bmplRun(false);
  eq(f.rawHex, '058020821A5401100000000100000033', 'the bytes are untouched');
  assert.ok(!/^Bits —/.test(f.value), 'and so is the parsed value — this is a DISPLAY');
});

test('bitmap-list uses the engine bitset, not a re-reading of the hex', () => {
  // The case where the two disagree: on an ISO WIRE map, bit 1 means "a
  // secondary bitmap follows" and is not a data element, so the engine drops it.
  // Re-deriving from the raw hex would list it and claim a DE that will never be
  // read. (On an explicitly sized map bit 1 IS data and is kept — which is
  // exactly why this rule is not worth re-implementing in a formatter.)
  const ddl = 'DEFINITION MSG.\n  02 BITMAP PIC X(8).\n  02 DE-2 PIC X(2).\nEND\n';
  S.ddlTree = { V: { S: { D: ddl } } };
  S.inputFormat = 'hex';
  const bytes = [0xC0, 0, 0, 0, 0, 0, 0, 0,     // primary: bits 1 and 2 set
                 0, 0, 0, 0, 0, 0, 0, 0,        // secondary: empty
                 0x41, 0x42];
  const f = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    overrides: { BITMAP: { display: 'bitmap-list' } },
    parse_spec_binary: [{ 'read-bitmap': { field: 'BITMAP', encoding: 'binary' } }] }, bytes)
    .fields.find(x => x.id === 'BITMAP');
  assert.ok(/^C0/.test(f.rawHex), 'the raw bytes do carry bit 1');
  eq(f.displayValue, 'Bits — 2', 'but bit 1 is the secondary indicator, not a DE, so it is not listed');
});

test('an empty map says so rather than printing nothing', () => {
  eq(meContentLooksWrong({ dataType: '', rawBytes: [] }), false, 'sanity');
  S.ddlTree = { V: { S: { D: BMPL_DDL } } };
  S.inputFormat = 'hex';
  const zeros = new Array(25).fill(0x30);
  const f = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/REQMSG'],
    overrides: { 'PRI-BIT-MAP': { display: 'bitmap-list' } },
    parse_spec_binary: [{ 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'binary', length: 2,
      overrides: {} } }] }, [0x00, 0x00, ...zeros]).fields.find(x => x.id === 'PRI-BIT-MAP');
  eq(f.displayValue, 'no bits set', 'an all-zero map is stated, not blank');
});

test('inline overrides are scoped to their block', () => {
  const ctx = inlRun([
    { 'read-ddl': { fields: ['MSGTYPE'], overrides: { MSGTYPE: { type: 'hex-char' } } } },
    { 'read-ddl': { fields: ['MSGTYPE'] } },
  ]);
  const rows = ctx.fields.filter(f => f.id === 'MSGTYPE');
  eq(rows[0].typeOverride, 'hex-char', 'the block that declares them gets them');
  eq(rows[1].typeOverride, undefined,  'the next block does not inherit them');
});

test('read-bitmap-fields takes inline overrides too, including DE anchors', () => {
  const ddl = `DEFINITION MSG.
  02 BITMAP PIC X(8).
  02 DE-A PIC X(4).
  02 DE-B PIC X(6).
END
`;
  S.ddlTree = { V: { S: { D: ddl } } };
  S.inputFormat = 'hex';
  const b = [0x60, 0, 0, 0, 0, 0, 0, 0];      // bits 2 and 3
  for (const c of 'ABCD' + '123456') b.push(c.charCodeAt(0));
  // Without an anchor DE-A is 1 and DE-B is 2, so bit 2 would find DE-B and bit 3
  // nothing at all. The inline anchor renumbers DE-A to 2, shifting DE-B to 3.
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    parse_spec_binary: [
      { 'read-bitmap': { field: 'BITMAP', encoding: 'binary' } },
      { 'read-bitmap-fields': { bitmap: 'BITMAP',
          overrides: { 'DE-A': { de: 2, type: 'hex-char' } } } },
    ] }, b);
  eq(inlF(ctx, 'DE-A').value, '41424344', 'the inline type override applied inside the bitmap walk');
  eq(inlF(ctx, 'DE-A').typeOverride, 'hex-char', 'and is recorded');
  assert.ok(inlF(ctx, 'DE-B'), 'the inline DE anchor renumbered the tail, so bit 4 resolved');
});

// ── VLG on any field, not only on a group ───────────────────────────────────
// The old rule needed the length and its payload wrapped in a group, and a group
// could carry exactly one. A flat "PAN-LEN then PAN" could not be expressed at
// all, and neither could two lengths at the same level.

console.log('\nVLG on a plain field');

const LEAFVLG_DDL = `DEFINITION REQMSG.
    02 MSGTYPE PIC X(4).
    02 PAN-LEN PIC X(2).
    02 PAN PIC X(16).
    02 AMT-LEN PIC X(2).
    02 AMT PIC X(12).
    02 TRACE PIC X(6).
END.
`;
// "1200" · "06" · "411111" (6 of PAN's declared 16) · "04" · "9999" (4 of 12) · "TRACE1"
function leafVlgRun(overrides) {
  S.ddlTree = { V: { S: { D: LEAFVLG_DDL } } };
  S.inputFormat = 'hex';
  const b = [];
  for (const c of '1200' + '06' + '411111' + '04' + '9999' + 'TRACE1') b.push(c.charCodeAt(0));
  return meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/REQMSG'], overrides: overrides || {},
    parse_spec_binary: [{ 'read-ddl': 'ANY' }] }, b);
}
const lv = (ctx, id) => ctx.fields.find(f => f.id === id && !f.error);

test('a VLG field sizes the field that follows it', () => {
  const ctx = leafVlgRun({ 'PAN-LEN': { vlg: true } });
  eq(lv(ctx, 'PAN-LEN').value, '06',     'the length field reads normally');
  eq(lv(ctx, 'PAN').value,     '411111', 'and PAN takes 6 of its declared 16');
});

test('the bytes it frees belong to whatever comes next', () => {
  const ctx = leafVlgRun({ 'PAN-LEN': { vlg: true } });
  eq(lv(ctx, 'PAN').startByte, 6,  'PAN starts after the length');
  eq(lv(ctx, 'AMT-LEN').startByte, 12, 'and the next field follows the WIRE, not the DDL');
});

test('many VLG fields at one level, each sizing only its own successor', () => {
  // A group could carry one length. This is the case that could not be
  // expressed before: two independent length/payload pairs, side by side.
  const ctx = leafVlgRun({ 'PAN-LEN': { vlg: true }, 'AMT-LEN': { vlg: true } });
  eq(lv(ctx, 'PAN').value, '411111', 'the first pair');
  eq(lv(ctx, 'AMT').value, '9999',   'the second pair');
  eq(lv(ctx, 'TRACE').value, 'TRACE1', 'and the record still lines up at the end');
});

test('without the marker nothing changes', () => {
  const ctx = leafVlgRun({});
  eq(lv(ctx, 'PAN').valueLength, 16, 'PAN reads its declared width');
  assert.ok(!lv(ctx, 'TRACE'), 'and the record runs off the end, as it did before');
});

test('a length of zero collapses the next field without consuming bytes', () => {
  S.ddlTree = { V: { S: { D: LEAFVLG_DDL } } };
  S.inputFormat = 'hex';
  const b = [];
  for (const c of '1200' + '00' + '04' + '9999' + 'TRACE1') b.push(c.charCodeAt(0));
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/REQMSG'],
    overrides: { 'PAN-LEN': { vlg: true }, 'AMT-LEN': { vlg: true } },
    parse_spec_binary: [{ 'read-ddl': 'ANY' }] }, b);
  eq(lv(ctx, 'PAN').valueLength, 0, 'PAN is present but empty');
  eq(lv(ctx, 'AMT').value, '9999', 'and the field after it is unaffected');
});

test('a group VLG still means what it always meant', () => {
  // The group form is not migrated or reinterpreted — it is the same rule with
  // the pair wrapped, so both must keep working side by side.
  const ddl = `DEFINITION MSG.
  02 MSGTYPE PIC X(4).
  02 EMV.
    04 LEN PIC 9(2).
    04 DATA PIC X(20).
  02 TAIL PIC X(4).
END
`;
  S.ddlTree = { V: { S: { D: ddl } } };
  S.inputFormat = 'hex';
  const b = [];
  for (const c of '1200' + '05' + 'ABCDE' + 'TAIL') b.push(c.charCodeAt(0));
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }] }, b);
  eq(lv(ctx, 'EMV.DATA').value, 'ABCDE', 'the group form still frames its payload');
  eq(lv(ctx, 'TAIL').value, 'TAIL', 'and the tail follows');
});

// ── vlg_identifier: which leaf means "length", per DDL ──────────────────────
// The auto-detect used to hardcode LEN/LGTH/LENGTH and a 2–4 byte width. Both
// are wrong for someone else's DDL: a group whose first field is legitimately
// called AMT-LEN but is NOT variable-length was read as though it were, and a
// 1-byte binary length was never recognised at all.

console.log('\nvlg_identifier — the length leaf is named by the spec');

const VLGID_DDL = `DEFINITION MSG.
  02 TYP PIC X(4).
  02 EMV.
    04 LEN PIC 9(2).
    04 DATA PIC X(20).
  02 TAIL PIC X(4).
END
`;
// "1200" + "05" + "ABCDE" + "TAIL" — the group carries 5 of its declared 20.
function vlgIdBytes() {
  const b = [];
  for (const c of '1200' + '05' + 'ABCDE' + 'TAIL') b.push(c.charCodeAt(0));
  return b;
}
function vlgIdRun(attrs, ddl = VLGID_DDL, item = {}) {
  S.ddlTree = { V: { S: { D: ddl } } };
  S.inputFormat = 'hex';
  return meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'], ...item,
    parse_spec_binary: [{ 'read-ddl': attrs }] }, vlgIdBytes());
}
const vlgIdField = (ctx, id) => ctx.fields.find(f => f.id === id && !f.error);

test('read-ddl reads a variable-length group as one, and the rest of the record follows', () => {
  const ctx = vlgIdRun('ANY');
  eq(vlgIdField(ctx, 'EMV.DATA').value, 'ABCDE', 'DATA is framed by LEN, not by its declared 20');
  // The proof that ovShift did its job: TAIL is 15 bytes earlier than declared.
  eq(vlgIdField(ctx, 'TAIL').value, 'TAIL', 'the field after the group still lands on its bytes');
  eq(vlgIdField(ctx, 'TAIL').startByte, 11, 'and at the position the WIRE puts it, not the DDL');
});

test('vlg_identifier names the length leaf', () => {
  const ctx = vlgIdRun({ vlg_identifier: 'LEN' });
  eq(vlgIdField(ctx, 'EMV.DATA').value, 'ABCDE', 'named leaf matches, group is variable-length');
  eq(vlgIdField(ctx, 'TAIL').startByte, 11, 'and the tail follows');
});

test('vlg_identifier that matches nothing leaves the group fixed-length', () => {
  const ctx = vlgIdRun({ vlg_identifier: 'SIZE' });
  eq(vlgIdField(ctx, 'EMV.DATA').valueLength, 9, 'DATA takes its declared width (bounded by the message)');
  assert.ok(!vlgIdField(ctx, 'TAIL'), 'so TAIL is swallowed — this DDL simply has no SIZE leaf');
});

test('vlg_identifier "" switches auto-detect off entirely', () => {
  // The whole point: a group whose first field is called LEN but which is NOT
  // variable-length must not be read as though it were.
  const ctx = vlgIdRun({ vlg_identifier: '' });
  eq(vlgIdField(ctx, 'EMV.DATA').valueLength, 9, 'no auto-detect, so DATA reads at its declared length');
  assert.ok(!vlgIdField(ctx, 'TAIL'), 'and nothing is reframed');
});

test('an explicit Overrides flag still wins when auto-detect is off', () => {
  // "" disables the GUESS. Pointing at a group by hand is not a guess.
  const ctx = vlgIdRun({ vlg_identifier: '' }, VLGID_DDL,
    { overrides: { 'EMV': { vlg: 'EMV.LEN' } } });
  eq(vlgIdField(ctx, 'EMV.DATA').value, 'ABCDE', 'the hand-flagged group is still variable-length');
  eq(vlgIdField(ctx, 'TAIL').startByte, 11, 'and the tail follows');
});

test('the LEN width comes from the DDL, not from a hardcoded 2/3/4', () => {
  // A 5-digit length: the old rule ignored anything outside 2-4 bytes, so this
  // group was silently read at its declared width.
  const ddl = `DEFINITION MSG.
  02 TYP PIC X(4).
  02 EMV.
    04 LEN PIC 9(5).
    04 DATA PIC X(20).
  02 TAIL PIC X(4).
END
`;
  S.ddlTree = { V: { S: { D: ddl } } };
  S.inputFormat = 'hex';
  const b = [];
  for (const c of '1200' + '00005' + 'ABCDE' + 'TAIL') b.push(c.charCodeAt(0));
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }] }, b);
  eq(vlgIdField(ctx, 'EMV.DATA').value, 'ABCDE', 'a 5-byte length is a length like any other');
  eq(vlgIdField(ctx, 'TAIL').value, 'TAIL', 'and the record still lines up');
});

test('a grandchild LEN frames its own group, never the group above it', () => {
  // EMV.ARQC.LEN is the length of the triple INSIDE the element. ARQC being
  // variable-length is correct; EMV being framed by it is not — that would eat
  // EMV's other children, which the LEN says nothing about.
  const ddl = `DEFINITION MSG.
  02 TYP PIC X(4).
  02 EMV.
    04 ARQC.
      06 LEN PIC 9(2).
      06 DATA PIC X(4).
    04 EXTRA PIC X(3).
  02 TAIL PIC X(4).
END
`;
  S.ddlTree = { V: { S: { D: ddl } } };
  S.inputFormat = 'hex';
  const b = [];
  for (const c of '1200' + '02' + 'WX' + 'YZA' + 'TAIL') b.push(c.charCodeAt(0));
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    parse_spec_binary: [{ 'read-ddl': 'ANY' }] }, b);
  eq(vlgIdField(ctx, 'EMV.ARQC.DATA').value, 'WX', 'ARQC is framed by its own LEN');
  // If EMV had been framed by ARQC.LEN, its 2 bytes would be spent on DATA and
  // EXTRA would come out empty, dragging TAIL forward.
  eq(vlgIdField(ctx, 'EMV.EXTRA').value, 'YZA', 'EMV\'s other child keeps its declared bytes');
  eq(vlgIdField(ctx, 'TAIL').value, 'TAIL', 'and the record still lines up');
});

test('read-bitmap-fields honours vlg_identifier too', () => {
  // PAD is DE-1 so the map can leave bit 1 clear — in ISO that bit means "a
  // secondary bitmap follows", and setting it reads 8 more bytes as a map.
  const ddl = `DEFINITION MSG.
  02 BITMAP PIC X(8).
  02 PAD PIC X(1).
  02 EMV.
    04 SIZE PIC 9(2).
    04 DATA PIC X(20).
  02 TAIL PIC X(4).
END
`;
  S.ddlTree = { V: { S: { D: ddl } } };
  S.inputFormat = 'hex';
  const b = [0x60, 0, 0, 0, 0, 0, 0, 0];                 // bits 2 and 3 → EMV, TAIL
  for (const c of '05' + 'ABCDE' + 'TAIL') b.push(c.charCodeAt(0));
  const spec = vid => meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    parse_spec_binary: [
      { 'read-bitmap': { field: 'BITMAP', encoding: 'binary' } },
      { 'read-bitmap-fields': vid === undefined ? 'BITMAP' : { bitmap: 'BITMAP', vlg_identifier: vid } },
    ] }, b);
  eq(vlgIdField(spec('SIZE'), 'EMV.DATA').value, 'ABCDE', 'SIZE is this DDL\'s name for a length');
  eq(vlgIdField(spec(undefined), 'EMV.DATA').valueLength, 9,
     'without it the built-in names do not match SIZE, so the group is fixed');
});

test('the VLG marker appears exactly once — on the group when collapsed, on the LEN when open', () => {
  // It used to print the LEN's field NAME on the group row and "LEN" on the leaf:
  // the same fact twice, and production field names are long enough to blow the
  // column out.
  const ctx = { ea: s => String(s), vlgMap: new Map(), foByField: new Map(),
    usesBitmapFields: true, vlgIdentifier: undefined,
    leavesByGroup: new Map([['EMV', [{ id: 'EMV.LEN', length: 2 }, { id: 'EMV.DATA', length: 20 }]]]) };
  const grp  = { id: 'EMV', isGroup: true, childCount: 2, length: 22, offset: 0 };
  const len  = { id: 'EMV.LEN',  length: 2,  offset: 0 };
  const data = { id: 'EMV.DATA', length: 20, offset: 2 };
  const cell = row => ((meFmRowHtml(row, ctx, { n: 0 })
    .match(/<td class="me-fm-vlg"[^>]*>(.*?)<\/td>/) || [, ''])[1]).replace(/<[^>]+>/g, '').trim();

  const saved = meState();
  try {
    setMeState({ fmCollapsedGroups: new Set(['EMV']) });
    eq(cell(grp), 'VLG', 'collapsed: the group carries it, because the leaf is off screen');
    setMeState({ fmCollapsedGroups: new Set() });
    eq(cell(grp),  '',    'expanded: the group row stays clean');
    eq(cell(len),  'VLG', 'expanded: the LEN leaf carries it');
    eq(cell(data), '',    'and no other leaf does');
  } finally { setMeState(saved); }
});

test('the Field Map reads vlg_identifier off the spec, and "" survives the trip', () => {
  // The VLG column has to show what the PARSE will do. `undefined` (use the
  // built-in names) and `""` (guess off) mean opposite things, so a `|| null`
  // anywhere on this path would silently re-enable the guess in the panel.
  eq(meItemVlgIdentifier({ parse_spec_binary: [{ 'read-ddl': 'ANY' }] }), undefined,
     'no attribute → built-in names');
  eq(meItemVlgIdentifier({ parse_spec_binary: [{ 'read-ddl': { vlg_identifier: '' } }] }), '',
     'empty string survives as an empty string, not as "unset"');
  eq(meItemVlgIdentifier({ parse_spec_binary: [{ 'read-bitmap-fields': { bitmap: 'B', vlg_identifier: 'SIZE' } }] }),
     'SIZE', 'read-bitmap-fields carries it too');
  eq(meItemVlgIdentifier({ parse_spec_binary: [
       { when: { field: 'F', is: '1', then: [{ 'read-ddl': { vlg_identifier: 'SZ' } }] } }] }),
     'SZ', 'found inside a nested block');
  eq(meItemVlgIdentifier({ parse_spec_ascii: [{ 'read-ddl': { vlg_identifier: 'SZ' } }] }), 'SZ',
     'the ASCII spec counts as well');
});

// ── read: a group reads at its declared position, like a field ──────────────
// Only LEAVES are compiled, so a group has no record of its own to carry its
// offset — it exists as a prefix on its children's names. That made "read a
// group" fall back to the cursor while "read a field" jumped to its declared
// position, for no stated reason. Both now use the DDL's positions.

console.log('\nread — groups read where the DDL says');

const GRP_DDL = `DEF REC.
  02 PLAIN-LEAF PIC X(2).
  02 OCC-LEAF PIC X(2) OCCURS 2 TIMES.
  02 PLAIN-GRP.
    04 A PIC X(2).
    04 B PIC X(2).
  02 OCC-GRP OCCURS 2 TIMES.
    04 C PIC X(2).
END REC.
`;
//                     0 1 2 3 4 5 6 7 8 9 …
const GRP_MSG = 'AABBCCDDEEFFGGHH';
function grpRun(id, times = 1) {
  S.ddlTree = { V: { S: { D: GRP_DDL } } };
  S.inputFormat = 'hex';
  const blocks = [{ 'read-fixed': { length: 4, as: 'PRE' } }];   // move the cursor off 0
  for (let i = 0; i < times; i++) blocks.push({ read: id });
  return meExecParseSpec({ name: 'X', type: 'X', ddl_bindings: ['V/S/D/REC'],
    parse_spec_binary: blocks }, Buffer.from(GRP_MSG));
}

test('a group reads at the CURSOR, not at its declared DDL position', () => {
  // The DDL supplies structure — how many sub-fields and how wide. The cursor
  // supplies position. PLAIN-GRP.A is declared at 6, but the cursor is at 4 when
  // the read happens, so it reads at 4. `at` is how you jump to a position.
  const ctx = grpRun('PLAIN-GRP');
  const a = ctx.fields.find(f => f.id === 'PLAIN-GRP.A');
  const b = ctx.fields.find(f => f.id === 'PLAIN-GRP.B');
  eq(a.startByte, 4, 'A read where the cursor was');
  eq(b.startByte, 6, 'B follows it');
  eq(a.value, 'CC', 'and therefore the bytes under the cursor');
});

test('a field and a group behave the same way — both follow the cursor', () => {
  const leaf  = grpRun('PLAIN-LEAF');
  const group = grpRun('PLAIN-GRP');
  eq(leaf.fields.find(f => f.id === 'PLAIN-LEAF').startByte, 4, 'field at the cursor');
  eq(group.fields.find(f => f.id === 'PLAIN-GRP.A').startByte, 4, 'group likewise');
});

test('skip moves the cursor and the following reads honour it', () => {
  // The reported bug: `{"skip": {"length": 9}}` then three reads returned bytes
  // 0-1, 2-3, 4-7 — every read jumped to its declared DDL offset and the skip
  // did nothing, which made the block inert wherever it mattered.
  S.ddlTree = { V: { S: { D: `DEF REQMSG.
  02 SDLC-DEST   PIC X(2).
  02 SDLC-ORIGIN PIC X(2).
  02 MSGTYPE     PIC X(4).
END REQMSG.
` } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([
    0x43,0x54,0x00,0x13,0x00,0x00,0x00,0x00, 0x60,        // 9 bytes to step over
    0x00,0x01, 0x51,0xB8, 0x02,0x00,0x30,0x20]);
  const ctx = meExecParseSpec({ name:'X', type:'X', ddl_bindings:['V/S/D/REQMSG'],
    parse_spec_binary: [
      { skip: { length: 9 } },
      { read: 'SDLC-DEST' }, { read: 'SDLC-ORIGIN' }, { read: 'MSGTYPE' },
    ] }, bytes);
  const at = id => ctx.fields.find(f => f.id === id);
  eq(at('SDLC-DEST').startByte,   9,  'first read starts where skip left the cursor');
  eq(at('SDLC-DEST').rawHex,      '0001', 'not the DDL-declared bytes 43 54 ("CT")');
  eq(at('SDLC-ORIGIN').startByte, 11, 'and the rest follow sequentially');
  eq(at('MSGTYPE').startByte,     13, '');
  eq(at('MSGTYPE').rawHex,        '02003020', '');
});

test('reading a plain group twice advances — it does not error or repeat', () => {
  // Reads follow the cursor, so a second read takes the NEXT bytes. What must
  // not happen is the old "All 1 occurrences already read" error, which reported
  // the occurrence machinery rather than anything the user did wrong.
  const ctx = grpRun('PLAIN-GRP', 2);
  const hits = ctx.fields.filter(f => f.id === 'PLAIN-GRP.A');
  eq(hits.length, 2, 'both reads produced the field');
  eq(hits[0].startByte, 4, 'first read at the cursor');
  eq(hits[1].startByte, 8, 'second read continues after the first');
  eq(ctx.fields.some(f => f.error), false, 'and neither errors');
});

test('a repeated group still advances one occurrence per read', () => {
  const ctx = grpRun('OCC-GRP', 2);
  const ids = ctx.fields.map(f => f.id);
  assert.ok(ids.includes('OCC-GRP[01].C') && ids.includes('OCC-GRP[02].C'),
    `each read takes the next occurrence, got: ${JSON.stringify(ids)}`);
});

test('reading a repeated group past its last occurrence still errors', () => {
  const ctx = grpRun('OCC-GRP', 3);
  assert.ok(ctx.fields.some(f => f.error && /All 2 occurrences/.test(f.error)),
    'running out of occurrences is still reported');
});

// ── read + length_prefix: a length on the wire, absent from the DDL ─────────
// Once a group's tags are mapped to elements, its LEN leaf holds nothing worth
// keeping, so the DDL may legitimately omit it. The bytes are still on the wire.

console.log('\nread — length_prefix');

const LP_DDL = `DEF REC.
  02 XXX-ELEMENT.
    04 DATA PIC X(6).
  02 TAIL PIC X(4).
END REC.
`;
function lpRun(msg, attrs) {
  S.ddlTree = { V: { S: { D: LP_DDL } } };
  S.inputFormat = 'hex';
  return meExecParseSpec({ name: 'X', type: 'X', ddl_bindings: ['V/S/D/REC'],
    parse_spec_binary: [{ read: attrs }] }, Buffer.from(msg));
}

test('the wire length frames the payload, and the prefix bytes are shown', () => {
  const ctx = lpRun('0006ABCDEFTAIL', { field: 'XXX-ELEMENT', length_prefix: 4 });
  const pre = ctx.fields.find(f => f.id === 'XXX-ELEMENT.LEN-PREFIX');
  assert.ok(pre, 'the prefix is emitted as its own row — consuming bytes without ' +
                 'a row is how 4 bytes of every STM record went missing under RTE-GRP');
  eq(pre.value, '0006', 'and it shows the raw length bytes');
  eq(ctx.fields.find(f => f.id === 'XXX-ELEMENT.DATA').value, 'ABCDEF', 'payload framed by the wire');
  eq(ctx.cursor, 10, 'cursor past prefix + payload');
});

test('a binary length prefix works, using the same rule as VLG', () => {
  const ctx = lpRun('\x00\x03ABCDEFTAIL', { field: 'XXX-ELEMENT', length_prefix: 2 });
  eq(ctx.fields.find(f => f.id === 'XXX-ELEMENT.DATA').value, 'ABC',
     'binary 0x0003 decoded as 3, not as characters');
});

test('a shorter wire length truncates the payload rather than reading declared size', () => {
  const ctx = lpRun('0003ABCDEFTAIL', { field: 'XXX-ELEMENT', length_prefix: 4 });
  const d = ctx.fields.find(f => f.id === 'XXX-ELEMENT.DATA');
  eq(d.value, 'ABC', 'three bytes, not the declared six');
  eq(d.valueLength, 3, 'and the length reflects what was actually taken');
});

test('a length past the end of the message is reported', () => {
  const ctx = lpRun('9999ABCDEFTAIL', { field: 'XXX-ELEMENT', length_prefix: 4 });
  assert.ok(ctx.fields.some(f => f.error && /runs past the end/.test(f.error)),
    'clear error rather than reading off the end');
});

test('bytes the sub-fields do not claim are reported, not silently skipped', () => {
  // wire says 9, DATA declares 6 — the leftover 3 must not vanish
  const ctx = lpRun('0009ABCDEFGHIJKL', { field: 'XXX-ELEMENT', length_prefix: 4 });
  assert.ok(ctx.fields.some(f => f.error && /not claimed by any sub-field/.test(f.error)),
    'the unclaimed remainder is surfaced');
});

test('a bad length_prefix value is rejected', () => {
  for (const bad of [0, -2, 1.5, 'two']) {
    const ctx = lpRun('0006ABCDEFTAIL', { field: 'XXX-ELEMENT', length_prefix: bad });
    assert.ok(ctx.fields.some(f => f.error && /whole number of bytes/.test(f.error)),
      `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test('without length_prefix, read is completely unchanged', () => {
  const ctx = lpRun('ABCDEFTAIL', 'XXX-ELEMENT');
  eq(ctx.fields.find(f => f.id === 'XXX-ELEMENT.DATA').value, 'ABCDEF', 'declared sizes');
  eq(ctx.fields.some(f => /LEN-PREFIX/.test(f.id)), false, 'no prefix row invented');
  eq(ctx.cursor, 6, 'cursor advanced by the declared size only');
});

// ── DDL validation: a DEFINITION must declare level-numbered items ──────────
// HPE DDL Reference Manual: each field or group in a group DEFINITION needs at
// least a level number and a name. Without them the DEF compiles to zero fields,
// which used to save clean and then show as "DDL not found" on the binding.

console.log('\nDDL validation — DEFINITION without level numbers');

test('a DEFINITION whose items have no level numbers is an error', () => {
  const bad = `DEFINITION REQMSG.
\tSDLC-DEST PIC X(2).
    SDLC-ORIGIN PIC X(2).
END.`;
  const { errors } = validateDDLErrors(bad, new Map());
  eq(errors.length, 1, 'exactly one error');
  assert.ok(/REQMSG/.test(errors[0]) && /level number/.test(errors[0]),
    `error should name the DEF and the cause, got: ${errors[0]}`);
});

test('the same fields with level numbers are clean', () => {
  const good = `DEFINITION REQMSG.
  02 SDLC-DEST PIC X(2).
  02 SDLC-ORIGIN PIC X(2).
END.`;
  eq(validateDDLErrors(good, new Map()).errors.length, 0, 'no error');
});

test('a group carrying a PICTURE is a blocking error', () => {
  // The real defect this catches: DDLFSTM had RTE-GRP PIC X(11) with two 06
  // items under it. The parser charged 11 bytes for the group AND 4 more for the
  // children, then emitted neither child — 4 bytes of every STM record belonged
  // to no field at all. Manual: "a group description cannot have either clause".
  const bad = `DEF REC.
  02 RTE-GRP PIC X(11).
    04 FROM-ACCT-TYP PIC X(2).
    04 TO-ACCT-TYP PIC X(2).
  02 TAIL PIC X(2).
END.`;
  const r = validateDDLErrors(bad, new Map());
  assert.ok(r.errors.some(e => /cannot have a PICTURE clause/.test(e)),
    `expected a blocking error, got: ${JSON.stringify(r.errors)}`);

  // The fix — wrap the children in their own group — must be clean.
  const fixed = `DEF REC.
  02 RTE-GRP PIC X(11).
  02 SAVE-ACCT.
    04 FROM-ACCT-TYP PIC X(2).
    04 TO-ACCT-TYP PIC X(2).
  02 TAIL PIC X(2).
END.`;
  eq(validateDDLErrors(fixed, new Map()).errors.length, 0,
     'a real group around the children resolves it');
});

test('a single-line elementary DEFINITION is not flagged', () => {
  // It carries its own PICTURE on the header and has no body to number.
  eq(validateDDLErrors(`DEFINITION AMT PIC 9(8).\nEND.`, new Map()).errors.length, 0,
     'header with its own PIC is complete');
});

// ── Parse-spec help ↔ engine — the panel is the manual, so it must not lie ───
// Two failure modes, both of which had happened before these tests existed:
// an attribute documented with no example anywhere (27 of 33 at one point), and
// an attribute documented that the block never reads (read-fixed's type and
// encoding were inert for months). Neither is visible by reading the help.

console.log('\nParse-spec help ↔ engine');

// Which function actually implements each block. Where a block delegates by
// mode, every function it can reach is listed — the claim under test is "this
// attribute is read SOMEWHERE in the code path this block dispatches to".
const PS_EXEC_FNS = {
  'read-ddl':            ['_meExecReadDDL'],
  'read':                ['_meExecReadField'],
  'read-fixed':          ['_meExecReadFixed'],
  'read-until':          ['_meExecReadUntil'],
  'read-length-prefix':  ['_meExecReadLengthPrefix'],
  'read-to-end':         ['_meExecReadToEnd'],
  'read-bitmap':         ['_meExecReadBitmap', '_meExecSegMap', '_meExecReadSegMapFromFile'],
  'read-bitmap-fields':  ['_meExecBitmapFields'],
  'read-segment-fields': ['_meExecSegmentFields'],
  'read-tlv':            ['_meExecReadTLV', '_meExecReadTLVMapped'],
  'skip':                ['_meExecBlockAt'],
  'when':                ['_meExecWhen'],
  'repeat':              ['_meExecRepeat'],
  'read-while':          ['_meExecReadWhile'],
  'token-area':          ['_meExecTokenArea'],
};

function psFnSource(name) {
  const i = APP_SRC.indexOf(`\nfunction ${name}(`);
  assert.ok(i >= 0, `function ${name} not found in source.html`);
  const j = APP_SRC.indexOf('\nfunction ', i + 1);
  return APP_SRC.slice(i, j < 0 ? APP_SRC.length : j);
}

// The exec function plus one level of the helpers it calls: several blocks read
// their attributes through a normalizer (_meReadDDLAttrs and friends), so the
// literal attribute name never appears in the exec function itself.
function psBlockSource(blk) {
  const seen = new Set(PS_EXEC_FNS[blk]);
  let src = '';
  for (const fn of PS_EXEC_FNS[blk]) {
    const s = psFnSource(fn);
    src += '\n' + s;
    for (const m of s.matchAll(/\b(_me[A-Za-z0-9]+)\s*\(/g))
      if (!seen.has(m[1]) && APP_SRC.includes(`\nfunction ${m[1]}(`)) {
        seen.add(m[1]);
        src += '\n' + psFnSource(m[1]);
      }
  }
  return src;
}

// An attribute counts as read when it is taken off an attrs-like object: a
// property access, a quoted key, or a destructuring binding. A bare word match
// would not do — "type" and "encoding" both appear all over read-fixed's
// neighbourhood, and they were inert for months while doing so.
const psReadsAttr = (src, name) => new RegExp(
  `\\b(attrs|a)\\??\\.\\s*${name}\\b` +   // attrs.name / attrs?.name / a.name (the normalized alias)
  `|['"]${name}['"]` +                    // attrs['name'], or a key in a returned object
  `|[{,]\\s*${name}\\s*[,}]`              // const { name, … } = …
).test(src);

test('every block in the help table has a known implementation', () => {
  deepEq(Object.keys(psHelp).filter(b => !PS_EXEC_FNS[b]), [], 'documented blocks with no exec mapping');
  deepEq(Object.keys(PS_EXEC_FNS).filter(b => !psHelp[b]), [], 'implemented blocks with no help entry');
});

test('every documented attribute has at least one example', () => {
  const commonNames = psCommonAttrs.map(a => a[0]);
  const gaps = [];
  for (const [blk, info] of Object.entries(psHelp))
    for (const [name] of info.attrs)
      // Same fallback the panel uses: a block's own examples first, then the
      // shared positioning examples for the attributes every block accepts.
      if (!info.examples.some(ex => mePsHelpExAttrs(ex).has(name)) &&
          !(commonNames.includes(name) && psCommonExamples.some(ex => mePsHelpExAttrs(ex).has(name))))
        gaps.push(`${blk}.${name}`);
  deepEq(gaps, [], 'documented attributes with no example');
});

test('the shared positioning attributes have shared examples', () => {
  deepEq(psCommonAttrs.map(a => a[0]).filter(n =>
    !psCommonExamples.some(ex => mePsHelpExAttrs(ex).has(n))), [], 'common attrs with no example');
});

test('every documented attribute is actually read by its block', () => {
  const inert = [];
  for (const [blk, info] of Object.entries(psHelp)) {
    const src = psBlockSource(blk);
    for (const [name] of info.attrs) {
      // The bare-string form has no key to look for; it is a typeof check.
      if (name === '(bare string)') { assert.ok(/typeof attrs === 'string'/.test(src),
        `${blk} documents the bare-string form but never checks for it`); continue; }
      if (!psReadsAttr(src, name)) inert.push(`${blk}.${name}`);
    }
  }
  deepEq(inert, [], 'documented attributes the block never reads');
});

test('every example the help ships actually parses as a spec', () => {
  const bad = [];
  for (const [blk, info] of Object.entries(psHelp))
    for (const ex of info.examples) {
      const spec = Array.isArray(ex) ? ex[1] : ex.spec;
      if (!Array.isArray(spec) || !spec.length) { bad.push(`${blk}: not a block list`); continue; }
      // A payload means the panel EXECUTES it — it must be whole hex bytes.
      if (!Array.isArray(ex) && ex.payload && !/^([0-9A-Fa-f]{2}\s*)+$/.test(ex.payload))
        bad.push(`${blk}: payload is not hex bytes`);
    }
  deepEq(bad, [], 'malformed help examples');
});

test('no attribute description is one dense paragraph', () => {
  // The panel renders a string description as a single block of prose. Every
  // description is a list of lines (or [form, meaning] pairs) so it renders as
  // bullets or a table — the one change that made this panel readable.
  const prose = [];
  for (const [blk, info] of Object.entries(psHelp))
    for (const [name, , , desc] of info.attrs)
      if (!Array.isArray(desc)) prose.push(`${blk}.${name}`);
  for (const [name, , , desc] of psCommonAttrs)
    if (!Array.isArray(desc)) prose.push(`(common).${name}`);
  deepEq(prose, [], 'attribute descriptions still written as one paragraph');
});

test('no block description is a wall of prose', () => {
  // Same rule as the attributes: past a couple of sentences a description has to
  // be a lead line plus bullets, or nobody gets to the end of it.
  const walls = Object.entries(psHelp)
    .filter(([, info]) => typeof info.desc === 'string' && info.desc.length > 300)
    .map(([blk, info]) => `${blk} (${info.desc.length} chars)`);
  deepEq(walls, [], 'block descriptions still written as one long paragraph');
});

test('every block has at least one example that is actually run', () => {
  // A payload-carrying example is executed by the panel, so its Result table is
  // the engine's own output. A block with only prose examples is documentation
  // that nothing checks.
  deepEq(Object.entries(psHelp)
    .filter(([, info]) => !info.examples.some(ex => !Array.isArray(ex) && ex.payload))
    .map(([blk]) => blk), [], 'blocks with no executable example');
});

test('an example that sets a display override renders the FORMATTED value', () => {
  // A display override leaves `value` alone and adds `displayValue`. The result
  // table rendered only `value`, so every display example showed exactly what it
  // would have shown with no override at all — demonstrating nothing.
  const ex = psHelp['read-ddl'].examples.find(e =>
    !Array.isArray(e) && e.payload && /"display"/.test(JSON.stringify(e.spec)));
  assert.ok(ex, 'read-ddl still ships a display example');
  const html = mePsHelpExampleHtml(ex);
  assert.ok(/14:30:05/.test(html), `the formatted value is shown: ${html.slice(-400)}`);
  assert.ok(/143005/.test(html) && /as datetime/.test(html),
    'alongside the raw value and the override that produced it');
});

test('the synthetic-bitmap override case is demonstrated, not just described', () => {
  // The case that motivated the whole feature: a map the DDL never declares,
  // carrying an override. It had five examples of overrides on DDL fields and
  // none on a synthetic one.
  const ex = psHelp['read-bitmap'].examples.find(e =>
    !Array.isArray(e) && /"length"/.test(JSON.stringify(e.spec)) && /"overrides"/.test(JSON.stringify(e.spec)));
  assert.ok(ex, 'read-bitmap ships a synthetic-map override example');
  assert.ok(/bitmap-list/.test(mePsHelpExampleHtml(ex)), 'and it runs');
});

test('every executable example produces the fields it claims to', () => {
  // The panel RUNS these against their own payloads, so a broken one is not a
  // stale sentence — it is an error table under a heading that promises a result.
  const bad = [];
  for (const [blk, info] of Object.entries(psHelp).concat([['(shared)', { examples: psCommonExamples }]]))
    for (const ex of info.examples) {
      if (Array.isArray(ex) || !ex.payload) continue;
      const ctx = mePsHelpRunExample(ex);
      const errs = (ctx.fields || []).filter(f => f.error);
      if (ex.expectError) {
        if (!errs.length) bad.push(`${blk}: "${ex.what}" was meant to show an error and did not`);
        continue;
      }
      if (errs.length) bad.push(`${blk}: "${ex.what}" → ${errs.map(e => e.error).join(' | ')}`);
      else if (!(ctx.fields || []).length) bad.push(`${blk}: "${ex.what}" produced no fields`);
      // token-area fills ctx.tokens, not ctx.fields — a silently empty token
      // area would still have passed the check above.
      else if (JSON.stringify(ex.spec).includes('token-area') && !(ctx.tokens || []).length)
        bad.push(`${blk}: "${ex.what}" selected no tokens`);
    }
  deepEq(bad, [], 'help examples that do not run');
});

// ── Saving an override refreshes the ROW LIST, not just the rendering ───────

console.log('\noverride save refreshes the field list');

test('a syntax error marks the editor frame, not just the message line', () => {
  // A one-line message under a 220px editor is easy to scroll past — the report
  // was "spec syntax error is very subtle". Both call sites that set the message
  // must also set the frame, so they go through one helper.
  const src = psFnSource('_mePsSetErr');
  assert.ok(/data-state', 'err'/.test(src) && /removeAttribute\('data-state'\)/.test(src),
    '_mePsSetErr sets and clears the error state on the editor host');
  for (const fn of ['_mePsChange', '_mePsFmt']) {
    const body = psFnSource(fn);
    assert.ok(!/errEl\.textContent/.test(body),
      `${fn} must not set the message directly — the frame would not follow`);
    assert.ok(/_mePsSetErr\(/.test(body), `${fn} routes through _mePsSetErr`);
  }
  // And the frame has a rule to respond with, one that survives focus.
  assert.ok(/\.me-ps-cm\[data-state="err"\][^{]*:focus-within\{border-color:#f85149;\}/.test(html),
    'the red border wins while the editor is focused — which is when you are typing the mistake');
});

test('renderFieldTable annotates through the applied-override helper', () => {
  // The helper being right is only half of it: the row builder has to consult it
  // rather than reading the stored map directly, which is what it used to do.
  const src = psFnSource('renderFieldTable');
  assert.ok(/_meFieldOvrAnnotation\(f,/.test(src),
    'the row annotation must come from what was applied, not only from the spec map');
  assert.ok(!/_fo\s*&&\s*_fo\.type/.test(src),
    'no direct read of the stored map for the annotation');
});

test('the Field Map banner is guarded by the synthetic-bitmap check', () => {
  // The helper being right is only half of it — the banner has to consult it.
  // Source tripwire because the banner is rendered HTML inside a large builder.
  const src = psFnSource('_meOverridesPrep');
  assert.ok(/no bound DDL field has that id/.test(src), 'the banner still lives here');
  assert.ok(/_meItemBitmapIsSynthetic\(item, _bmpField\)/.test(src),
    'the banner must not fire when the spec states the map width itself');
});

test('the override apply path rebuilds the field list', () => {
  // A de / vlg / bytes override changes the rows themselves — DE numbers,
  // offsets, lengths — so re-rendering the window from the cached list showed
  // stale values until the panel was closed and reopened. A source tripwire
  // because the fix is a call, and the render path needs a live DOM.
  // (_meOvlSave was the old per-field editor's save; the action bar replaced it
  // with _meFmAfterAct, which every action funnels through.)
  const src = psFnSource('_meFmAfterAct');
  assert.ok(/_meFmPatchDECells\(\)/.test(src),
    'the apply path must recompute the field list, not only re-render the window');
  assert.ok(/_meFmNotesRefresh\(\)/.test(src),
    'and refresh the panes, or they narrate the previous state');
  // REMOVING an override changes the rows just as much as adding one — deleting
  // an anchor has to put the natural numbering back. The ✕ had kept the old
  // re-render-from-cache call and left the table showing the overridden values.
  const del = psFnSource('_meOvlDelete');
  assert.ok(/_meFmAfterAct\(\)/.test(del), 'the ✕ goes through the same funnel');
  assert.ok(!/_meFmRenderWindow/.test(del), 'and not through a cached re-render');
});

test('a de override does change what the field list reports', () => {
  // The other half: the list rebuild is only worth calling because the walker
  // genuinely produces different numbers once the override is stored.
  S.ddlTree = { V: { S: { D: NOBMP_DDL } } };
  const defs = getDDLFromPath('V/S/D/REQMSG').defs;
  const spec = [{ read: 'MSGTYPE' },
                { 'read-bitmap': { field: 'PRI-BIT-MAP', encoding: 'binary', length: 16 } },
                { 'read-bitmap-fields': 'PRI-BIT-MAP' }];
  const before = meWalkDEFields(defs, { ddl_bindings: ['V/S/D/REQMSG'], parse_spec_binary: spec });
  const after  = meWalkDEFields(defs, { ddl_bindings: ['V/S/D/REQMSG'], parse_spec_binary: spec,
                                        overrides: { PAN: { de: 5 } } });
  eq(deOf(before, 'PAN'), 2, 'PAN is DE 2 by default');
  eq(deOf(after,  'PAN'), 5, 'the anchor moves it');
  eq(deOf(after,  'TRACE'), 6, 'and the tail follows it');
});

// ── SPEC ↔ code — the design spec must describe the code that exists ────────
// Every stale section found so far was found by eye: DDLMM after it was
// decommissioned, recognizer types renamed underneath the table, hex overrides
// added without documenting them, a UI section describing tabs that are now
// collapsible sections. Anything mechanically checkable is checked here so the
// next drift fails the suite instead of waiting to be noticed.

console.log('\nSPEC ↔ code');

const SPEC = fs.readFileSync('./SPEC-message-format-detector.md', 'utf8');
const specSec = (from, to) => SPEC.slice(SPEC.indexOf(from), to ? SPEC.indexOf(to) : undefined);
/** Evaluate one literal out of source.html in its own context — sharing one
 *  throws on the second `const` of the same name. */
function fromSource(re, expr) {
  const m = html.match(re);
  if (!m) return null;
  const ctx = {}; vm.createContext(ctx);
  try { vm.runInContext(m[0] + ';out=' + expr, ctx); return ctx.out; } catch (e) { return null; }
}

test('every parse_spec block type is documented', () => {
  const blocks = fromSource(/const _PS_KNOWN_BLOCKS = new Set\(\[[\s\S]*?\]\);/, '[..._PS_KNOWN_BLOCKS]');
  assert.ok(blocks && blocks.length, 'could not read _PS_KNOWN_BLOCKS');
  deepEq(blocks.filter(b => !SPEC.includes('`' + b + '`')), [], 'blocks missing from the spec');
});

test('recognizer types and the spec table agree, both directions', () => {
  const types = fromSource(/const _REC_HELP = \{[\s\S]*?\n\};/, 'Object.keys(_REC_HELP)');
  assert.ok(types && types.length, 'could not read _REC_HELP');
  const sec = specSec('### 4.4', '### 4.5');
  const alias = html.match(/const _ALIAS = \{([^}]*)\}/)[1];
  const aliasNames = [...alias.matchAll(/'?([a-z0-9-]+)'?\s*:/g)].map(m => m[1]);
  deepEq(types.filter(t => !sec.includes('`' + t + '`')), [], 'types in code but not in §4.4');
  const listed = [...new Set([...sec.matchAll(/^\| `([a-z0-9-]+)`/gm)].map(m => m[1]))];
  deepEq(listed.filter(t => !types.includes(t) && !aliasNames.includes(t)), [],
         'types in §4.4 that no longer exist (aliases excluded)');
});

test('every recognizer EVALUATOR has help and a spec row', () => {
  // _REC_HELP is what the UI shows; _R is what actually runs. Checking only the
  // former missed renaming an evaluator out from under its documentation.
  const evals = [...new Set([...html.matchAll(/_R\[(?:'|")([a-z0-9-]+)(?:'|")\]\s*=/g)].map(m => m[1]))];
  assert.ok(evals.length > 10, `expected the recognizer registry, found ${evals.length}`);
  const help = fromSource(/const _REC_HELP = \{[\s\S]*?\n\};/, 'Object.keys(_REC_HELP)') || [];
  // Aliases share an evaluator with their target and are documented in the alias
  // table rather than getting a help entry of their own.
  const aliasSrc = html.match(/const _ALIAS = \{([^}]*)\}/)[1];
  const aliases = [...aliasSrc.matchAll(/'?([a-z0-9-]+)'?\s*:/g)].map(m => m[1]);
  const own = evals.filter(t => !aliases.includes(t));
  deepEq(own.filter(t => !help.includes(t)), [], 'evaluators with no help entry');
  deepEq(evals.filter(t => !SPEC.includes('`' + t + '`')), [], 'evaluators absent from the spec');
  deepEq(help.filter(t => !evals.includes(t) && !/^(source|destination|filename)$/.test(t)), [],
         'help entries with no evaluator (routing recognizers excepted — they run elsewhere)');
});

test('every recognizer alias is in the alias table', () => {
  const alias = html.match(/const _ALIAS = \{([^}]*)\}/)[1];
  const pairs = [...alias.matchAll(/'?([a-z0-9-]+)'?\s*:\s*'([a-z0-9-]+)'/g)];
  const sec = specSec('**Aliases', '#### ISO 8583 semantic');
  deepEq(pairs.filter(([, , to]) => !sec.includes('`' + to + '`')).map(m => m[1]), [],
         'aliases missing their target');
  deepEq(pairs.filter(m => !sec.includes('`' + m[1] + '`')).map(m => m[1]), [], 'aliases missing');
});

test('field_overrides type and display options are documented (§9)', () => {
  const types = fromSource(/const _ME_TYPE_OPTS = \[[^\]]*\];/, '_ME_TYPE_OPTS.filter(Boolean)');
  assert.ok(types && types.length, 'could not read _ME_TYPE_OPTS');
  const sec = specSec('## 9. Field Overrides', '## 10.');
  deepEq(types.filter(t => !sec.includes(t)), [], 'type overrides missing from §9');
  // Read from source, like the types above. This was a hardcoded list, so it
  // could never fail: a new display option was documented only if someone
  // remembered to edit the test as well, which is not a guard at all.
  const disps = fromSource(/const _ME_DISP_OPTS = \[[^\]]*\];/, '_ME_DISP_OPTS.filter(Boolean)');
  assert.ok(disps && disps.length, 'could not read _ME_DISP_OPTS');
  deepEq(disps.filter(d => !sec.includes(d)), [], 'display overrides missing from §9');
});

test('every localStorage key is documented (§13)', () => {
  const keys = [...new Set([...html.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'/g)].map(m => m[1]))];
  const sec = specSec('## 13. Storage', '### 13.1');
  deepEq(keys.filter(k => !sec.includes(k)), [], 'storage keys missing from §13');
});

test('the spec is internally consistent', () => {
  const refs  = [...new Set([...SPEC.matchAll(/§(\d+(?:\.\d+)?)/g)].map(m => m[1]))];
  const heads = new Set([...SPEC.matchAll(/^#{2,3} (\d+(?:\.\d+)?)[. ]/gm)].map(m => m[1]));
  deepEq(refs.filter(r => !heads.has(r)), [], 'cross-references to sections that do not exist');
  deepEq(SPEC.split('\n').map((l, i) => (/^\|/.test(l) && !/\|\s*$/.test(l)) ? 'line ' + (i + 1) : null).filter(Boolean),
         [], 'malformed table rows');
});

test('decommissioned DDLMM is not described as live', () => {
  const s10 = SPEC.indexOf('## 10. DDLMM — decommissioned'), e10 = SPEC.indexOf('## 11.');
  assert.ok(s10 > 0, '§10 tombstone missing');
  const offenders = SPEC.split('\n').map((l, i) => {
    if (!/DDLMM/.test(l)) return null;
    if (/^\| 20\d\d-/.test(l)) return null;                    // a changelog row is history
    if (/§10/.test(l)) return null;                            // a deliberate cross-reference
    const off = SPEC.split('\n').slice(0, i).join('\n').length;
    if (off >= s10 - 1 && off < e10) return null;              // §10 itself
    return 'line ' + (i + 1);
  }).filter(Boolean);
  deepEq(offenders, [], 'DDLMM described outside its tombstone');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  process.exit(1);
}
