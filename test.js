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
const CSS = { escape: v => String(v).replace(/[^\w-]/g, c => '\\' + c) };
const storage = {
  _data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
};

// ── Timers: queued, not dropped ──────────────────────────────────────────────
// setTimeout used to be `() => {}`. That keeps tests synchronous, and it also
// makes every callback behind a yield UNREACHABLE — which is the whole parse
// path, because each step paints the progress panel and then yields so the
// browser can show it before blocking. A plain TypeError inside the scoring
// callback passed 498 tests that way (v1.12.0.2).
//
// Callbacks are queued instead of dropped. Nothing runs until a test calls
// pumpTimers(), so every existing test behaves exactly as before; a test that
// wants the real thing drains the queue and gets the code that ships.
const _timerQ = [];
let _timerSeq = 0;
function _schedule(fn, ms) {
  if (typeof fn !== 'function') return 0;
  _timerQ.push({ id: ++_timerSeq, fn, ms: +ms || 0, seq: _timerSeq });
  return _timerSeq;
}
function _unschedule(id) {
  const i = _timerQ.findIndex(t => t.id === id);
  if (i >= 0) _timerQ.splice(i, 1);
}
// Drains in scheduled-delay order, the way a real event loop would, and keeps
// draining what those callbacks schedule — the compile loop re-arms itself once
// per DDL, so a single pass would stop after one.
function pumpTimers(maxCallbacks = 20000) {
  let ran = 0;
  while (_timerQ.length) {
    if (++ran > maxCallbacks) throw new Error(`pumpTimers: over ${maxCallbacks} callbacks — runaway timer loop`);
    let next = 0;
    for (let i = 1; i < _timerQ.length; i++)
      if (_timerQ[i].ms < _timerQ[next].ms ||
         (_timerQ[i].ms === _timerQ[next].ms && _timerQ[i].seq < _timerQ[next].seq)) next = i;
    const t = _timerQ.splice(next, 1)[0];
    t.fn();
  }
  return ran;
}
function resetTimers() { _timerQ.length = 0; }

const sandbox = vm.createContext({
  // Core JS globals
  console, CSS, setTimeout: _schedule, clearTimeout: _unschedule, setInterval: () => {},
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
_t.buildByteCharMap   = buildByteCharMap;
_t.stripJsonc         = _stripJsonc;
_t.formatJsonc        = _formatJsonc;
_t.compactJsonc       = _compactJsonc;
_t.expandJsonc        = _expandJsonc;
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
_t.meOvlChips          = _meOvlChips;
_t.meFmExpandTargets   = _meFmExpandTargets;
_t.meFmDeCellHtml      = _meFmDeCellHtml;
_t.setFmVirt           = v => { _meFmVirt = v; };
_t.meHtmlOverrides     = _meHtmlOverrides;
_t.mePsLintWarns       = _mePsLintWarns;
_t.mePsMatchBracket    = _mePsMatchBracket;
_t.meItemBitmapIsSynthetic = _meItemBitmapIsSynthetic;
_t.fmtDefaultSpecs     = window._fmtDefaultSpecs;
_t.meFmRowHtml         = _meFmRowHtml;
_t.meState             = () => _meState;
_t.setMeState          = v => { _meState = v; };
_t.fmtTestSpecs       = window._fmtTestSpecs;
// The recognizer reference: the index, one example card, and the runner that
// produces an example's verdict. Rendered here so a documented example that
// stopped being true fails the build instead of misinforming the panel.
_t.recHelp             = _REC_HELP;
_t.meRecHelpHtml       = _meRecHelpHtml;
_t.meRecHelpRun        = _meRecHelpRun;
_t.meRecHelpExampleHtml = _meRecHelpExampleHtml;
_t.meRecByteLen        = _meRecByteLen;
_t.meExecParseSpec    = _meExecParseSpec;
_t.meParseFileWithSpec = _meParseFileWithSpec;
// Parse-flow routing — which parser a recognized message is sent to.
_t.meSpecNeedsBinding       = _meSpecNeedsBinding;
_t.meSpecHasNoParseSpec     = _meSpecHasNoParseSpec;
_t.meParseWithChosenBinding = _meParseWithChosenBinding;
_t.parseVerdict             = _parseVerdict;
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
_t.meTestFieldTable   = _meTestFieldTable;
_t.meOvEffectiveLen   = _meOvEffectiveLen;
_t.meCanonSet         = _meCanonSet;
_t.netardExtractBytes = _netardExtractBytes;
_t.isParseOverride    = isParseOverride;
_t.buildInputHLRanges = _buildInputHLRanges;
_t.parseOverrideScope = parseOverrideScope;
_t.toggleParseOverride= toggleParseOverride;
_t.getDDLsForScope    = getDDLsForScope;
_t.detectNetardFmt    = _detectNetardFmt;
_t.meVlgLenMap        = _meVlgLenMap;
_t.meRowsForOverride  = _meRowsForOverride;
_t.meNextSelection    = _meNextSelection;
_t.expMsgLines        = _expMsgLines;
_t.expWrapCell        = _expWrapCell;
_t.meReadApplyTypeOverride = _meReadApplyTypeOverride;
_t.meDecodeLength     = _meDecodeLength;
_t.meLengthReadAs     = _meLengthReadAs;
_t.ME_TYPE_OPTS       = _ME_TYPE_OPTS;
_t.meLenEncFor        = _meLenEncFor;
_t.meLenEncSuspicion  = _meLenEncSuspicion;
_t.setSpecLookup      = fn => { window._fmtSpecByName = fn; };
_t.auditBeginLoad     = _auditBeginLoad;
// The orchestration itself, reachable now that setTimeout queues instead of
// dropping. Everything above this line is a piece of the parse; this is the
// parse — the function whose scoring callback shipped a TypeError past 498
// tests because nothing could execute it.
_t.doParseMessages    = doParseMessages;
_t.specKey            = _specKey;
_t.ppDetectDetails    = _ppDetectDetails;
_t.detectMsgType      = detectMsgType;
// In a browser, \`window.X = fn\` also creates the global \`X\`, and top-level code
// relies on that — detectMsgTypeTrace calls the bare identifier _fmtDetectTrace,
// which is declared inside a block and only escapes via window. The sandbox's
// window is a stub, so that binding never appeared and the call threw
// ReferenceError the moment a test drove the real parse. Bridged here, so the
// sandbox models the one browser behaviour this code depends on.
for (const k of ['_fmtDetect','_fmtDetectTrace','_fmtSpecByName','_fmtSpecByLabel',
                 '_fmtFileSpecByName','_fmtGetData','_fmtTestSpecs','_specEncoding',
                 '_migrateSpec','_migrateSpecOverrides','_detectOrderIdxs']) {
  const v = window[k];
  if (typeof v !== 'undefined' && v !== null) globalThis[k] = v;
}
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
  stripJsonc, formatJsonc, compactJsonc, expandJsonc, migrateSpec, migrateOverrides, fmtTestSpecs, psHelp, psCommonAttrs,
  psCommonExamples, mePsHelpExAttrs, mePsHelpRunExample, mePsHelpExampleHtml,
  meItemVlgIdentifier,
  meContentLooksWrong, meFieldOvrAnnotation, meHtmlOverrides, meOvlChips,
  meFmExpandTargets, meFmDeCellHtml, setFmVirt, mePsLintWarns, fmtDefaultSpecs, meItemBitmapIsSynthetic,
  meFmRowHtml, meState, setMeState,
  meExecParseSpec: _rawExecParseSpec, meParseFileWithSpec: _rawParseFileWithSpec,
  mePsKnownDDLIds, meFmCountUnresolved, meExtractCommentDEs,
  meComputeAutoOrderAnchors, getDDLFromPath, S, P,
  meWalkDEFields: _rawWalkDEFields,
  renderFieldTable, meTestFieldTable, meOvEffectiveLen, expMsgLines, expWrapCell,
  meCanonSet, meVlgLenMap, meRowsForOverride, meNextSelection,
  netardExtractBytes, detectNetardFmt, buildInputHLRanges, isParseOverride, parseOverrideScope,
  toggleParseOverride, getDDLsForScope, meReadApplyTypeOverride, setSpecLookup: _rawSetSpecLookup, auditBeginLoad,
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

// A real dump, pasted on its own. Right-aligned addresses, the ASCII column
// held in one place by variable padding, and a short final line — the shape
// every one of these tests used to be written without.
const HEXASCII_DUMP = [
  '              0: F0F8 F0F0 8220 0000 8000 0000 0400 0000  [..... ..........]',
  '             16: 0000 0000 F0F3 F2F0 F0F8 F2F0 F1F9 F0F1  [................]',
  '             32: F0F3 F7F6 F1F0 F9F0 F0F0 F0F0 F1F2 F0F5  [................]',
  '             48: F2F7 F0                                  [...]',
].join('\n');

test('a HEXASCII line is recognised however wide its padding is', () => {
  // The gap before the ASCII column is padding that keeps the bracket in one
  // place, so it is one space on a full line and thirty-four on a short one.
  // Requiring exactly one space rejected every line of every real dump, and the
  // text then fell through to plain 'ascii' — bytes and highlighting both wrong.
  for (const line of HEXASCII_DUMP.split('\n'))
    assert.ok(isHexAsciiLine(line), `not recognised: ${JSON.stringify(line.slice(0, 30))}…`);
  eq(detectFormat(HEXASCII_DUMP), 'tandem-dump', 'and the file is a dump, not ascii');
  // Still strict about the things that make it a dump.
  assert.ok(!isHexAsciiLine('   0: F0F8 F0F0  [xxx]'), 'ASCII column must match the byte count');
  assert.ok(!isHexAsciiLine('   0: F0F8 F0F0'), 'no ASCII column at all is not this format');
  assert.ok(!isHexAsciiLine('just some text here'), 'prose is not a dump line');
});

test('every byte of a pasted HEXASCII dump maps to its own characters', () => {
  const bytes = extractBytes(HEXASCII_DUMP, 'tandem-dump');
  const map   = sandbox._t.buildByteCharMap(HEXASCII_DUMP, 'tandem-dump', 0);
  eq(bytes.length, 51, 'the record is 51 bytes');
  eq(map.length, bytes.length, 'and every one of them is mapped — including the last, odd one');
  for (let i = 0; i < bytes.length; i++) {
    const txt = HEXASCII_DUMP.slice(map[i].s, map[i].e);
    eq(txt.length, 2, `byte ${i} spans two characters, not "${txt}"`);
    eq(parseInt(txt, 16), bytes[i], `byte ${i}: "${txt}" re-reads as itself`);
    // The ASCII column is mapped too, one character per byte.
    assert.ok(map[i].ascii, `byte ${i} has no ASCII column entry`);
    eq(map[i].ascii.e - map[i].ascii.s, 1, `byte ${i} maps to one ASCII character`);
  }
  // The address is never data. Byte 16 opens line 2, whose address is "16".
  const line2 = HEXASCII_DUMP.split('\n')[1];
  const at16  = HEXASCII_DUMP.slice(map[16].s, map[16].e);
  eq(at16, '00', 'byte 16 is the data at the start of line 2');
  assert.ok(map[16].s > HEXASCII_DUMP.indexOf(line2) + line2.indexOf(':'),
    'and it sits past that line\'s own colon, not the first line\'s');
});

test('each dump line is measured by its OWN address, not the first line\'s', () => {
  // The address column is right-aligned, so a measurement taken once at the top
  // of the file is wrong for every line whose address is a different width. On
  // an ordinary dump the two errors cancel — the group scan re-finds the hex at
  // a correspondingly later index — which is why this went unnoticed. It stops
  // cancelling as soon as the leftover is itself a pair of hex digits: here the
  // first line's "0:" is three characters and the second's "10000:" is seven, so
  // a file-wide measurement leaves "00" in front of the data and invents a byte
  // that is not in the record.
  const wide = [
    '        0: 4142 4344  [ABCD]',
    '    10000: 4546 4748  [EFGH]',
  ].join('\n');
  const bytes = extractBytes(wide, 'tandem-dump');
  const map   = sandbox._t.buildByteCharMap(wide, 'tandem-dump', 0);
  deepEq(bytes, [0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48], 'eight bytes, no phantom');
  eq(map.length, bytes.length, 'and no phantom entry in the map either');
  for (let i = 0; i < bytes.length; i++)
    eq(parseInt(wide.slice(map[i].s, map[i].e), 16), bytes[i],
       `byte ${i} points at the characters that produced it`);
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

// ── every recognizer, every attribute ───────────────────────────────────────
// A sweep, not a sample. Each recognizer is exercised on its own, across every
// attribute it accepts and every boundary it has: the value that passes, the one
// next to it that must not, the range that runs off the end of the message, and
// the malformed input. Four defects lived behind the old thin coverage — all of
// them SILENT, because a recognizer that misreads its own attribute does not
// throw, it just quietly matches the wrong messages.
console.log('\nrecognizers — full attribute sweep');

// The reference data as the app holds it. Read from the live sandbox rather than
// re-parsed out of the file, so a test can never pass against a stale copy.
const recHelpObj = () => sandbox._t.recHelp;

// One recognizer, one payload. Hex in, verdict out — the same entry point the
// Test panel and the help examples use, so nothing here tests a private path.
const recHex = h => (String(h).replace(/\s+/g, '').match(/../g) || []).map(b => parseInt(b, 16));
const rec1 = (r, payload, ctx) =>
  fmtTestSpecs([{ name: 'T', recognizers: [r] }], recHex(payload), ctx)[0].passed;

// [label, recognizer, payload hex, expected]  — ctx-driven rules use recCtxCases.
const RECOGNIZER_CASES = [
  // literal — encodings, wildcards, lists, ranges, bounds
  ['literal ascii exact',            { type: 'literal', offset: 0, value: 'ISO' }, '49 53 4F 30', true],
  ['literal ascii mismatch',         { type: 'literal', offset: 0, value: 'ISO' }, '42 32 34 30', false],
  ['literal runs past the end',      { type: 'literal', offset: 0, value: 'ISO' }, '49 53', false],
  ['literal at an offset',           { type: 'literal', offset: 4, value: '02' }, '30 32 30 30 30 32', true],
  ['literal # digit wildcard',       { type: 'literal', offset: 0, value: '0###' }, '30 32 30 30', true],
  ['literal # rejects a letter',     { type: 'literal', offset: 0, value: '0###' }, '30 32 41 30', false],
  ['literal ? any byte',             { type: 'literal', offset: 0, value: '0?00' }, '30 58 30 30', true],
  ['literal OR list, first',         { type: 'literal', offset: 0, value: ['06', '07'] }, '30 36', true],
  ['literal OR list, second',        { type: 'literal', offset: 0, value: ['06', '07'] }, '30 37', true],
  ['literal OR list, neither',       { type: 'literal', offset: 0, value: ['06', '07'] }, '30 38', false],
  ['literal range lower bound',      { type: 'literal', offset: 0, value: [{ from: '01', to: '04' }] }, '30 31', true],
  ['literal range upper bound',      { type: 'literal', offset: 0, value: [{ from: '01', to: '04' }] }, '30 34', true],
  ['literal range just past',        { type: 'literal', offset: 0, value: [{ from: '01', to: '04' }] }, '30 35', false],
  ['literal alpha range',            { type: 'literal', offset: 0, value: [{ from: 'A', to: 'C' }] }, '42', true],
  ['literal range + loose value',    { type: 'literal', offset: 0, value: [{ from: '0', to: '4' }, '8'] }, '38', true],
  ['literal mixed-length range dropped', { type: 'literal', offset: 0, value: [{ from: '9', to: '10' }] }, '39', false],
  ['literal empty list matches nothing', { type: 'literal', offset: 0, value: [] }, '41', false],
  ['literal bare number read as text',   { type: 'literal', offset: 0, value: 4354 }, '34 33 35 34', true],
  ['literal ebcdic',                 { type: 'literal', offset: 0, encoding: 'ebcdic', value: 'ISO' }, 'C9 E2 D6', true],
  ['literal ebcdic rejects ascii',   { type: 'literal', offset: 0, encoding: 'ebcdic', value: 'ISO' }, '49 53 4F', false],
  ['literal encoding case-folded',   { type: 'literal', offset: 0, encoding: 'HEX', value: '43' }, '43', true],
  ['literal hex spaced as pasted',   { type: 'literal', offset: 0, encoding: 'hex', value: '43 54' }, '43 54', true],
  ['literal hex 0x-prefixed',        { type: 'literal', offset: 0, encoding: 'hex', value: '0x4354' }, '43 54', true],

  // isBinary / isAscii / isEbcdic — what KIND of data sits there
  ['isBinary finds one raw byte',    { type: 'binary', offset: 0, length: 4 }, '41 00 42 43', true],
  ['isBinary on clean text',         { type: 'binary', offset: 0, length: 4 }, '41 42 43 44', false],
  ['isBinary past the end',          { type: 'binary', offset: 0, length: 9 }, '41 42', false],
  ['isAscii all printable',          { type: 'ascii', offset: 0, length: 4 }, '41 42 43 44', true],
  ['isAscii rejects a NUL',          { type: 'ascii', offset: 0, length: 4 }, '41 00 42 43', false],
  ['isAscii rejects 0x7F',           { type: 'ascii', offset: 0, length: 1 }, '7F', false],
  ['isAscii accepts a space',        { type: 'ascii', offset: 0, length: 1 }, '20', true],
  ['isAscii past the end',           { type: 'ascii', offset: 0, length: 9 }, '41 42', false],
  ['isEbcdic on EBCDIC letters',     { type: 'ebcdic', offset: 0, length: 3 }, 'C1 C2 C3', true],
  ['isEbcdic rejects ASCII',         { type: 'ebcdic', offset: 0, length: 3 }, '41 42 43', false],
  ['isEbcdic rejects the I–J gap',   { type: 'ebcdic', offset: 0, length: 1 }, 'CA', false],

  // isNumeric / isAlphabetic / isAlphanumeric, both character sets
  ['isNumeric ascii',                { type: 'numeric', offset: 0, length: 3 }, '31 32 33', true],
  ['isNumeric rejects a letter',     { type: 'numeric', offset: 0, length: 3 }, '31 32 41', false],
  ['isNumeric ebcdic',               { type: 'numeric', offset: 0, length: 3, encoding: 'ebcdic' }, 'F1 F2 F3', true],
  ['isNumeric ebcdic rejects ascii', { type: 'numeric', offset: 0, length: 3, encoding: 'ebcdic' }, '31 32 33', false],
  ['isAlphabetic both cases',        { type: 'alphabetic', offset: 0, length: 3 }, '61 62 43', true],
  ['isAlphabetic rejects a digit',   { type: 'alphabetic', offset: 0, length: 3 }, '61 62 31', false],
  ['isAlphabetic ebcdic',            { type: 'alphabetic', offset: 0, length: 2, encoding: 'ebcdic' }, 'C1 81', true],
  ['isAlphanumeric mixed',           { type: 'alphanumeric', offset: 0, length: 3 }, '61 31 43', true],
  ['isAlphanumeric rejects a dash',  { type: 'alphanumeric', offset: 0, length: 3 }, '61 2D 43', false],
  ['isAlphanumeric ebcdic',          { type: 'alphanumeric', offset: 0, length: 2, encoding: 'ebcdic' }, 'C1 F1', true],

  // uint8 — eq / min / max / mask, and the absent-condition case
  ['uint8 eq',                       { type: 'uint8', offset: 0, eq: 2 }, '02', true],
  ['uint8 eq mismatch',              { type: 'uint8', offset: 0, eq: 2 }, '03', false],
  ['uint8 min/max lower bound',      { type: 'uint8', offset: 0, min: 96, max: 111 }, '60', true],
  ['uint8 min/max upper bound',      { type: 'uint8', offset: 0, min: 96, max: 111 }, '6F', true],
  ['uint8 min/max just past',        { type: 'uint8', offset: 0, min: 96, max: 111 }, '70', false],
  ['uint8 no conditions = exists',   { type: 'uint8', offset: 0 }, '01', true],
  ['uint8 past the end',             { type: 'uint8', offset: 5, eq: 1 }, '01', false],

  // uint16 / uint32 — the byte order, both spellings, and the bounds
  ['uint16 be',                      { type: 'uint16', offset: 0, endian: 'be', eq: 0x0102 }, '01 02', true],
  ['uint16 be is not le',            { type: 'uint16', offset: 0, endian: 'be', eq: 0x0201 }, '01 02', false],
  ['uint16 le',                      { type: 'uint16', offset: 0, endian: 'le', eq: 0x0201 }, '01 02', true],
  ['uint16 defaults to be',          { type: 'uint16', offset: 0, eq: 0x0102 }, '01 02', true],
  ['uint16 min rejects zero',        { type: 'uint16', offset: 0, endian: 'be', min: 1 }, '00 00', false],
  ['uint16 max',                     { type: 'uint16', offset: 0, endian: 'be', max: 4096 }, '20 00', false],
  ['uint16 truncated',               { type: 'uint16', offset: 0, endian: 'be', eq: 1 }, '00', false],
  ['uint32 be',                      { type: 'uint32', offset: 0, endian: 'be', eq: 0x12345678 }, '12 34 56 78', true],
  ['uint32 le',                      { type: 'uint32', offset: 0, endian: 'le', eq: 0x12345678 }, '78 56 34 12', true],
  ['uint32 defaults to be',          { type: 'uint32', offset: 0, eq: 0x12345678 }, '12 34 56 78', true],
  ['uint32 is unsigned',             { type: 'uint32', offset: 0, endian: 'be', eq: 4294967295 }, 'FF FF FF FF', true],
  ['uint32 truncated',               { type: 'uint32', offset: 0, eq: 1 }, '00 00 00', false],

  // length rules — strict on both sides, and the legacy inclusive pair
  ['greater-than is strict',         { type: 'greater-than', value: 5 }, '41 42 43 44 45', false],
  ['greater-than one over',          { type: 'greater-than', value: 5 }, '41 42 43 44 45 46', true],
  ['greater-than accepts length attr', { type: 'greater-than', length: 5 }, '41 42 43 44 45 46', true],
  ['less-than is strict',            { type: 'less-than', value: 5 }, '41 42 43 44 45', false],
  ['less-than one under',            { type: 'less-than', value: 5 }, '41 42 43 44', true],
  ['min-length is inclusive',        { type: 'min-length', value: 5 }, '41 42 43 44 45', true],
  ['max-length is inclusive',        { type: 'max-length', value: 5 }, '41 42 43 44 45', true],

  // mti — the ISO digit rules, not just four digits
  ['mti any valid',                  { type: 'mti', offset: 0, value: '####' }, '30 32 30 30', true],
  ['mti rejects reserved class 0',   { type: 'mti', offset: 0, value: '####' }, '30 30 30 30', false],
  ['mti rejects version 3',          { type: 'mti', offset: 0, value: '####' }, '33 32 30 30', false],
  ['mti rejects function 5',         { type: 'mti', offset: 0, value: '####' }, '30 32 35 30', false],
  ['mti rejects origin 6',           { type: 'mti', offset: 0, value: '####' }, '30 32 30 36', false],
  ['mti rejects a non-digit',        { type: 'mti', offset: 0, value: '####' }, '30 32 58 30', false],
  ['mti exact',                      { type: 'mti', offset: 0, value: '0200' }, '30 32 30 30', true],
  ['mti family pattern',             { type: 'mti', offset: 0, value: '01##' }, '30 31 31 30', true],
  ['mti family rejects other class', { type: 'mti', offset: 0, value: '01##' }, '30 32 30 30', false],
  ['mti at an offset',               { type: 'mti', offset: 3, value: '####' }, '49 53 4F 30 32 30 30', true],
  ['mti ebcdic',                     { type: 'mti', offset: 0, encoding: 'ebcdic', value: '####' }, 'F0 F2 F0 F0', true],
  ['mti truncated',                  { type: 'mti', offset: 0, value: '####' }, '30 32 30', false],

  // bitmap — DE numbering across bytes, both halves, all three encodings
  ['bitmap DE1 clear',               { type: 'bitmap', offset: 0, bit: 1, value: 0 }, '42 10 00 00 00 00 00 00', true],
  ['bitmap DE2 set',                 { type: 'bitmap', offset: 0, bit: 2, value: 1 }, '42 10 00 00 00 00 00 00', true],
  ['bitmap DE2 clear on 0x02',       { type: 'bitmap', offset: 0, bit: 2, value: 1 }, '02 10 00 00 00 00 00 00', false],
  ['bitmap DE7 set',                 { type: 'bitmap', offset: 0, bit: 7, value: 1 }, '42 10 00 00 00 00 00 00', true],
  ['bitmap DE12 in the second byte', { type: 'bitmap', offset: 0, bit: 12, value: 1 }, '42 10 00 00 00 00 00 00', true],
  ['bitmap value 0 means absent',    { type: 'bitmap', offset: 0, bit: 12, value: 0 }, '42 10 00 00 00 00 00 00', false],
  ['bitmap value defaults to 1',     { type: 'bitmap', offset: 0, bit: 2 }, '42 10 00 00 00 00 00 00', true],
  ['bitmap at an offset',            { type: 'bitmap', offset: 4, bit: 2, value: 1 }, '00 00 00 00 40 00 00 00 00 00 00 00', true],
  ['bitmap DE65 in the secondary',   { type: 'bitmap', offset: 0, bit: 65, value: 1 }, '42 10 00 00 00 00 00 00 80 00 00 00 00 00 00 00', true],
  ['bitmap DE65 with no secondary',  { type: 'bitmap', offset: 0, bit: 65, value: 0 }, '42 10 00 00 00 00 00 00', false],
  ['bitmap bit 0 is out of range',   { type: 'bitmap', offset: 0, bit: 0, value: 1 }, '42 10 00 00 00 00 00 00', false],
  ['bitmap bit 129 is out of range', { type: 'bitmap', offset: 0, bit: 129, value: 1 }, '42 10 00 00 00 00 00 00', false],
  ['bitmap ascii-hex DE2',           { type: 'bitmap', offset: 0, encoding: 'ascii-hex', bit: 2, value: 1 }, '34 32 31 30 30 30 30 30 30 30 30 30 30 30 30 30', true],
  ['bitmap ascii-hex DE12',          { type: 'bitmap', offset: 0, encoding: 'ascii-hex', bit: 12, value: 1 }, '34 32 31 30 30 30 30 30 30 30 30 30 30 30 30 30', true],
  ['bitmap ascii-hex lower case',    { type: 'bitmap', offset: 0, encoding: 'ascii-hex', bit: 2, value: 1 }, '34 61 31 30 30 30 30 30 30 30 30 30 30 30 30 30', true],
  ['bitmap ascii-hex non-hex',       { type: 'bitmap', offset: 0, encoding: 'ascii-hex', bit: 2, value: 1 }, '5A 5A 31 30 30 30 30 30 30 30 30 30 30 30 30 30', false],
  ['bitmap ebcdic DE2',              { type: 'bitmap', offset: 0, encoding: 'ebcdic', bit: 2, value: 1 }, 'F4 F2 F1 F0 F0 F0 F0 F0 F0 F0 F0 F0 F0 F0 F0 F0', true],
  ['bitmap presence, no bit named',  { type: 'bitmap', offset: 0 }, '42 10 00 00 00 00 00 00', true],
  ['bitmap presence, too short',     { type: 'bitmap', offset: 0, length: 8 }, '42 10 00', false],
  ['bitmap presence, hex text',      { type: 'bitmap', offset: 0, encoding: 'ascii-hex' }, '34 32 31 30 30 30 30 30 30 30 30 30 30 30 30 30', true],
  ['bitmap presence rejects text',   { type: 'bitmap', offset: 0, encoding: 'ascii-hex' }, '4E 4F 54 48 45 58 41 54 41 4C 4C 30 30 30 30 30', false],

  // regex — anchoring, the window, the character set, and a broken pattern
  ['regex anchored',                 { type: 'regex', pattern: '^ISO' }, '49 53 4F 30', true],
  ['regex anchored elsewhere',       { type: 'regex', pattern: '^ISO' }, '42 32 34 49 53 4F', false],
  ['regex unanchored',               { type: 'regex', pattern: 'ISO' }, '42 32 34 49 53 4F', true],
  ['regex with a window',            { type: 'regex', offset: 3, length: 4, pattern: '^[0-9]{4}$' }, '49 53 4F 30 32 30 30 41 42', true],
  ['regex window excludes the rest', { type: 'regex', offset: 3, length: 4, pattern: '^[0-9]{4}$' }, '49 53 4F 30 32 41 30 41 42', false],
  ['regex ebcdic',                   { type: 'regex', encoding: 'ebcdic', pattern: '^ISO' }, 'C9 E2 D6', true],
  ['regex offset past the end',      { type: 'regex', offset: 9, pattern: '.' }, '41 42', false],
  ['regex that does not compile',    { type: 'regex', pattern: '([a' }, '41 42', false],

  // density — thresholds, both character sets, and the empty range
  ['hex-density all hex',            { type: 'hex-density', offset: 0, length: 8, min: 1 }, '44 45 41 44 42 45 45 46', true],
  ['hex-density one stray char',     { type: 'hex-density', offset: 0, length: 8, min: 1 }, '44 45 41 44 42 45 45 5A', false],
  ['hex-density tolerant threshold', { type: 'hex-density', offset: 0, length: 8, min: 0.75 }, '44 45 41 44 2D 42 45 46', true],
  ['hex-density below threshold',    { type: 'hex-density', offset: 0, length: 8, min: 0.75 }, '44 45 41 44 5A 5A 5A 5A', false],
  ['hex-density ebcdic',             { type: 'hex-density', offset: 0, length: 4, min: 1, encoding: 'ebcdic' }, 'C1 C2 F0 F9', true],
  ['hex-density empty range',        { type: 'hex-density', offset: 0, length: 0, min: 0.5 }, '41 42', false],
  ['hex-density rejects raw bytes',  { type: 'hex-density', offset: 0, length: 2, min: 1 }, '82 83', false],
  ['oct-density all octal',          { type: 'oct-density', offset: 0, length: 4, min: 1 }, '30 31 32 33', true],
  ['oct-density rejects 8 and 9',    { type: 'oct-density', offset: 0, length: 4, min: 1 }, '30 31 38 39', false],
  ['oct-density ebcdic',             { type: 'oct-density', offset: 0, length: 2, min: 1, encoding: 'ebcdic' }, 'F0 F7', true],

  // length-payload — it checks the payload FITS, which is not the same as equals
  ['length-payload exact',           { type: 'length-payload', offset: 0, encoding: 'uint16-be', body_offset: 2 }, '00 03 41 42 43', true],
  ['length-payload short still fits',{ type: 'length-payload', offset: 0, encoding: 'uint16-be', body_offset: 2 }, '00 01 41 42 43', true],
  ['length-payload overruns',        { type: 'length-payload', offset: 0, encoding: 'uint16-be', body_offset: 2 }, '00 09 41 42 43', false],
  ['length-payload header truncated',{ type: 'length-payload', offset: 0, encoding: 'uint16-be', body_offset: 2 }, '00', false],
  ['length-payload includes_self',   { type: 'length-payload', offset: 0, encoding: 'uint16-be', body_offset: 2, includes_self: true }, '00 05 41 42 43', true],
  ['length-payload includes_self over', { type: 'length-payload', offset: 0, encoding: 'uint16-be', body_offset: 2, includes_self: true }, '00 0B 41 42 43', false],
  ['length-payload uint16-le',       { type: 'length-payload', offset: 0, encoding: 'uint16-le', body_offset: 2 }, '03 00 41 42 43', true],
  ['length-payload uint8',           { type: 'length-payload', offset: 0, encoding: 'uint8', body_offset: 1 }, '03 41 42 43', true],
  ['length-payload bcd2',            { type: 'length-payload', offset: 0, encoding: 'bcd2', body_offset: 2 }, '00 03 41 42 43', true],
  ['length-payload bcd2 overruns',   { type: 'length-payload', offset: 0, encoding: 'bcd2', body_offset: 2 }, '00 09 41 42 43', false],
  ['length-payload unknown encoding',{ type: 'length-payload', offset: 0, encoding: 'nope', body_offset: 2 }, '00 03 41 42 43', false],
  ['length-prefix is the same rule', { type: 'length-prefix', offset: 0, encoding: 'uint16-be', body_offset: 2 }, '00 03 41 42 43', true],

  // flag-payload — non-zero, plus the optional size check
  ['flag-payload non-zero',          { type: 'flag-payload', offset: 0, encoding: 'uint8' }, '01 41 42', true],
  ['flag-payload any non-zero',      { type: 'flag-payload', offset: 0, encoding: 'uint8' }, 'FF 41 42', true],
  ['flag-payload zero',              { type: 'flag-payload', offset: 0, encoding: 'uint8' }, '00 41 42', false],
  ['flag-payload body fits',         { type: 'flag-payload', offset: 0, encoding: 'uint8', body_offset: 1, body_length: 4 }, '01 41 42 43 44', true],
  ['flag-payload body overruns',     { type: 'flag-payload', offset: 0, encoding: 'uint8', body_offset: 1, body_length: 4 }, '01 41 42', false],
  ['flag-payload truncated',         { type: 'flag-payload', offset: 0, encoding: 'uint16-be' }, '01', false],
  ['flag-prefix is the same rule',   { type: 'flag-prefix', offset: 0, encoding: 'uint8' }, '01 41', true],

  // an unregistered type must never claim a message
  ['an unknown type matches nothing', { type: 'not-a-recognizer' }, '41 42', false],
];

test('every recognizer behaves as documented, at every boundary it has', () => {
  const wrong = RECOGNIZER_CASES
    .filter(([, r, payload, want]) => rec1(r, payload) !== want)
    .map(([label]) => label);
  deepEq(wrong, [], 'recognizers whose verdict does not match the documented one');
  assert.ok(RECOGNIZER_CASES.length > 130,
    `expected a sweep, found ${RECOGNIZER_CASES.length} cases`);
});

// [label, recognizer, ctx, expected] — these read the record wrapper, not bytes.
const RECOGNIZER_CTX_CASES = [
  ['source exact',                { type: 'source', pattern: 'PIA^A910' }, { source: 'PIA^A910' }, true],
  ['source mismatch',             { type: 'source', pattern: 'PIA^A910' }, { source: 'PIA^B910' }, false],
  ['source $ is one alphanum',    { type: 'source', pattern: 'PIA^$910' }, { source: 'PIA^B910' }, true],
  ['source $ is not two',         { type: 'source', pattern: 'PIA^$910' }, { source: 'PIA^AB910' }, false],
  ['source # is one digit',       { type: 'source', pattern: 'ACQ##' }, { source: 'ACQ42' }, true],
  ['source # rejects a letter',   { type: 'source', pattern: 'ACQ##' }, { source: 'ACQAB' }, false],
  ['source * spans anything',     { type: 'source', pattern: 'PIA*' }, { source: 'PIA^A910' }, true],
  ['source is anchored',          { type: 'source', pattern: 'ACQ' }, { source: 'ACQ1' }, false],
  ['source is case-insensitive',  { type: 'source', pattern: 'acq1' }, { source: 'ACQ1' }, true],
  ['source ^ is literal',         { type: 'source', pattern: 'PIA^A910' }, { source: 'PIAXA910' }, false],
  ['source catch-all with no ctx', { type: 'source', pattern: '*' }, null, true],
  ['source empty pattern is catch-all', { type: 'source', pattern: '' }, null, true],
  ['source specific with no ctx',  { type: 'source', pattern: 'ACQ1' }, null, false],
  ['source specific, field absent', { type: 'source', pattern: 'ACQ1' }, {}, false],
  ['destination reads dest',       { type: 'destination', pattern: 'SW1' }, { dest: 'SW1' }, true],
  ['destination reads destination', { type: 'destination', pattern: 'SW1' }, { destination: 'SW1' }, true],
  ['destination ignores source',   { type: 'destination', pattern: 'SW1' }, { source: 'SW1' }, false],
  ['filename exact',               { type: 'filename', pattern: '$ATM.AUDIT.LOG' }, { filename: '$ATM.AUDIT.LOG' }, true],
  ['filename is anchored',         { type: 'filename', pattern: '$ATM.AUDIT.LOG' }, { filename: '$ATM.AUDIT.LOG1' }, false],
  ['filename dots are literal',    { type: 'filename', pattern: '$ATM.AUDIT.LOG' }, { filename: '$ATMXAUDITXLOG' }, false],
  ['filename $ is literal',        { type: 'filename', pattern: '$ATM.AUDIT.LOG' }, { filename: 'XATM.AUDIT.LOG' }, false],
  ['filename * in a component',    { type: 'filename', pattern: '$ATM.AUDIT.*' }, { filename: '$ATM.AUDIT.LOG42' }, true],
  ['filename * stays in subvol',   { type: 'filename', pattern: '$ATM.AUDIT.*' }, { filename: '$ATM.OTHER.LOG' }, false],
  ['filename ? is one character',  { type: 'filename', pattern: '$A.B.C?' }, { filename: '$A.B.CX' }, true],
  ['filename # is one digit',      { type: 'filename', pattern: '*.NETARD.LOG##' }, { filename: '$D.NETARD.LOG42' }, true],
  ['filename # rejects letters',   { type: 'filename', pattern: '*.NETARD.LOG##' }, { filename: '$D.NETARD.LOGAB' }, false],
  ['filename is case-insensitive', { type: 'filename', pattern: '$atm.audit.log' }, { filename: '$ATM.AUDIT.LOG' }, true],
];

test('metadata recognizers read the record wrapper, and refuse to guess', () => {
  const wrong = RECOGNIZER_CTX_CASES
    .filter(([, r, ctx, want]) => rec1(r, '41 42', ctx) !== want)
    .map(([label]) => label);
  deepEq(wrong, [], 'metadata recognizers whose verdict is wrong');
});

// ── the four silent defects, each pinned by the case that exposed it ─────────

test('uint16 and uint32 read "be" as BIG-endian, which is what everything writes', () => {
  // The evaluator tested `endian === 'big'`, so 'be' — written by the recognizer
  // form, by the in-app help and by the shipped Base24 POS spec — fell through to
  // LITTLE-endian. Nothing threw; the rule just compared a byte-swapped number.
  assert.ok(rec1({ type: 'uint16', offset: 0, endian: 'be', eq: 258 }, '01 02'),
    '"be" on 01 02 is 258');
  assert.ok(!rec1({ type: 'uint16', offset: 0, endian: 'be', eq: 513 }, '01 02'),
    '"be" must not produce the little-endian reading');
  assert.ok(rec1({ type: 'uint32', offset: 0, endian: 'be', eq: 0x01020304 }, '01 02 03 04'),
    'and the same for uint32');
  // 'big'/'little' still work, so a hand-written spec using the SPEC's older
  // spelling keeps its meaning.
  assert.ok(rec1({ type: 'uint16', offset: 0, endian: 'big', eq: 258 }, '01 02'), '"big" still means big');
  assert.ok(rec1({ type: 'uint16', offset: 0, endian: 'little', eq: 513 }, '01 02'), '"little" still means little');
  // The form only ever offers be/le, so those are the values that must be right.
  const endf = html.match(/const endf = k => \{[\s\S]*?\};/)[0];
  assert.ok(/'be'/.test(endf) && />be</.test(endf) && />le</.test(endf),
    'the form writes be/le, which is why the evaluator has to read them');
});

test('bitmap tests the DE bit it names, instead of only checking a bitmap is there', () => {
  // `bit` and `value` were accepted by the form, stored in the spec, printed in
  // the recognizer row — and never read. The rule returned `offset + length <=
  // bytes.length`, so "DE 2 is on" passed on a message where DE 2 was off, and
  // "DE 2 is off" passed on the same bytes. Every bitmap rule was a no-op.
  const on = '42 10 00 00 00 00 00 00';   // byte 0 = 0100 0010 → DE 2, DE 7
  const off = '02 10 00 00 00 00 00 00';  // the same bitmap without DE 2
  assert.ok(rec1({ type: 'bitmap', offset: 0, bit: 2, value: 1 }, on), 'DE 2 set');
  assert.ok(!rec1({ type: 'bitmap', offset: 0, bit: 2, value: 1 }, off), 'DE 2 clear must not match');
  assert.ok(!rec1({ type: 'bitmap', offset: 0, bit: 2, value: 0 }, on),
    'and the two values must disagree on the same bytes');
  assert.ok(rec1({ type: 'bitmap', offset: 0, bit: 2, value: 0 }, off), 'value 0 matches an absent DE');
  // Naming no bit keeps the presence check the hex-text forms have always done.
  assert.ok(rec1({ type: 'bitmap', offset: 0 }, on), 'no bit named — presence only');
  assert.ok(!rec1({ type: 'bitmap', offset: 0, length: 8 }, '42 10'), 'presence still needs the bytes');
});

test('a uint8 mask is read as hex, because a mask is a bit pattern', () => {
  // It went through Number(), where 'F0' is NaN and `v &= NaN` is 0 — so the
  // documented form masked the byte away to nothing and compared that. The help
  // example was `mask=F0 eq=96`, which could never have passed.
  assert.ok(rec1({ type: 'uint8', offset: 0, mask: 'F0', eq: 96 }, '67'), '0x67 AND F0 = 0x60');
  assert.ok(rec1({ type: 'uint8', offset: 0, mask: 'f0', eq: 96 }, '67'), 'lower case too');
  assert.ok(rec1({ type: 'uint8', offset: 0, mask: '0xF0', eq: 96 }, '67'), 'a 0x prefix is accepted');
  assert.ok(rec1({ type: 'uint8', offset: 0, mask: '0F', eq: 7 }, '67'), 'the low nibble');
  assert.ok(rec1({ type: 'uint8', offset: 0, mask: '80', eq: 128 }, 'F0'), 'a single flag bit');
  assert.ok(!rec1({ type: 'uint8', offset: 0, mask: '80', eq: 128 }, '70'), 'and its absence');
  // Digits-only masks are hex as well — there is no second, decimal reading.
  assert.ok(rec1({ type: 'uint8', offset: 0, mask: '10', eq: 16 }, '77'), '"10" is hex 0x10 = 16');
  // A mask that is not hex leaves the rule unevaluable, and it must not fall
  // back to zero — zero would have made `eq: 0` match every byte in the file.
  assert.ok(!rec1({ type: 'uint8', offset: 0, mask: 'ZZ', eq: 0 }, '67'), 'garbage matches nothing');
  assert.ok(!rec1({ type: 'uint8', offset: 0, mask: '', eq: 0 }, '67'), 'and so does an empty mask');
});

test('a "?" in a hex literal masks a nibble, not nothing', () => {
  // Only '??' was a wildcard. A lone '?' survived compilation and then went
  // through parseInt('4?', 16), which is 4 — so the rule silently tested for the
  // byte 0x04 and matched nothing anyone expected.
  assert.ok(rec1({ type: 'literal', offset: 0, encoding: 'hex', value: '6?' }, '60'), 'low nibble free');
  assert.ok(rec1({ type: 'literal', offset: 0, encoding: 'hex', value: '6?' }, '6F'), 'across the range');
  assert.ok(!rec1({ type: 'literal', offset: 0, encoding: 'hex', value: '6?' }, '70'), 'high nibble fixed');
  assert.ok(rec1({ type: 'literal', offset: 0, encoding: 'hex', value: '?3' }, '43'), 'high nibble free');
  assert.ok(!rec1({ type: 'literal', offset: 0, encoding: 'hex', value: '?3' }, '44'), 'low nibble fixed');
  assert.ok(rec1({ type: 'literal', offset: 0, encoding: 'hex', value: '??' }, '43'), 'a whole byte still free');
  assert.ok(rec1({ type: 'literal', offset: 0, encoding: 'hex', value: 'F0?8' }, 'F0 C8'), 'across two bytes');
  assert.ok(rec1({ type: 'literal', offset: 0, encoding: 'hex', value: 'F0F8' }, 'F0 F8'), 'exact hex unaffected');
  assert.ok(!rec1({ type: 'literal', offset: 0, encoding: 'hex', value: 'F0F8' }, 'F0 F9'), 'and still rejects');
});

// ── the recognizer reference ────────────────────────────────────────────────

test('every recognizer the form offers has a reference entry, and every entry is reachable', () => {
  // The index used to be a hand-written table keyed by DISPLAY name — isBinary
  // where the help was keyed binary — so six of the twenty-two rows rendered,
  // highlighted on hover, and did nothing when clicked. The index is derived now,
  // which is what makes that class of mismatch impossible rather than fixed.
  const help = recHelpObj();
  const types = psFnSource('_meRecForm').match(/const types = \[([\s\S]*?)\]\.sort/)[1];
  const offered = [...types.matchAll(/\['([a-z0-9-]+)'/g)].map(m => m[1]);
  assert.ok(offered.length > 15, `expected the type dropdown, found ${offered.length}`);
  deepEq(offered.filter(t => !help[t]), [], 'types the form offers with no reference entry');
  // Every row the index renders must resolve — that is the bug, stated directly.
  const idx = sandbox._t.meRecHelpHtml();
  const rows = [...idx.matchAll(/data-rec="([a-z0-9-]+)"/g)].map(m => m[1]);
  assert.ok(rows.length > 15, `expected an index, found ${rows.length} rows`);
  deepEq(rows.filter(t => !help[t]), [], 'index rows whose detail does not exist');
  // …and the visible rows are exactly the non-hidden entries.
  deepEq(rows.slice().sort(), Object.keys(help).filter(t => !help[t].hidden).sort(),
    'the index and the reference are the same set');
});

test('every reference entry is structured, and its examples are RUN', () => {
  const help = recHelpObj();
  for (const [type, info] of Object.entries(help)) {
    assert.ok(Array.isArray(info.desc) && info.desc.length, `${type}: no description`);
    assert.ok(Array.isArray(info.attrs), `${type}: no attribute table`);
    assert.ok(Array.isArray(info.useWhen) && info.useWhen.length, `${type}: no guidance`);
    if (info.hidden) continue;
    assert.ok(info.examples.length, `${type}: a visible entry with no example`);
    for (const [i, ex] of info.examples.entries()) {
      const where = `${type} example ${i + 1}`;
      assert.ok(ex.what && ex.rec && ex.rec.type, `${where}: incomplete`);
      eq(ex.rec.type, type, `${where}: demonstrates the wrong recognizer`);
      assert.ok((ex.cases || []).length >= 2, `${where}: needs a contrast, not one case`);
      // Every attribute an example names must be one the reference documents —
      // an example that quietly uses an undocumented attribute is how the help
      // and the evaluator drift apart in the first place.
      const documented = new Set(info.attrs.map(a => a[0]).concat(['type', 'id']));
      const undocumented = Object.keys(ex.rec).filter(k => !documented.has(k));
      deepEq(undocumented, [], `${where}: uses attributes the table does not list`);
    }
  }
});

test('a reference example that stopped being true fails here, not silently in the panel', () => {
  // The verdict column is produced by running the rule. That is the whole point:
  // the old help SAID bitmap tested a bit and said it for as long as anyone cared
  // to read it. This asserts the panel can still run every example without
  // throwing, and that each one still shows the contrast it was written for.
  const help = recHelpObj();
  let ran = 0;
  for (const [type, info] of Object.entries(help)) {
    for (const [i, ex] of (info.examples || []).entries()) {
      const verdicts = ex.cases.map(c => {
        ran++;
        return sandbox._t.meRecHelpRun(ex.rec, c);
      });
      // A catch-all pattern is the one honest exception: it demonstrates that
      // the rule passes in situations where every other rule would not.
      const isCatchAll = ex.rec.pattern === '*' || ex.rec.pattern === '';
      if (!isCatchAll)
        assert.ok(new Set(verdicts).size > 1,
          `${type} example ${i + 1}: every case returns ${verdicts[0]}, so it shows nothing`);
      // And the card itself must render.
      const card = sandbox._t.meRecHelpExampleHtml(ex, i);
      assert.ok(/Verdict/.test(card) && /me-rec-ex-(yes|no)/.test(card),
        `${type} example ${i + 1}: the card has no verdict`);
    }
  }
  assert.ok(ran > 100, `expected the examples to be exercised, ran ${ran} cases`);
});

test('the recognizer reference and the Parse Spec reference are the same panel', () => {
  // "Not only look and feel" — they share the stylesheet classes, the attribute
  // table, the clickable filter and the description renderer. Sharing the last
  // one is what stops the two drifting into rendering identical data differently.
  const recSel = psFnSource('_meRecHelpSelect');
  const psSel  = psFnSource('_mePsHelpSelect');
  for (const cls of ['me-ps-help-atbl', 'me-ps-help-aname', 'me-ps-help-atype',
                     'me-ps-attr-row', 'me-ps-help-section-title', 'me-ps-help-detail-title']) {
    assert.ok(recSel.includes(cls), `the recognizer panel is missing ${cls}`);
    assert.ok(psSel.includes(cls), `the parse spec panel is missing ${cls}`);
  }
  assert.ok(/_meHelpDescHtml\(/.test(recSel) && /_meHelpDescHtml\(/.test(psSel),
    'both render attribute descriptions through the one shared function');
  assert.ok(!/const descHtml = /.test(psSel),
    'and the parse spec panel no longer keeps a private copy of it');
  // Both example cards use the same card, label and snippet markup.
  const recEx = psFnSource('_meRecHelpExampleHtml');
  assert.ok(/me-ps-help-ex/.test(recEx) && /me-ps-ex-num/.test(recEx) &&
            /me-ps-help-snippet/.test(recEx) && /_mePsCopyExample/.test(recEx),
    'recognizer examples are the same card, and copy the same way');
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


// CHANGED BACK ON PURPOSE. v1.2.5.0 made a hex-char length count CHARACTERS, so
// PIC X(4) read two wire bytes. That welded two unrelated things together: how a
// field is READ, and how WIDE it is. Three problems followed — the DDL's number
// silently acquired a second unit, the only way back to four bytes was to type 8
// into a box seeded with 4, and the guard that suppresses a pointless override
// compared that typed 4 against the declared 4 and discarded it.
//
// A type now says only how to read the bytes. Width comes from the DDL or from a
// `bytes` override, always in bytes. What a VLG length COUNTS moved to its own
// `count` attribute, which is the one place characters still matter.

test('hex-char on a PIC X(4) reads all four bytes and renders eight characters', () => {
  const ctx = bytesCase({ type: 'hex-char' });
  const f = ctx.fields.find(x => x.id === 'MSGTYPE');
  eq(f.rawHex.length / 2, 4, 'the declared four bytes, untouched by the type');
  eq(f.value, '02003020', 'rendered as their eight hex characters');
  eq(ctx.fields.find(x => x.id === 'TAIL').startByte, 4, 'and TAIL stays where the DDL puts it');
});

test('a field with NO type override is not touched by any of this', () => {
  // The guard the old test was really providing. Nothing about character
  // counting may reach a field that never asked for it.
  const ctx = bytesCase({});
  const f = ctx.fields.find(x => x.id === 'MSGTYPE');
  eq(f.rawHex, '02003020', 'all four declared bytes');
  eq(ctx.fields.find(x => x.id === 'TAIL').startByte, 4, 'TAIL exactly where the DDL puts it');
});

test('"bytes" is a BYTE count, whatever the type says', () => {
  // The number you type is the number of bytes you get. Under v1.2.5.0 this same
  // override meant two characters — one wire byte — and that is the reversal.
  const ctx = bytesCase({ type: 'hex-char', bytes: 2 });
  const f = ctx.fields.find(x => x.id === 'MSGTYPE');
  eq(f.rawHex, '0200', 'two wire bytes');
  eq(f.value, '0200', 'shown as the four hex characters they spell');
});

test('a one-byte override reads one byte — there is no half character to drop', () => {
  // v1.2.5.0 read this as ONE CHARACTER and trimmed the value to "0", spending a
  // whole byte to show half of it. A width is whole bytes now, so the trim is gone.
  const ctx = bytesCase({ type: 'hex-char', bytes: 1 });
  const f = ctx.fields.find(x => x.id === 'MSGTYPE');
  eq(f.rawHex, '02', 'one whole byte consumed');
  eq(f.value, '02', 'and both of its characters are shown');
  eq(ctx.fields.find(x => x.id === 'TAIL').startByte, 1, 'the next field starts after it');
});

test('shrinking a field frees its leftover bytes for the NEXT field to read', () => {
  // MSGTYPE is PIC X(4) holding 02 00 30 20; a two-byte override cuts it to two,
  // and the two that frees must reach TAIL rather than being skipped because the
  // DDL says TAIL starts at 4.
  const ctx = bytesCase({ type: 'hex-char', bytes: 2 });
  const tail = ctx.fields.find(x => x.id === 'TAIL');
  eq(tail.startByte, 2, 'TAIL moved up to where MSGTYPE now ends');
  eq(tail.rawHex, '3020', 'and reads the two bytes it finds there');
});

test('growing a field pushes the ones after it along', () => {
  const ctx = bytesCase({ bytes: 5 });
  const tail = ctx.fields.find(x => x.id === 'TAIL');
  eq(tail.startByte, 5, 'TAIL starts one byte later than declared');
});

// CHANGED ON PURPOSE (v1.2.5.0). This read "no BYTES override" but supplied a
// hex-char TYPE override, and a hex-char type now implies a width of its own.
// The guarantee it was really protecting — a field nobody overrode cannot move —
// is asserted directly above by 'a field with NO type override is not touched'.
test('a 1:1 type override still leaves every field exactly where the DDL declares', () => {
  const ctx = bytesCase({ type: 'ascii' });
  const tail = ctx.fields.find(x => x.id === 'TAIL');
  eq(tail.startByte, 4, 'unchanged — ascii is one character per byte');
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
  // "bytes": 2 is two WIRE BYTES, so the formatter sees those two — not the
  // declared four, and not the one byte the old character rule would have left.
  const f = bytesCase({ type: 'hex-char', bytes: 2, display: 'hex' }).fields.find(x => x.id === 'MSGTYPE');
  eq(f.value, '0200', 'type applied to the two bytes the override asked for');
  eq(f.displayValue, '0x0200', 'display formatted those same two bytes, not the declared 4');
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
  // `count` is written in by the same pass: what a VLG length counts used to be
  // inferred from the LEN's type, so a spec from before that attribute existed
  // has the answer only implicitly. An `ascii` LEN counted bytes, and still does.
  deepEq(spec.overrides.F,
    { type: 'ascii', display: 'hex', de: 3, vlg: true, count: 'bytes' }, 'all four merged');
});

test('migration writes down what a VLG length used to count, without changing it', () => {
  // The rule it replaces: a hex-char LEN counted hex digits, everything else
  // counted bytes. Both readings have to survive a spec written before `count`.
  const hex = migrateOverrides({
    overrides: { LEN: { type: 'hex-char', vlg: true } } });
  eq(hex.overrides.LEN.count, 'digits', 'a hex-char length source counted digits');
  const bin = migrateOverrides({
    overrides: { LEN: { type: 'uint-be', vlg: true } } });
  eq(bin.overrides.LEN.count, 'bytes', 'anything else counted bytes');
  // On a GROUP the type sits on the leaf `vlg` names, not on the group.
  const grp = migrateOverrides({
    overrides: { GRP: { vlg: 'GRP.LEN' }, 'GRP.LEN': { type: 'hex-char' } } });
  eq(grp.overrides.GRP.count, 'digits', 'the leaf it names decides it');
  // An explicit count is never overwritten, and a non-VLG field never gains one.
  const kept = migrateOverrides({
    overrides: { LEN: { type: 'hex-char', vlg: true, count: 'bytes' }, OTHER: { type: 'hex-char' } } });
  eq(kept.overrides.LEN.count, 'bytes', 'a stated count is left alone');
  eq(kept.overrides.OTHER.count, undefined, 'and a field that is not a length source gets none');
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
// ── The parse dispatcher does each chunk's work once, and ticks honestly ────
// Watching a slow parse showed the panel jump from "Detecting message types" to
// "Retrieving DDL definitions" with nothing between them, and the detection
// summary appearing three steps later. The step was ticked immediately because
// it is informational — the actual detection ran inside the SCORING step, twice:
// once to pick a representative for scoring and again in the main loop. Every
// chunk was byte-extracted, EBCDIC-scanned and detected twice for one answer.

console.log('\nthe parse dispatcher does each chunk once');

test('the dispatcher detects each chunk once, not once per pass', () => {
  const fn = psFnSource('doParseMessages');
  const dispatcher = fn.slice(fn.indexOf('Detecting message types'));
  // One detection call, and it is the trace form — a strict superset of
  // detectMsgType (same spec order, same short-circuits, same winner) so one
  // call serves both the scoring representative and the main loop.
  eq((dispatcher.match(/detectMsgTypeTrace\(/g) || []).length, 1, 'one trace detection');
  eq((dispatcher.match(/[^a-zA-Z]detectMsgType\(/g) || []).length, 0,
     'and no second, plain detection');
  // Byte extraction and the EBCDIC scan travel with it.
  eq((dispatcher.match(/extractBytes\(chunk/g) || []).length, 1, 'one byte extraction');
  eq((dispatcher.match(/_f09 = 0/g) || []).length, 1, 'one EBCDIC scan');
});

test('the detection summary is attached with the tick, not back-filled', () => {
  const fn = psFnSource('doParseMessages');
  const i = fn.indexOf('Detecting message types');
  const summary = fn.indexOf("_ppSetDetectDetails('Detecting message types'", i);
  const tick    = fn.indexOf('_parseProgressDoneLast()', i);
  assert.ok(summary > 0 && tick > 0, 'both are present');
  assert.ok(summary < tick,
    'the summary is set BEFORE the step is ticked, so a finished step is never empty');
  // Exactly one place sets it — the old code set it again three steps later.
  eq((fn.match(/_ppSetDetectDetails\('Detecting message types'/g) || []).length, 1,
     'and it is set once');
});

test('both scoring passes read the cached per-chunk facts', () => {
  const fn = psFnSource('doParseMessages');
  const scoring = fn.slice(fn.indexOf('function _startP23Scoring'));
  assert.ok(!/for \(const chunk of chunks\)/.test(scoring),
    'neither pass re-walks the raw chunks');
  assert.ok((scoring.match(/for \(const ci of _chunkInfo\)/g) || []).length >= 2,
     'both passes read the cache');
});

test('every field the loops read off the cache is actually put there', () => {
  // I broke this while writing the cache: the unknown-type diagnostic still read
  // `detectStr` and `_detTrace`, which had been locals of the loop the cache
  // replaced. Nothing failed, because no test walks an unrecognised message —
  // it would have thrown in front of a user instead.
  const fn = psFnSource('doParseMessages');
  const seg = fn.slice(fn.indexOf('const _chunkInfo = []'));
  const lit = /_chunkInfo\.push\(\{([\s\S]*?)\}\);/.exec(seg);
  assert.ok(lit, 'the cache is populated in one place');
  const pushed = new Set(lit[1].split(',').map(p => p.split(':')[0].trim()).filter(Boolean));
  const used = new Set();
  for (const m of seg.matchAll(/const \{([^}]*)\}\s*=\s*ci;/g))
    for (const part of m[1].split(',')) used.add(part.split(':')[0].trim());
  assert.ok(used.size > 0, 'the loops destructure from the cache');
  const missing = [...used].filter(k => !pushed.has(k));
  assert.deepStrictEqual(missing, [],
    `read off the cache but never put there: ${missing.join(', ')}`);
});

test('compiling and scoring happen only when a chunk needs a DDL', () => {
  // Scoring exists to fill a MISSING binding — only the `needs-ddl` verdict
  // consults it. A spec that binds its own DDL resolves it with getDDLFromPath,
  // so compiling every candidate in three subvolumes and scoring 35 of them
  // answered a question nobody asked, on every parse.
  const fn = psFnSource('doParseMessages');
  assert.ok(/const _needScore = _chunkInfo\.some\(ci => ci\.verdict\.kind === 'needs-ddl'\)/.test(fn),
    'the condition is the verdict, not a guess');
  const gate = fn.indexOf('const _needScore');
  const compile = fn.indexOf('if (useCache)', gate);
  const bail = fn.indexOf('if (!_needScore)', gate);
  assert.ok(bail > 0 && bail < compile,
    'and it short-circuits BEFORE the compile path, not after');
  // The scoring step must not announce itself when there is nothing to score.
  assert.ok(/if \(_scoring\) _parseProgressStep\(`Scoring/.test(fn),
    'the Scoring step is announced only when candidates were compiled');
});

test('the "nothing to score" argument is unpacked once, never dereferenced', () => {
  // The gate above was right, and I still broke every matched message with it.
  // `null` meant "nothing needed a DDL", and I guarded three of the four places
  // that touched it — the fourth was the pre-scoring pool, which indexes the map
  // for any chunk that HAS a volume, i.e. every message that matched. A message
  // that parsed cleanly a minute earlier died with
  //   TypeError: Cannot read properties of null (reading 'BASE')
  // and the suite stayed green, because the whole scoring body lives inside a
  // setTimeout the sandbox stubs to a no-op. Nothing here can execute it, so the
  // rule is enforced on the text: the null is unpacked at the top and the body
  // reads _scoring / _pool, which are safe by construction.
  const fn = psFnSource('doParseMessages');
  const at = fn.indexOf('function _startP23Scoring(');
  assert.ok(at >= 0, '_startP23Scoring not found');
  let depth = 0, end = at;
  for (let i = fn.indexOf('{', at); i < fn.length; i++) {
    if (fn[i] === '{') depth++;
    else if (fn[i] === '}' && --depth === 0) { end = i; break; }
  }
  const body = fn.slice(at, end + 1);
  assert.ok(/const _scoring = !!compiledByVol;/.test(body), 'the flag is unpacked');
  assert.ok(/const _pool\s*=\s*compiledByVol \|\| \{\};/.test(body), 'the map is unpacked');

  const stray = body.split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))          // the rule is explained in comments
    .filter(l => /compiledByVol/.test(l))
    .map(l => l.trim())
    .filter(l => !/^function _startP23Scoring\(compiledByVol\) \{$/.test(l)
              && !/^const _scoring = !!compiledByVol;$/.test(l)
              && !/^const _pool\s*=\s*compiledByVol \|\| \{\};$/.test(l));
  deepEq(stray, [],
    'compiledByVol may only be unpacked — the body must read _scoring / _pool');
});

test('the verdict is computed once, not again in the main loop', () => {
  // The verdict IS the parse for a spec-bound message. Computing it in the
  // Parsing step and again in the loop would parse every message twice — the
  // duplication this change exists to remove.
  const fn = psFnSource('doParseMessages');
  eq((fn.match(/_parseVerdict\(/g) || []).length, 1, 'one verdict call in the dispatcher');
  assert.ok(/const _v = ci\.verdict;/.test(fn), 'and the loop reads the cached one');
});

test('the panel steps are declared in the order the work happens', () => {
  const fn = psFnSource('doParseMessages');
  const at = needle => fn.indexOf(needle);
  const detect = at("_parseProgressStep('Detecting message types')");
  const parse  = fn.indexOf("_parseProgressStep('Parsing", at("_parseProgressStep('Detecting message types')"));
  const gate   = at('const _needScore');
  assert.ok(detect > 0 && parse > detect, 'Detecting comes before Parsing');
  assert.ok(gate > parse, 'and the compile/score decision is made after Parsing');
});

console.log('\nparse-flow routing (which parser ran)');

const {
  meSpecNeedsBinding, meSpecHasNoParseSpec, meParseWithChosenBinding,
  meWinningSpec, fmtSpecByName, parseVerdict,
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

// ── The four verdicts, all four exercised ────────────────────────────────────
// v1.12.0.0 made compiling and scoring conditional on the verdict, and the only
// thing testing that condition was a regex over the source. Every piece feeding
// _parseVerdict was covered; the verdict itself was not, so "which kinds reach
// the picker" was an assumption. It is a table now.
test('verdicts: every kind is produced by the case that should produce it', () => {
  S.ddlTree = { POS: { SV: { PSTM: ROUTE_DDL } } };
  S.inputFormat = 'hex';
  const bytes = routeBytes();
  const o = { format: 'hex', rawBytes: bytes };

  // No spec matched at all — nothing to score against, no volume to search.
  eq(parseVerdict({ type: 'UNKNOWN', label: 'Unknown', vol: 'POS' }, bytes, o).kind,
     'unknown', 'UNKNOWN → unknown');
  // Recognized, but the spec declares no volume: still nothing to search.
  eq(parseVerdict({ type: 'PSTM', label: 'PSTM' }, bytes, o).kind,
     'unknown', 'no volume → unknown');
  // Recognized by a spec that carries recognizers only. There IS a DDL walk that
  // could parse this, so the diagnostic is a policy choice, not a limitation —
  // see the note on _meSpecHasNoParseSpec.
  eq(parseVerdict({ type: 'B24', label: 'Base24 Generic', vol: 'POS' }, bytes, o).kind,
     'no-spec', 'recognizers but no parse_spec → no-spec');
  // Recognized, has a parse_spec, no binding and nothing picked → the picker.
  eq(parseVerdict({ type: 'PSTM', label: 'PSTM', vol: 'POS' }, bytes, o).kind,
     'needs-ddl', 'parse_spec with no binding → needs-ddl');
  // Same spec once a DDL is picked → it parses.
  const v = parseVerdict({ type: 'PSTM', label: 'PSTM', vol: 'POS' }, bytes,
    { ...o, chosen: { ddlPath: 'POS/SV/PSTM', defName: 'PSTM' } });
  eq(v.kind, 'parsed', 'a picked DDL fills the binding → parsed');
  eq(routeSegCount(v.fields), 5, 'and the fields are the spec\'s, not a guess');
});

test('verdicts: only needs-ddl requires the compiled candidate map', () => {
  // The gate in doParseMessages compiles nothing unless some chunk came back
  // needs-ddl. That is only safe if no OTHER kind consults a score — which is
  // what this pins. I got the inverse of this wrong once already: the pool pass
  // skipped chunks with no volume, so every MATCHED message walked into a map
  // that was never built.
  S.ddlTree = { POS: { SV: { PSTM: ROUTE_DDL } } };
  S.inputFormat = 'hex';
  const bytes = routeBytes();
  const o = { format: 'hex', rawBytes: bytes };
  const kinds = [
    parseVerdict({ type: 'UNKNOWN', label: 'Unknown', vol: 'POS' }, bytes, o),
    parseVerdict({ type: 'B24', label: 'Base24 Generic', vol: 'POS' }, bytes, o),
    parseVerdict({ type: 'PSTM', label: 'PSTM', vol: 'POS' }, bytes,
      { ...o, chosen: { ddlPath: 'POS/SV/PSTM', defName: 'PSTM' } }),
  ].map(v => v.kind);
  deepEq(kinds.filter(k => k === 'needs-ddl'), [],
    'nothing but a missing binding asks for candidates');
  // And the verdict that DOES need one carries no fields — there is nothing to
  // render until the user picks.
  const nd = parseVerdict({ type: 'PSTM', label: 'PSTM', vol: 'POS' }, bytes, o);
  eq(nd.kind, 'needs-ddl', 'the one kind that scores');
  eq(nd.fields, undefined, 'and it produced no fields of its own');
});

// ── A LEN reads the way its type says, or not at all ─────────────────────────
// The Data Editor offers nine types for an override. Until v1.13.1.0 the length
// decoder honoured two of them: hex-char and the integer widths. ascii, ebcdic,
// hex-ascii-decimal and hex-ebcdic-decimal were byte-for-byte identical to
// declaring nothing — the decoder sniffed the bytes and decided for itself.
// An EBCDIC length F1 F9, which is "19" on the box, came back 61945 whichever
// of the four you picked. On a NonStop system that is not an edge case.
console.log('\nLEN decoding — every offered type means something');

const { meDecodeLength, meLengthReadAs, ME_TYPE_OPTS } = sandbox._t;
const A = s => [...s].map(c => c.charCodeAt(0));                    // ASCII text
const E = s => [...s].map(c => /[0-9]/.test(c) ? 0xF0 + (+c)        // EBCDIC text
                : { A:0xC1,B:0xC2,C:0xC3,D:0xC4,E:0xC5,F:0xC6 }[c.toUpperCase()] ?? c.charCodeAt(0));

test('each type reads the bytes its own way, and rejects bytes that disprove it', () => {
  const rows = [
    // bytes,           type,                 expected
    [A('19'),           'ascii',              19,   'ASCII digits as ASCII'],
    [A('08'),           'ascii',              8,    'leading zero kept'],
    [E('19'),           'ebcdic',             19,   'EBCDIC digits as EBCDIC'],
    [E('08'),           'ebcdic',             8,    'EBCDIC leading zero'],
    [[0x37],            'hex-char',           37,   'the hex spelling IS the number'],
    [A('00FF'),         'hex-ascii-decimal',  255,  'ASCII text of hex, base-16'],
    [E('FF'),           'hex-ebcdic-decimal', 255,  'EBCDIC text of hex, base-16'],
    [[0x00, 0x13],      'uint16-be',          19,   'plain integer'],
    [[0x00, 0x13],      'uint-be',            19,   'width comes from the field'],
    [[0x13, 0x00],      'uint16-le',          19,   'little-endian is honoured'],
    [[0x13, 0x00],      'uint-le',            19,   'and without a declared width too'],
    // …and the same bytes under a type that contradicts them
    [E('19'),           'ascii',              null, 'EBCDIC bytes are not ASCII digits'],
    [A('19'),           'ebcdic',             null, 'ASCII bytes are not EBCDIC digits'],
    [[0x00, 0x13],      'ascii',              null, 'binary bytes are not text digits'],
    [[0x00, 0x13],      'ebcdic',             null, 'nor EBCDIC ones'],
    [[0x0A],            'hex-char',           null, 'a letter nibble is not a decimal number'],
    [A('ZZ'),           'hex-ascii-decimal',  null, 'Z is not a hex digit'],
  ];
  const bad = [];
  for (const [bytes, type, want, why] of rows) {
    const got = meDecodeLength(bytes, type);
    if (got !== want) bad.push(`${type} of [${bytes.map(b=>b.toString(16).toUpperCase()).join(' ')}]`
      + ` → ${got}, expected ${want} (${why})`);
  }
  deepEq(bad, [], 'every declared type settles the reading');
});

test('the EBCDIC length that started this returns 19, not 61945', () => {
  // F1 F9 is "19" typed on a NonStop terminal. Every one of the four text types
  // used to return 61945 — the big-endian value of the raw bytes — which is the
  // shape of length that makes a field claim it runs past the end of the message.
  eq(meDecodeLength(E('19'), 'ebcdic'), 19, 'read as what it is');
  eq(meDecodeLength(E('19'), 'ascii'), null, 'and ASCII refuses it rather than inventing a number');
});

test('an undeclared LEN follows the spec\'s encoding, not the byte values', () => {
  // The rule the user asked for: with nothing declared on the field, the
  // encoding of the recognizer that SELECTED this message decides how to read
  // it. Two questions were tangled together here, and only one of them the spec
  // can answer — "text or binary?" it cannot (PIC X(2) does not say, and a
  // binary length in a character field is ordinary on Base24), but "if text,
  // ASCII or EBCDIC?" it can. So the spec's encoding is tried as text first and
  // binary remains the fallback.
  const run = (lenBytes, encoding) => meExecParseSpec({
    name: 'X', type: 'X', ddl_bindings: ['V/S/D/MSG'],
    de_map: [{ field: 'EMV', de: 2 }],
    ...(encoding ? { recognizers: [{ type: 'mti', encoding }] } : {}),
    parse_spec_binary: [
      { 'read-bitmap': { field: 'BITMAP', length: 8 } },
      { 'read-bitmap-fields': 'BITMAP' },
    ],
  }, Uint8Array.from([0x40,0,0,0,0,0,0,0, ...lenBytes,
                      0x41,0x42,0x43,0x44,0x45, 0x54,0x41,0x49,0x4C]));
  const dataLen = ctx => ctx.fields.find(f => f.id === 'EMV.DATA')?.valueLength;

  // Declared here rather than reusing VLG_DDL, which is defined further down the
  // file and is not in scope yet at this point.
  S.ddlTree = { V: { S: { D: `DEF MSG.
  02 BITMAP PIC X(8).
  02 EMV.
    04 LEN  PIC X(2).
    04 DATA PIC X(20).
  02 TAIL PIC X(4).
END MSG.
` } } };
  S.inputFormat = 'hex';
  // EBCDIC "05" — the case that was silently wrong. As EBCDIC text it is 5.
  eq(dataLen(run([0xF0, 0xF5], 'ebcdic')), 5, 'EBCDIC digits read as EBCDIC under an EBCDIC spec');
  // The same bytes under an ASCII spec are not digits, so binary wins: 0xF0F5.
  // Far past the end, so the payload is clamped — the point is only that it did
  // NOT read as 5, which is what makes the encoding matter.
  assert.notStrictEqual(dataLen(run([0xF0, 0xF5], 'ascii')), 5,
    'the same bytes under an ASCII spec are not 5 — the spec is what decided');
  // ASCII digits still work, under either.
  eq(dataLen(run([0x30, 0x35], 'ascii')), 5, 'ASCII digits under an ASCII spec');
  // And a binary length in a PIC X field keeps working with no override at all,
  // under both encodings — this is the case that must not regress.
  eq(dataLen(run([0x00, 0x05], 'ascii')),  5, 'binary length still read, ASCII spec');
  eq(dataLen(run([0x00, 0x05], 'ebcdic')), 5, 'binary length still read, EBCDIC spec');
  eq(dataLen(run([0x00, 0x05], null)),     5, 'and with no recognizer encoding at all');
});

test('a block\'s own encoding outranks the spec\'s recognizers', () => {
  // Level 2 of the chain: override > block "encoding" > recognizer > ASCII.
  // The attribute already existed and read-fixed honoured it; the LEN paths did
  // not look at it, so a block that stated its encoding was ignored when it read
  // a length. Same class of bug as the four dead types.
  const enc = e => ({ enc: e, declared: true });
  // The helper is what the call sites use; test it against both inputs.
  const ctxWith = e => ({ lenEnc: { enc: e, declared: true } });
  eq(sandbox._t.meLenEncFor({ encoding: 'ebcdic' }, ctxWith('ascii')).enc, 'ebcdic',
     'the block wins over the recognizer');
  eq(sandbox._t.meLenEncFor({ encoding: 'ascii' }, ctxWith('ebcdic')).enc, 'ascii',
     'in both directions');
  eq(sandbox._t.meLenEncFor({}, ctxWith('ebcdic')).enc, 'ebcdic',
     'with no attribute the recognizer decides');
  eq(sandbox._t.meLenEncFor({ encoding: 'bcd' }, ctxWith('ascii')).enc, 'ascii',
     'and an encoding it cannot honour is not silently treated as one it can');
  // …and it actually changes the decode.
  eq(meDecodeLength(E('19'), '', enc('ebcdic')), 19, 'EBCDIC block reads EBCDIC digits');
  // Honest about the ladder: EBCDIC is tried first and fails on ASCII bytes, but
  // the legacy ASCII-digit sniff is still below it, so "19" typed in ASCII under
  // an EBCDIC spec reads 19 rather than becoming a binary integer. Compatibility
  // wins here — the encoding decides which reading is TRIED FIRST, it does not
  // forbid the other one.
  eq(meDecodeLength(A('19'), '', enc('ebcdic')), 19,
     'ASCII digits still read as 19 under an EBCDIC spec — the ladder keeps its old floor');
});

test('an assumed encoding is reported, not silent', () => {
  // Level 4. The user asked for ASCII to remain the default but for the guess to
  // be visible. It is deliberately narrow: only when NOTHING declared an
  // encoding, the assumed one cannot read the bytes, and the other one can — so
  // the number that came out is a binary integer nobody chose.
  const sus = sandbox._t.meLenEncSuspicion;
  const undeclared = { enc: 'ascii', declared: false };
  const declared   = { enc: 'ascii', declared: true };
  // EBCDIC digits under a spec that never said so — worth reporting.
  const s = sus(E('19'), '', undeclared);
  assert.ok(s, 'the suspicion fires');
  eq(s.other, 'ebcdic', 'and names the encoding that would read them');
  eq(s.value, 19, 'with the number they would have given');
  // Silent in every other case.
  eq(sus(E('19'), '', declared), null, 'an encoding WAS declared — its answer stands');
  eq(sus(E('19'), 'uint16-be', undeclared), null, 'the field declared its own type');
  eq(sus(A('19'), '', undeclared), null, 'the assumption read them fine');
  eq(sus([0x00, 0x13], '', undeclared), null, 'an ordinary binary length is not suspicious');
});

test('the assumed-encoding warning actually reaches the LEN field', () => {
  // The test above only proves the helper computes the right answer. Removing
  // the call that USES it left all 525 passing — the exact hollow-test shape
  // that has bitten twice this week. This one runs a real parse and reads the
  // field, so the wiring is what is under test.
  S.ddlTree = { V: { S: { D: `DEF MSG.
  02 BITMAP PIC X(8).
  02 EMV.
    04 LEN  PIC X(2).
    04 DATA PIC X(20).
  02 TAIL PIC X(4).
END MSG.
` } } };
  S.inputFormat = 'hex';
  const ctx = meExecParseSpec({
    name: 'X', type: 'X', ddl_bindings: ['V/S/D/MSG'],
    de_map: [{ field: 'EMV', de: 2 }],
    // no recognizers at all → nothing declares an encoding
    parse_spec_binary: [
      { 'read-bitmap': { field: 'BITMAP', length: 8 } },
      { 'read-bitmap-fields': 'BITMAP' },
    ],
  }, Uint8Array.from([0x40,0,0,0,0,0,0,0, 0xF0,0xF5,
                      0x41,0x42,0x43,0x44,0x45, 0x54,0x41,0x49,0x4C]));
  const len = ctx.fields.find(f => f.id === 'EMV.LEN');
  assert.ok(len, 'the LEN field is emitted');
  assert.ok(/no encoding is declared/i.test(len.issue || ''),
    `the assumption is stated on the field, got: ${JSON.stringify(len.issue)}`);
  assert.ok(/EBCDIC/.test(len.issue || ''), 'and names the encoding that would read them');
  assert.ok(/recognizer/i.test(len.issue || ''), 'and where to fix it');
  // It rides ON the field — never as an extra row with the same id, which is the
  // duplicate-row bug reported before.
  eq(ctx.fields.filter(f => f.id === 'EMV.LEN').length, 1, 'exactly one LEN row');
});

test('no type at all still behaves exactly as it did', () => {
  // Stage 1 changes only what a DECLARED type does. The undeclared case is its
  // own decision (TODO 3) and must not move underneath it.
  eq(meDecodeLength(A('19')), 19, 'ASCII digits still read as digits');
  eq(meDecodeLength([0x00, 0x13]), 19, 'and anything else still reads as an integer');
  eq(meDecodeLength(E('19')), 61945, 'including EBCDIC — this is what TODO 3 is for');
});

test('every type the editor offers is handled by the decoder', () => {
  // The gap was invisible because nothing compared the two lists. A type that
  // reaches the dropdown and not the decoder is a control that does nothing.
  const unhandled = ME_TYPE_OPTS.filter(t => t).filter(t => {
    // A type is handled if it changes the answer for bytes the sniff would
    // otherwise read as digits: ASCII "19" is 19 by guess, so any type with its
    // own opinion must return something else, or refuse.
    const guess = meDecodeLength(A('19'));
    return meDecodeLength(A('19'), t) === guess && meDecodeLength(E('19'), t) === meDecodeLength(E('19'));
  });
  deepEq(unhandled, [], 'these appear in the dropdown but the decoder ignores them');
});

test('the reported reading names the branch actually taken', () => {
  // The message that explains an implausible length must not claim "digits" for
  // bytes that went through as an integer, or the explanation misleads.
  eq(meLengthReadAs(E('19'), 'ebcdic'), 'EBCDIC digits');
  eq(meLengthReadAs(A('19'), 'ascii'), 'digits');
  eq(meLengthReadAs([0x37], 'hex-char'), 'hex characters');
  eq(meLengthReadAs(A('00FF'), 'hex-ascii-decimal'), 'hex text');
  eq(meLengthReadAs([0x00,0x13], 'uint16-be'), 'a binary integer');
});

// ── The parse, end to end, with the timers actually running ──────────────────
// Everything else in this file tests a piece. This runs doParseMessages the way
// a click does — through the progress steps, the compile decision, the scoring
// gate and finalize — by draining the timer queue instead of dropping it.
// It is the test that would have caught v1.12.0.2, where a matched message
// walked into a compile map that was never built.
const asHex = bytes => bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

function runParse(msgText, { format = 'hex' } = {}) {
  resetTimers();
  const input = { value: msgText, readOnly: false, style: {}, classList:
    { add(){}, remove(){}, toggle(){}, contains(){ return false; } } };
  const prevStub = elStubs.msgInput;
  elStubs.msgInput = input;
  const S = sandbox._t.S;
  const prevFmt = S.inputFormat;
  S.inputFormat = format;
  try {
    sandbox._t.doParseMessages();
    const callbacks = pumpTimers();
    return { messages: S.messages || [], isParsed: !!S.isParsed, callbacks };
  } finally {
    if (prevStub === undefined) delete elStubs.msgInput; else elStubs.msgInput = prevStub;
    S.inputFormat = prevFmt;
  }
}

test('end to end: a spec that binds its own DDL parses without any scoring', () => {
  // The v1.12.0.2 path exactly: recognized, binding present, so nothing needs a
  // DDL and the compile pass is skipped. The bug was that the pre-scoring pass
  // ran anyway and indexed the map that was never built.
  const S = sandbox._t.S;
  S.ddlTree = { POS: { SV: { PSTM: ROUTE_DDL } } };
  const spec = fmtSpecByName('PSTM');
  const orig = spec.ddl_bindings;
  spec.ddl_bindings = ['POS/SV/PSTM/PSTM'];
  try {
    const r = runParse(asHex(routeBytes()));
    assert.ok(r.callbacks > 0, 'the timer queue actually ran — a 0 here means this tests nothing');
    eq(r.messages.length, 1, 'one message came out the far end');
    const m = r.messages[0];
    eq(m.msgType?.type, 'PSTM', 'recognized as PSTM');
    assert.ok(/parse-spec/.test(m.parsedBy || ''), `the engine produced it, not a guess: ${m.parsedBy}`);
    assert.ok((m.fields || []).length > 0, 'with fields');
    eq(routeSegCount(m.fields), 5, 'and the repeat block read exactly NUM-SERVICES services');
  } finally { spec.ddl_bindings = orig; }
});

test('end to end: an unrecognised message reaches its diagnostic instead of throwing', () => {
  // The other regression this session (v1.11.0.0): the unknown-type diagnostic
  // read detectStr and _detTrace, which had just stopped being in scope. It
  // threw ReferenceError in front of the user on the one path whose whole job is
  // explaining why nothing matched — and 497 tests passed, because no test ever
  // walked an unrecognised message through the real parse.
  const S = sandbox._t.S;
  S.ddlTree = { POS: { SV: { PSTM: ROUTE_DDL } } };
  const bytes = [];
  for (let i = 0; i < 40; i++) bytes.push(0xC7);      // matches no shipped recognizer
  const r = runParse(asHex(bytes));
  assert.ok(r.callbacks > 0, 'the timer queue ran');
  eq(r.messages.length, 1, 'the message survives as a diagnostic rather than vanishing');
  const m = r.messages[0];
  eq(m.unknownType, true, 'flagged as an unrecognised type');
  assert.ok(m._diag, 'and it carries the diagnostic the panel renders');
  // These two are the exact fields that went out of scope.
  assert.ok(typeof m._diag.decodedMTI === 'string',
    'decodedMTI is derived from the detection string that was nearly lost');
  assert.ok('closest' in m._diag, 'and the closest-spec explanation is present');
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

test('a row\'s error FLAG is not printed as the word "true"', () => {
  // Reported from a real parse: "Bit 7 — no definition in DDLtrue". `error`
  // carries a message on parse-spec rows and is a bare boolean on the bitmap
  // ones, and the renderer printed whatever it held, glued to the description.
  // renderFieldTable writes into #resContainer and returns nothing, so the
  // markup has to be captured rather than read off a return value.
  const prev = elStubs.resContainer;
  const sink = { _h: '', set innerHTML(v) { this._h = String(v); }, get innerHTML() { return this._h; },
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    style: {}, querySelector: () => null, querySelectorAll: () => [] };
  elStubs.resContainer = sink;
  const render = f => {
    sink._h = '';
    renderFieldTable({
      ...ovrMsg(true),
      fields: [{ id: 'X', name: 'X', dataType: 'PIC X(2)', offset: 0, length: 2,
                 value: 'v', rawHex: '4142', rawBytes: [0x41, 0x42],
                 description: 'Bit 7 — no definition in DDL', ...f }],
    });
    return sink.innerHTML;
  };
  try {
    const flag = render({ error: true });
    assert.ok(/Bit 7 — no definition in DDL/.test(flag), 'the description still renders');
    assert.ok(!/DDLtrue/.test(flag), 'the boolean flag leaked into the description');
    assert.ok(!/c-row-err/.test(flag), 'a flag is not a row message');
    assert.ok(/c-err/.test(flag), 'but the row is still marked as an error');
    // A real message must still print — the fix must not silence the useful case.
    const msg = render({ error: 'binding 0 could not be resolved' });
    assert.ok(/binding 0 could not be resolved/.test(msg), 'a string error still shows');
    assert.ok(/c-row-err/.test(msg), 'and it shows in the row-error style');
    // `issue` is always a message, and keeps the break that separates it.
    const iss = render({ issue: 'length ran past the message' });
    assert.ok(/<br><span class="c-row-err">length ran past the message/.test(iss),
      'an issue still renders under the description');
    // Flag plus issue: the issue is the text, the flag stays invisible.
    const both = render({ error: true, issue: 'real problem' });
    assert.ok(/real problem/.test(both) && !/true<\/span>/.test(both),
      'a flag alongside a real issue shows the issue, not the flag');
  } finally {
    if (prev === undefined) delete elStubs.resContainer; else elStubs.resContainer = prev;
  }
});

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
  // Pinned to the token, not the literal it used to hold. The point of this
  // test is that all five carry the SAME colour; --redef-fg is that colour, and
  // it now differs per theme (light needs a stronger alpha to stay legible),
  // which a hardcoded rgba could not express.
  for (const sel of ['.c-ovr-orig', '.c-ovr-arrow', '.c-ovr-as', '.c-redef-mark', '.ddl-doc-redef-note']) {
    assert.ok(/color:\s*var\(--redef-fg\)/.test(cssRule(sel)),
      `${sel} must use var(--redef-fg), got: ${cssRule(sel).trim().slice(0, 70)}`);
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

// ── greater-than / less-than: strict, and named for what they do ─────────────
// Reported after two TDE forms sharing one literal both matched a 470-byte
// payload: `max-length 900` passed it, because 940 pasted HEX characters are 470
// bytes and 470 <= 900. The rule was right and the name was vague — "max-length"
// says nothing about the comparison or the unit.

console.log('\nrecognizers — greater-than / less-than are strict');

test('the comparison is STRICT, unlike the pair it replaces', () => {
  const b = Buffer.from('ABCDEFGHIJ');            // 10 bytes
  const pass = n => fmtTestSpecs([{ name: 'X', recognizers: [n] }], b)[0].passed;
  eq(pass({ type: 'greater-than', value: 9 }),  true,  '10 > 9');
  eq(pass({ type: 'greater-than', value: 10 }), false, '10 > 10 is false — strict');
  eq(pass({ type: 'less-than',    value: 11 }), true,  '10 < 11');
  eq(pass({ type: 'less-than',    value: 10 }), false, '10 < 10 is false — strict');
  // The boundary is the whole point of the rename: the legacy pair includes it.
  eq(pass({ type: 'min-length', value: 10 }), true,  'legacy ≥ includes 10');
  eq(pass({ type: 'max-length', value: 10 }), true,  'legacy ≤ includes 10');
});

test('`length` is accepted as well as `value`', () => {
  const b = Buffer.from('ABCDEFGHIJ');
  const pass = n => fmtTestSpecs([{ name: 'X', recognizers: [n] }], b)[0].passed;
  eq(pass({ type: 'greater-than', length: 9 }),  true,  'greater-than honours length');
  eq(pass({ type: 'less-than',    length: 11 }), true,  'less-than honours length');
});

test('migration shifts the value so the SAME inputs still match', () => {
  // A spec written before the rename must not change which messages it accepts.
  // min-length 23 (>= 23) is exactly greater-than 22 (> 22).
  const spec = { name: 'X', recognizers: [
    { type: 'min-length', value: 23 },
    { type: 'max-length', length: 900 },
  ] };
  migrateSpec(spec);
  eq(spec.recognizers[0].type,  'greater-than', 'min-length becomes greater-than');
  eq(spec.recognizers[0].value, 22,             'and 23 becomes 22 — the same test');
  eq(spec.recognizers[1].type,  'less-than',    'max-length becomes less-than');
  eq(spec.recognizers[1].value, 901,            'and 900 becomes 901 — the same test');
  eq(spec.recognizers[1].length, undefined,     'the old attribute is cleared');

  // Proven by behaviour at the boundary, not just by the numbers.
  const at = (n, r) => fmtTestSpecs([{ name: 'X', recognizers: [r] }],
                                    Buffer.alloc(n, 0x41))[0].passed;
  eq(at(23, { type: 'min-length', value: 23 }), at(23, spec.recognizers[0]),
     'a 23-byte message is judged identically before and after migration');
  eq(at(22, { type: 'min-length', value: 23 }), at(22, spec.recognizers[0]),
     'and so is a 22-byte one');
  eq(at(900, { type: 'max-length', length: 900 }), at(900, spec.recognizers[1]),
     'a 900-byte message is judged identically');
});

test('the shipped recognizers moved with their values', () => {
  // The five in-app specs used min-length 23 / 873. If the id changed without the
  // value, every one of them would have started rejecting messages exactly at its
  // boundary — silently, because a recognizer only returns a boolean.
  assert.ok(!/type:'min-length'/.test(APP_SRC) && !/type:'max-length'/.test(APP_SRC),
    'no shipped spec still uses the legacy ids');
  const shipped = [...APP_SRC.matchAll(/type:'greater-than',value:(\d+)/g)].map(m => +m[1]);
  assert.deepStrictEqual(shipped.sort((a, b) => a - b), [22, 22, 22, 872, 872],
    `values shifted by one, got: ${shipped}`);
});

test('two forms sharing a literal can be made mutually exclusive', () => {
  // The reported situation: same literal, different sizes, order deciding the
  // winner. With a strict pair either side of the boundary, order cannot matter.
  const lit = { type: 'literal', offset: 0, encoding: 'ascii', value: 'TDE' };
  const short = { name: 'SHORT', recognizers: [lit, { type: 'less-than', value: 471 }] };
  const long  = { name: 'LONG',  recognizers: [lit, { type: 'greater-than', value: 470 }] };
  const body = n => { const b = Buffer.alloc(n, 0x41); b.write('TDE', 0); return b; };
  const won = (n, order) => {
    const w = fmtTestSpecs(order, body(n)).find(r => r.passed);
    return w ? w.spec.name : null;
  };
  eq(won(470, [long, short]), 'SHORT', '470 bytes is the short form');
  eq(won(470, [short, long]), 'SHORT', 'whatever the order');
  eq(won(600, [long, short]), 'LONG',  '600 bytes is the long form');
  eq(won(600, [short, long]), 'LONG',  'whatever the order');
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

// ── read-tlv "len": a TLV buffer that carries its own length ────────────────
// Reported from production. The DDL declares the buffer as a GROUP —
//   FIELD-55 { LEN-55, DATA-55 { ARQC{TAG,LEN,VALUE}, ATC{…} } }
// — and read-tlv's `field` could only name a LEAF, because fieldsById holds
// leaves only. Every attempt got "Buffer field 'FIELD-55' not yet read", the
// LEN row never appeared, and the field after DE-55 landed at the DDL's declared
// offset instead of after the length the message actually states.
console.log('\nread-tlv — a buffer that carries its own length');

const TLV_LEN_DDL = `DEF MSG.
  02 MTI PIC X(4).
  02 FIELD-55.
    04 LEN-55 PIC X(2).
    04 DATA-55.
      06 ARQC.
        08 TAG   PIC X(2).
        08 LEN   PIC X(1).
        08 VALUE PIC X(8).
      06 ATC.
        08 TAG   PIC X(2).
        08 LEN   PIC X(1).
        08 VALUE PIC X(2).
  02 AFTER PIC X(4).
END MSG.
`;
// 22 bytes of BER triples: 9F26/8 and 9F36/2 are mapped, 9F10/3 is not.
const TLV_PAYLOAD = [0x9F,0x26,0x08, 1,2,3,4,5,6,7,8,
                     0x9F,0x36,0x02, 0x00,0x01,
                     0x9F,0x10,0x03, 0xAA,0xBB,0xCC];
const TLV_BYTES = [0x30,0x32,0x30,0x30, 0x00, TLV_PAYLOAD.length, ...TLV_PAYLOAD,
                   0x54,0x41,0x49,0x4C];
const TLV_TAGS = { '9F26': { field: 'FIELD-55.DATA-55.ARQC' },
                   '9F36': { field: 'FIELD-55.DATA-55.ATC' } };
function tlvLenRun(len, unknown = 'skip', extra) {
  S.ddlTree = { V: { S: { D: TLV_LEN_DDL } } };
  S.inputFormat = 'hex';
  return meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'], ...(extra || {}),
    parse_spec_binary: [
      { 'read-ddl': { until: 'MTI' } },
      { 'read-tlv': { field: 'FIELD-55', len, ber: true, tags: TLV_TAGS, unknown } },
      { 'read-fixed': { length: 4, as: 'AFTER' } },
    ] }, Uint8Array.from(TLV_BYTES));
}
const tlvF = (ctx, id) => ctx.fields.find(f => f.id === id && !f.error);

test('read-tlv "len" reads a GROUP buffer, which `field` alone cannot', () => {
  const ctx = tlvLenRun('FIELD-55.LEN-55');
  eq(ctx.fields.filter(f => typeof f.error === 'string').length, 0,
     `no errors, got: ${ctx.fields.filter(f => f.error).map(f => f.error).join(' | ')}`);
  // The length row is emitted — its absence was the original complaint, and a
  // consumed-but-unshown length leaves a hole in the byte coverage.
  const len = tlvF(ctx, 'FIELD-55.LEN-55');
  assert.ok(len, 'the LEN element is emitted');
  eq(len.startByte, 4, 'at its own bytes');
  eq(len.rawHex.toUpperCase(), '0016', 'holding the 22 it states');
});

test('the mapped tags fill their fully-qualified DDL elements', () => {
  const ctx = tlvLenRun('FIELD-55.LEN-55');
  eq(tlvF(ctx, 'FIELD-55.DATA-55.ARQC.TAG').rawHex.toUpperCase(), '9F26', 'ARQC tag');
  eq(tlvF(ctx, 'FIELD-55.DATA-55.ARQC.LEN').rawHex.toUpperCase(), '08', 'ARQC length');
  eq(tlvF(ctx, 'FIELD-55.DATA-55.ARQC.VALUE').rawHex.toUpperCase(), '0102030405060708', 'ARQC value');
  eq(tlvF(ctx, 'FIELD-55.DATA-55.ATC.VALUE').rawHex.toUpperCase(), '0001', 'ATC value');
});

test('the field AFTER the buffer starts where the LENGTH says, not where the DDL does', () => {
  // The whole point. The DDL declares DATA-55 as 16 bytes; the message says 22.
  // Before this, AFTER read from the declared offset 22 and got the tail of the
  // last TLV triple.
  const ctx = tlvLenRun('FIELD-55.LEN-55');
  const after = tlvF(ctx, 'AFTER');
  eq(after.startByte, 28, 'four bytes past the 22 the length states');
  eq(after.rawHex.toUpperCase(), '5441494C', 'which is "TAIL", not TLV leftovers');
  eq(ctx.cursor, 32, 'and the cursor crossed the length AND the tags');
});

test('"len" takes a byte count as well as a field name', () => {
  const byName = tlvLenRun('FIELD-55.LEN-55');
  const byNum  = tlvLenRun(2);
  eq(tlvF(byNum, 'AFTER').startByte, tlvF(byName, 'AFTER').startByte,
     'both forms frame the buffer identically');
  // With no element to fill, the numeric form emits a synthetic row so the byte
  // coverage still has no hole.
  const syn = byNum.fields.find(f => f.id === 'FIELD-55.LEN');
  assert.ok(syn, 'the numeric form emits the length it used');
  eq(syn.rawHex.toUpperCase(), '0016', 'carrying the bytes it read');
});

test('unknown tags obey `unknown`, and the walk is bounded by the length', () => {
  const skipped = tlvLenRun('FIELD-55.LEN-55', 'skip');
  assert.ok(!skipped.fields.some(f => /9F10/.test(f.id)), 'skip: the unmapped tag is consumed silently');
  const emitted = tlvLenRun('FIELD-55.LEN-55', 'emit');
  const inv = emitted.fields.find(f => /9F10/.test(f.id));
  assert.ok(inv, 'emit: it appears as an invented row');
  eq(inv.rawHex.toUpperCase(), 'AABBCC', 'with its value');
  // Either way the field after is unaffected — the length framed the buffer.
  eq(tlvF(emitted, 'AFTER').startByte, 28, 'and AFTER is unmoved by the choice');
});

test('a bad "len" is reported, not guessed around', () => {
  // A mis-framed TLV buffer produces confident nonsense, so a length that cannot
  // be resolved has to stop rather than fall back to something plausible.
  const missing = tlvLenRun('NO-SUCH-FIELD');
  assert.ok(missing.fields.some(f => /not found in the DDL/.test(f.error || '')),
    'an unknown element is named');
  const group = tlvLenRun('FIELD-55.DATA-55');
  assert.ok(group.fields.some(f => /is a group/.test(f.error || '')),
    'a group is rejected — name the leaf that holds the length');
});

test('read-tlv without "len" still parses in place, cursor untouched', () => {
  // The existing contract: `field` names a buffer an earlier block already read,
  // and re-reading it must not move the cursor past bytes already crossed.
  S.ddlTree = { V: { S: { D: TLV_LEN_DDL } } };
  S.inputFormat = 'hex';
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    parse_spec_binary: [
      { 'read-fixed': { length: 4, as: 'MTI' } },
      { 'read-fixed': { length: 2, as: 'L' } },
      { 'read-fixed': { length: 22, as: 'BUF' } },
      { 'read-tlv': { field: 'BUF', ber: true, tags: TLV_TAGS, unknown: 'skip' } },
      { 'read-fixed': { length: 4, as: 'AFTER' } },
    ] }, Uint8Array.from(TLV_BYTES));
  eq(tlvF(ctx, 'AFTER').startByte, 28, 'the cursor was already past BUF, and read-tlv left it there');
  eq(tlvF(ctx, 'FIELD-55.DATA-55.ARQC.VALUE').rawHex.toUpperCase(), '0102030405060708',
     'and the tags still filed correctly');
});

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

// ── read-tlv — every optional parameter, crossed, with expected output ───────
// Existing tests above pin individual incidents. This matrix is the other half:
// encoding × framing × tags × unknown × leaf names × len form, each case stating
// the fields that must come out. A combination that only "runs" is not coverage.
// ── A numeric reference states how it is read ──────────────────────────────
// TODO item 3. repeat.count, read-while.max and read-fixed.length resolved a
// field to a number by trying decimal first and hex second — so the same bytes
// decoded differently depending on what they happened to look like. That is what
// truncated the PSTM services loop: a TYPE BINARY 16 counter is absent from an
// ASCII capture, and the occupying bytes rendered as plausible digits.
// ── `when` can guard on the bytes at the cursor ────────────────────────────
// TODO item 4. The legacy PSTM parser protects the user-data read with
// bytes[cursor] !== 0x26 — an eye-catcher check the spec language could not
// express. Without it a branch consumes "& " as a 2-byte length (0x2620 = 9760)
// and runs the cursor thousands of bytes past the end.
// ── token-area ─────────────────────────────────────────────────────────────
// The weakest block: covered only by help examples and baseline combos, with no
// test asserting what it actually picks out. It fills ctx.tokens (never
// ctx.fields), so an empty result looks exactly like a block that did nothing.
console.log('\ntoken-area — cherry-picking the token area');

// Binary (STM/PSTM) token area:
//   "& " | count(2,BE) = tokens+1 | size(2,BE) incl. the "& " | then per token:
//   "! " | id(2 ASCII) | size(2,BE) | data
const TOK_AREA = [
  0x26, 0x20, 0x00, 0x04, 0x00, 0x20,             // & , count 4 (=3 tokens), size 32
  0x21, 0x20, 0x41, 0x41, 0x00, 0x03, 0x31, 0x31, 0x31,   // ! AA len 3 "111"
  0x21, 0x20, 0x42, 0x42, 0x00, 0x02, 0x32, 0x32,         // ! BB len 2 "22"
  0x21, 0x20, 0x43, 0x43, 0x00, 0x04, 0x33, 0x33, 0x33, 0x33, // ! CC len 4 "3333"
];
const TOK_DDL = 'DEF R.\n  02 HDR PIC X(4).\nEND R.\n';
function tokRun(spec, { area = TOK_AREA, type = 'STM' } = {}) {
  S.ddlTree = { V: { S: { D: TOK_DDL } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([0x48, 0x44, 0x52, 0x21, ...area]);
  const ctx = meExecParseSpec({ name: 'X', type, ddl_bindings: ['V/S/D/R'],
    parse_spec_binary: spec }, bytes);
  return { ctx, tokens: (ctx.tokens || []).map(t => t.id),
           fieldIds: ctx.fields.map(f => f.id) };
}
const TOK_SPEC = extra => [{ 'read-ddl': 'ANY' }, extra];

test('ANY picks up every token in the area', () => {
  const r = tokRun(TOK_SPEC('token-area'));
  deepEq(r.tokens, ['AA', 'BB', 'CC'], 'all three, in wire order');
});

test('token-area fills ctx.tokens and never ctx.fields', () => {
  // The reason an empty result is invisible: it contributes no rows at all.
  const r = tokRun(TOK_SPEC('token-area'));
  assert.ok(r.tokens.length > 0, 'tokens were produced');
  assert.ok(!r.fieldIds.some(id => ['AA', 'BB', 'CC'].includes(id)),
    `no token became a field row, got: ${JSON.stringify(r.fieldIds)}`);
});

test('a list cherry-picks by id, and ignores order and unknown ids', () => {
  const r = tokRun(TOK_SPEC({ 'token-area': { tokens: ['CC', 'AA'] } }));
  deepEq(r.tokens, ['AA', 'CC'], 'wire order is kept, not the order asked for');
  const miss = tokRun(TOK_SPEC({ 'token-area': { tokens: ['ZZ'] } }));
  deepEq(miss.tokens, [], 'an id that is not there yields nothing, not an error');
});

test('from / until is an inclusive window over the tokens', () => {
  deepEq(tokRun(TOK_SPEC({ 'token-area': { from: 'BB' } })).tokens, ['BB', 'CC'], 'from is inclusive');
  deepEq(tokRun(TOK_SPEC({ 'token-area': { until: 'BB' } })).tokens, ['AA', 'BB'], 'until is inclusive');
  deepEq(tokRun(TOK_SPEC({ 'token-area': { from: 'BB', until: 'BB' } })).tokens, ['BB'], 'both, one token wide');
  deepEq(tokRun(TOK_SPEC({ 'token-area': { from: 'ZZ' } })).tokens, [],
    'a start that never appears yields nothing');
});

test('no eye-catcher means no token area, and no error', () => {
  // "& " is what says the area is there at all. Without it the block is a no-op,
  // which is correct — but it is also indistinguishable from a broken one.
  const noEye = TOK_AREA.slice(); noEye[0] = 0x41;
  const r = tokRun(TOK_SPEC('token-area'), { area: noEye });
  deepEq(r.tokens, [], 'nothing extracted');
  eq(r.ctx.fields.filter(f => typeof f.error === 'string').length, 0, 'and nothing reported');
});

test('the message type decides where the area is looked for', () => {
  // STM/PSTM: straight after the last field. An unrelated type has no rule, so
  // the same bytes yield nothing.
  deepEq(tokRun(TOK_SPEC('token-area'), { type: 'STM' }).tokens, ['AA', 'BB', 'CC'], 'STM finds it');
  deepEq(tokRun(TOK_SPEC('token-area'), { type: 'NDC' }).tokens, [], 'an unrelated type does not');
});

test('the token carries its data, not just its id', () => {
  const r = tokRun(TOK_SPEC('token-area'));
  const aa = (r.ctx.tokens || []).find(t => t.id === 'AA');
  assert.ok(aa, 'AA is present');
  eq(Array.from(aa.rawBytes || []).map(b => String.fromCharCode(b)).join(''), '111',
     'with the three bytes its size declares');
});

console.log('\nwhen — byte guards at the cursor');

function whenRun(spec, bytes) {
  S.ddlTree = { V: { S: { D: 'DEF R.\n  02 X PIC X(1).\nEND R.\n' } } };
  S.inputFormat = 'hex';
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    parse_spec_binary: spec }, Uint8Array.from(bytes));
  return { ctx, ids: ctx.fields.map(f => f.id), cursor: ctx.cursor,
           errs: ctx.fields.filter(f => typeof f.error === 'string').map(f => f.error) };
}
// "HDR" then the eye-catcher "& " then some tokens.
const EYE    = [0x48,0x44,0x52, 0x26,0x20, 0x54,0x4F,0x4B];
// "HDR" then an ASCII length "04" then four bytes of user data.
const NO_EYE = [0x48,0x44,0x52, 0x30,0x34, 0x41,0x42,0x43,0x44];

test('not-bytes refuses the branch when the eye-catcher is sitting there', () => {
  // The whole point: this is the read that used to consume "& " as a length.
  const spec = [
    { 'read-fixed': { length: 3, as: 'HDR' } },
    { when: { 'not-bytes': { type: 'literal', value: '& ' },
              then: [{ 'read-fixed': { length: 2, as: 'USER-LEN' } }] } },
  ];
  const guarded = whenRun(spec, EYE);
  assert.ok(!guarded.ids.includes('USER-LEN'), 'the branch did not run');
  eq(guarded.cursor, 3, 'and the cursor did not move past the header');
  const clear = whenRun(spec, NO_EYE);
  assert.ok(clear.ids.includes('USER-LEN'), 'with no eye-catcher the branch runs');
  eq(clear.cursor, 5, 'and consumes the length');
});

test('the guard is what stops the overrun — without it the read runs away', () => {
  // Discriminating half. "& " read as a 2-byte ASCII length is not a number, so
  // the damage shows as the cursor moving into the token area at all.
  const unguarded = whenRun([
    { 'read-fixed': { length: 3, as: 'HDR' } },
    { 'read-fixed': { length: 2, as: 'USER-LEN' } },
  ], EYE);
  eq(unguarded.cursor, 5, 'unguarded, the eye-catcher is consumed as a length');
  const guarded = whenRun([
    { 'read-fixed': { length: 3, as: 'HDR' } },
    { when: { 'not-bytes': { type: 'literal', value: '& ' },
              then: [{ 'read-fixed': { length: 2, as: 'USER-LEN' } }] } },
  ], EYE);
  eq(guarded.cursor, 3, 'guarded, those two bytes are left for the token area');
});

test('bytes runs the branch when the guard DOES match', () => {
  const r = whenRun([
    { 'read-fixed': { length: 3, as: 'HDR' } },
    { when: { bytes: { type: 'literal', value: '& ' },
              then: [{ 'read-to-end': { as: 'TOKENS' } }] } },
  ], EYE);
  assert.ok(r.ids.includes('TOKENS'), 'the token area was read');
  eq(r.cursor, EYE.length, 'to the end');
});

test('the guard needs nothing to have been read — no field required', () => {
  const r = whenRun([
    { when: { bytes: { type: 'literal', value: 'HDR' },
              then: [{ 'read-fixed': { length: 3, as: 'H' } }] } },
  ], EYE);
  deepEq(r.errs, [], 'no "missing field" error');
  assert.ok(r.ids.includes('H'), 'and the branch ran on the very first byte');
});

test('every guard predicate read-while has, when has too', () => {
  // One predicate shape, not two — a spec must not have to learn which block
  // supports which type.
  const cases = [
    [{ type: 'literal', value: 'HDR' },            true],
    [{ type: 'literal', value: 'XXX' },            false],
    [{ type: 'alphabetic', length: 3 },            true],
    [{ type: 'numeric', length: 3 },               false],
    [{ type: 'alphanumeric', length: 3 },          true],
    [{ type: 'ascii', length: 3 },                 true],
    [{ type: 'regex', pattern: '^HD', length: 3 }, true],
    [{ type: 'regex', pattern: '^ZZ', length: 3 }, false],
  ];
  for (const [g, want] of cases) {
    const r = whenRun([{ when: { bytes: g, then: [{ 'read-fixed': { length: 1, as: 'HIT' } }] } }], EYE);
    eq(r.ids.includes('HIT'), want, `${JSON.stringify(g)} should ${want ? '' : 'not '}match`);
  }
});

test('a malformed guard is reported, not silently never-matching', () => {
  const bad = whenRun([{ when: { bytes: 'literal', then: [{ skip: 1 }] } }], EYE);
  assert.ok(bad.errs.some(e => /must be an object/.test(e)), `got: ${JSON.stringify(bad.errs)}`);
  // And the lint catches the shapes that would run but never match.
  const warns = mePsLintWarns({}, [{ when: { bytes: { type: 'nonsense' }, then: [] } }]);
  assert.ok(warns.some(w => /never match/.test(w)), `lint should flag it, got: ${JSON.stringify(warns)}`);
});

test('is/not still work, and a byte guard wins over a field', () => {
  const r = whenRun([
    { 'read-fixed': { length: 3, as: 'HDR' } },
    { when: { field: 'HDR', is: 'HDR', then: [{ 'read-fixed': { length: 2, as: 'A' } }] } },
  ], NO_EYE);
  assert.ok(r.ids.includes('A'), 'the original form is untouched');
  const warns = mePsLintWarns({}, [{ 'read-fixed': { length: 3, as: 'HDR' } },
    { when: { field: 'HDR', bytes: { type: 'ascii', length: 1 }, then: [] } }]);
  assert.ok(warns.some(w => /byte guard wins/.test(w)), `both given → lint says which, got: ${JSON.stringify(warns)}`);
});

console.log('\nnumeric references declare their encoding');

const NUMREF_DDL = `DEF R.
  02 CNT PIC X(2).
  02 A PIC X(2).
  02 B PIC X(2).
  02 C PIC X(2).
  02 D PIC X(2).
END R.
`;
function numRefRun(spec, cntBytes) {
  S.ddlTree = { V: { S: { D: NUMREF_DDL } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([...cntBytes, ...Array.from({ length: 8 }, () => 0x41)]);
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    parse_spec_binary: spec }, bytes);
  return { ctx, ids: ctx.fields.map(f => f.id),
           issues: ctx.fields.filter(f => f.issue).map(f => f.issue),
           errs: ctx.fields.filter(f => typeof f.error === 'string').map(f => f.error) };
}

test('the bytes that bit PSTM: 0x31 0x32 is 12594 as a number, 12 as text', () => {
  // A BINARY 16 counter holding 0x3132 IS 12594. Read as ASCII digits the same
  // bytes say 12. The guess picked one of them by how they happened to look.
  // Both overrun this short message, so the DISCRIMINATOR is the number each
  // reading reports — that is what differs, and what used to be decided by luck.
  const num = numRefRun([
    { read: 'CNT' },
    { repeat: { count: { field: 'CNT', as: 'uint16-be' }, body: [{ skip: 1 }] } },
  ], [0x31, 0x32]);
  const txt = numRefRun([
    { read: 'CNT' },
    { repeat: { count: { field: 'CNT', as: 'ascii' }, body: [{ skip: 1 }] } },
  ], [0x31, 0x32]);
  assert.ok(num.errs.some(e => /says 12594/.test(e)),
    `uint16-be reads 12594, got: ${JSON.stringify(num.errs)}`);
  assert.ok(!txt.errs.some(e => /says 12594/.test(e)),
    `ascii must NOT read 12594, got: ${JSON.stringify(txt.errs)}`);
});

test('an undeclared reference still works, but says it guessed', () => {
  // Not an error: existing specs rely on the fallback. It just stops being silent.
  const r = numRefRun([
    { read: 'CNT' },
    { repeat: { count: 'CNT', body: [{ 'read-fixed': { length: 1, as: 'X' } }] } },
  ], [0x30, 0x32]);
  eq(r.errs.length, 0, 'no error — the guess still resolves');
  assert.ok(r.issues.some(i => /nothing declares how to read it as a number/.test(i)),
    `it reports the assumption, got: ${JSON.stringify(r.issues)}`);
  assert.ok(r.issues.some(i => /"as": "uint16-be"/.test(i)), 'and names the fix');
});

test('the note rides ON the field, never as a second row', () => {
  // Two rows under one id is the duplicate the group path was fixed for.
  const r = numRefRun([
    { read: 'CNT' },
    { repeat: { count: 'CNT', body: [{ 'read-fixed': { length: 1, as: 'X' } }] } },
  ], [0x30, 0x32]);
  eq(r.ids.filter(i => i === 'CNT').length, 1, 'one CNT row');
});

test('a field type override declares it, with no change to the spec', () => {
  const r = numRefRun([
    { read: 'CNT' },
    { repeat: { count: 'CNT', body: [{ 'read-fixed': { length: 1, as: 'X' } }] } },
  ], [0x00, 0x02]);
  const withOvr = (() => {
    S.ddlTree = { V: { S: { D: NUMREF_DDL } } };
    S.inputFormat = 'hex';
    const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
      overrides: { CNT: { type: 'uint-be' } },
      parse_spec_binary: [
        { read: 'CNT' },
        { repeat: { count: 'CNT', body: [{ 'read-fixed': { length: 1, as: 'X' } }] } },
      ] }, Uint8Array.from([0x00, 0x02, ...Array.from({ length: 8 }, () => 0x41)]));
    return ctx.fields.filter(f => f.issue).map(f => f.issue);
  })();
  assert.ok(r.issues.some(i => /nothing declares/.test(i)), 'undeclared warns');
  assert.ok(!withOvr.some(i => /nothing declares/.test(i)),
    `a type override counts as declaring it, got: ${JSON.stringify(withOvr)}`);
});

test('all three reference sites take the declared form', () => {
  // repeat.count, read-while.max and read-fixed.length share one resolver, so a
  // spec cannot have to remember which of them learned the new syntax.
  for (const spec of [
    [{ read: 'CNT' }, { repeat: { count: { field: 'CNT', as: 'uint16-be' }, body: [{ skip: 1 }] } }],
    [{ read: 'CNT' }, { 'read-fixed': { length: { field: 'CNT', as: 'uint16-be' }, as: 'P' } }],
    [{ read: 'CNT' }, { 'read-while': { max: { field: 'CNT', as: 'uint16-be' },
                        while: { equals: 'ZZ' }, body: [{ skip: 1 }] } }],
  ]) {
    // 0x0002 — a small count under every reading, so nothing overruns and the
    // only thing under test is that the declared form is accepted at all.
    const r = numRefRun(spec, [0x00, 0x02]);
    deepEq(r.errs, [], `the declared form is accepted, got: ${JSON.stringify(r.errs)}`);
    assert.ok(!r.issues.some(i => /nothing declares/.test(i)),
      `and does not warn: ${JSON.stringify(r.issues)}`);
  }
});

test('the shipped PSTM spec declares its counter', () => {
  // The one place this is known to have caused a real mis-parse.
  const pstm = fmtDefaultSpecs().find(s => /PSTM/.test(s.label || s.name));
  const json = JSON.stringify(pstm.parse_spec_binary || []);
  assert.ok(/"count":\{"field":"NUM-SERVICES","as":"uint16-be"\}/.test(json),
    `NUM-SERVICES is TYPE BINARY 16 and must say so, got: ${json}`);
});

console.log('\nread-tlv — optional-parameter matrix');

const TLV_MX_DDL = `DEF REC.
  02 BUF PIC X(64).
  02 F55.
    04 F55-LEN PIC X(2).
    04 F55-DATA PIC X(32).
  02 STD.
    04 TAG  PIC X(4).
    04 LEN  PIC X(2).
    04 DATA PIC X(16).
  02 CUSTOM.
    04 T PIC X(4).
    04 L PIC X(2).
    04 V PIC X(16).
  02 ARQC.
    04 LEN  PIC X(2).
    04 DATA PIC X(16).
  02 TAIL PIC X(4).
END REC.
`;
// Two triples, three encodings of the same logical content:
//   binary / BER : 9F26/4 → 11223344 , 9F36/2 → 0001
//   ascii-hex    : those bytes written as hex characters
//   ascii        : "0002"/"0005"/"HELLO" , "0003"/"0004"/"VISA"
const TLV_BIN = [0x9F,0x26,0x04,0x11,0x22,0x33,0x44, 0x9F,0x36,0x02,0x00,0x01];
const TLV_HEX = [...'9F2604112233449F36020001'].map(c => c.charCodeAt(0));
const TLV_ASC = [...'00020005HELLO00030004VISA'].map(c => c.charCodeAt(0));
const TLV_LEN = [0x00, TLV_BIN.length, ...TLV_BIN, 0x54,0x41,0x49,0x4C]; // "TAIL"

function tlvMx(attrs, bytes, spec) {
  S.ddlTree = { V: { S: { D: TLV_MX_DDL } } };
  S.inputFormat = 'hex';
  return meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/REC'],
    parse_spec_binary: spec || [
      { 'read-fixed': { length: bytes.length, as: 'BUF' } },
      { 'read-tlv': attrs },
    ] }, Uint8Array.from(bytes));
}
const tlvHex = (ctx, id) => {
  const f = ctx.fields.find(x => x.id === id && !x.error);
  return f ? (f.rawHex || '').toUpperCase() : undefined;
};
const tlvVal = (ctx, id) => {
  const f = ctx.fields.find(x => x.id === id && !x.error);
  return f ? f.value : undefined;
};
const tlvIds = ctx => ctx.fields.filter(f => f.id !== 'BUF').map(f => f.id);
const tlvErr = ctx => ctx.fields.filter(f => f.error).map(f => f.error);

// Framing × encoding — unmapped (no tags): every triple is <buffer>.<tag>
const TLV_UNMAPPED = [
  { name: 'binary (default encoding)',
    attrs: { field: 'BUF', tag_length: 2, length_length: 1 },
    bytes: TLV_BIN, a: 'BUF.9F26', aHex: '11223344', b: 'BUF.9F36', bHex: '0001',
    aAt: 3, pos: true },
  { name: 'binary (encoding stated)',
    attrs: { field: 'BUF', tag_length: 2, length_length: 1, encoding: 'binary' },
    bytes: TLV_BIN, a: 'BUF.9F26', aHex: '11223344', b: 'BUF.9F36', bHex: '0001',
    aAt: 3, pos: true },
  { name: 'ber',
    attrs: { field: 'BUF', ber: true },
    bytes: TLV_BIN, a: 'BUF.9F26', aHex: '11223344', b: 'BUF.9F36', bHex: '0001',
    aAt: 3, pos: true },
  { name: 'ascii-hex',
    attrs: { field: 'BUF', tag_length: 2, length_length: 1, encoding: 'ascii-hex' },
    bytes: TLV_HEX, a: 'BUF.9F26', aHex: '11223344', b: 'BUF.9F36', bHex: '0001',
    pos: false },
  { name: 'ascii',
    attrs: { field: 'BUF', tag_length: 4, length_length: 4, encoding: 'ascii' },
    bytes: TLV_ASC, a: 'BUF.0002', aHex: '48454C4C4F', b: 'BUF.0003', bHex: '56495341',
    aAt: 8, pos: true, aVal: 'HELLO', bVal: 'VISA' },
];
for (const c of TLV_UNMAPPED) {
  test(`unmapped ${c.name}: two triples, values and positions`, () => {
    const ctx = tlvMx(c.attrs, c.bytes);
    eq(tlvHex(ctx, c.a), c.aHex, `${c.a} value`);
    eq(tlvHex(ctx, c.b), c.bHex, `${c.b} value`);
    if (c.aVal) eq(tlvVal(ctx, c.a), c.aVal, `${c.a} text`);
    if (c.bVal) eq(tlvVal(ctx, c.b), c.bVal, `${c.b} text`);
    const fa = ctx.fields.find(f => f.id === c.a);
    if (c.pos) eq(fa.startByte, c.aAt, `${c.a} starts at the value bytes`);
    else assert.ok(fa.startByte == null, 'ascii-hex has no 1:1 byte position');
    eq(ctx.fields.some(f => f.error), false, 'clean parse');
  });
}

// tags × unknown, for each encoding. First tag mapped, second is the unknown.
const TLV_MAPPED = [
  { name: 'binary',
    attrs: { field: 'BUF', tag_length: 2, length_length: 1, encoding: 'binary',
             tags: { '9F26': { field: 'ARQC' } } },
    bytes: TLV_BIN, mapped: 'ARQC.DATA', mappedHex: '11223344',
    lenId: 'ARQC.LEN', lenHex: '04',
    unmapped: 'BUF.9F36', unmappedHex: '0001' },
  { name: 'ber',
    attrs: { field: 'BUF', ber: true, tags: { '9F26': { field: 'ARQC' } } },
    bytes: TLV_BIN, mapped: 'ARQC.DATA', mappedHex: '11223344',
    lenId: 'ARQC.LEN', lenHex: '04',
    unmapped: 'BUF.9F36', unmappedHex: '0001' },
  { name: 'ascii-hex',
    attrs: { field: 'BUF', tag_length: 2, length_length: 1, encoding: 'ascii-hex',
             tags: { '9F26': { field: 'ARQC' } } },
    bytes: TLV_HEX, mapped: 'ARQC.DATA', mappedHex: '11223344',
    lenId: 'ARQC.LEN', lenHex: '04',
    unmapped: 'BUF.9F36', unmappedHex: '0001' },
  { name: 'ascii',
    attrs: { field: 'BUF', tag_length: 4, length_length: 4, encoding: 'ascii',
             tags: { '0002': { field: 'STD' } } },
    bytes: TLV_ASC, mapped: 'STD.DATA', mappedHex: '48454C4C4F',
    lenId: 'STD.LEN', lenHex: '30303035', tagId: 'STD.TAG', tagHex: '30303032',
    unmapped: 'BUF.0003', unmappedHex: '56495341' },
];
for (const c of TLV_MAPPED) {
  for (const unknown of ['emit', 'skip', 'error']) {
    test(`mapped ${c.name} + unknown:${unknown}`, () => {
      const ctx = tlvMx({ ...c.attrs, unknown }, c.bytes);
      eq(tlvHex(ctx, c.mapped), c.mappedHex, 'mapped value lands in the element');
      eq(tlvHex(ctx, c.lenId), c.lenHex, 'mapped length leaf is filled');
      if (c.tagId) eq(tlvHex(ctx, c.tagId), c.tagHex, 'TAG leaf kept when the DDL declares it');
      if (unknown === 'emit') {
        eq(tlvHex(ctx, c.unmapped), c.unmappedHex, 'unmapped tag is invented');
        eq(tlvErr(ctx).length, 0, 'emit is not an error');
      } else if (unknown === 'skip') {
        assert.ok(!ctx.fields.some(f => f.id === c.unmapped), 'skip drops the unmapped tag');
        eq(tlvErr(ctx).length, 0, 'skip is silent');
      } else {
        assert.ok(ctx.fields.some(f => f.error && /not mapped/.test(f.error)),
          `error flags the unmapped tag, got: ${tlvErr(ctx).join(' | ')}`);
        assert.ok(!ctx.fields.some(f => f.id === c.unmapped && !f.error),
          'and does not also invent a data row');
      }
    });
  }
}

// unknown without tags/ber takes the simple path, which always emits — the
// policy is only honoured once the mapped executor is entered.
test('unknown:skip without tags or ber is ignored — the simple path always emits', () => {
  const ctx = tlvMx({ field: 'BUF', tag_length: 2, length_length: 1, unknown: 'skip' }, TLV_BIN);
  assert.ok(tlvHex(ctx, 'BUF.9F26'), 'still emitted');
  assert.ok(tlvHex(ctx, 'BUF.9F36'), 'both triples');
});
test('unknown:skip with tags:{} enters the mapped path and drops every tag', () => {
  const ctx = tlvMx({ field: 'BUF', tag_length: 2, length_length: 1, tags: {}, unknown: 'skip' }, TLV_BIN);
  deepEq(tlvIds(ctx), [], 'nothing invented');
});
test('unknown:error with tags:{} flags every tag', () => {
  const ctx = tlvMx({ field: 'BUF', ber: true, tags: {}, unknown: 'error' }, TLV_BIN);
  eq(ctx.fields.filter(f => f.error && /not mapped/.test(f.error)).length, 2, 'both tags flagged');
});

// Custom leaf names — block-level and per-tag. The defaults (TAG/LEN/DATA) must
// not fire when the spec names T/L/V, and a per-tag name must beat the block.
test('tag_field / length_field / value_field rename the leaves', () => {
  const ctx = tlvMx({ field: 'BUF', ber: true, unknown: 'skip',
    tag_field: 'T', length_field: 'L', value_field: 'V',
    tags: { '9F26': { field: 'CUSTOM' } } }, TLV_BIN);
  eq(tlvHex(ctx, 'CUSTOM.T'), '9F26', 'tag leaf');
  eq(tlvHex(ctx, 'CUSTOM.L'), '04', 'length leaf');
  eq(tlvHex(ctx, 'CUSTOM.V'), '11223344', 'value leaf');
  assert.ok(!ctx.fields.some(f => /CUSTOM\.(TAG|LEN|DATA)$/.test(f.id)),
    'default names are not also filled');
});
test('per-tag leaf names beat the block-level names', () => {
  const ctx = tlvMx({ field: 'BUF', ber: true, unknown: 'skip',
    tag_field: 'T', length_field: 'L', value_field: 'V',
    tags: {
      '9F26': { field: 'CUSTOM', tag_field: 'T', length_field: 'L', value_field: 'V' },
      '9F36': { field: 'STD' },
    } }, TLV_BIN);
  eq(tlvHex(ctx, 'CUSTOM.V'), '11223344', '9F26 uses the per-tag T/L/V');
  // Block-level T/L/V still apply to 9F36, and STD has TAG/LEN/DATA — so no
  // matching leaves, and the value is emitted on the group itself.
  eq(tlvHex(ctx, 'STD'), '0001', '9F36 falls through to the group id');
  assert.ok(!ctx.fields.some(f => f.id === 'STD.DATA'),
    'block-level T/L/V prevented the default DATA leaf');
});
test('per-tag leaf names can restore the defaults for one tag', () => {
  const ctx = tlvMx({ field: 'BUF', ber: true, unknown: 'skip',
    tag_field: 'T', length_field: 'L', value_field: 'V',
    tags: {
      '9F26': { field: 'CUSTOM' },
      '9F36': { field: 'STD', tag_field: 'TAG', length_field: 'LEN', value_field: 'DATA' },
    } }, TLV_BIN);
  eq(tlvHex(ctx, 'CUSTOM.V'), '11223344', '9F26 still uses T/L/V');
  eq(tlvHex(ctx, 'STD.DATA'), '0001', '9F36 uses the per-tag defaults');
  eq(tlvHex(ctx, 'STD.TAG'), '9F36', 'and keeps the tag');
});

// len — string / number / {field} / {bytes} all frame the same buffer.
const TLV_LEN_SPEC = { field: 'F55', ber: true,
  tags: { '9F26': { field: 'ARQC' } }, unknown: 'skip' };
const tlvLenSpec = (len) => [
  { 'read-tlv': { ...TLV_LEN_SPEC, len } },
  { 'read-fixed': { length: 4, as: 'TAIL' } },
];
for (const [label, len] of [
  ['string field id',        'F55.F55-LEN'],
  ['number of bytes',        2],
  ['object {field}',         { field: 'F55.F55-LEN' }],
  ['object {bytes}',         { bytes: 2 }],
  ['object {bytes, type}',   { bytes: 2, type: 'uint-be' }],
]) {
  test(`len ${label} frames the buffer and the tail follows`, () => {
    const ctx = tlvMx({ ...TLV_LEN_SPEC, len }, TLV_LEN, tlvLenSpec(len));
    eq(tlvHex(ctx, 'ARQC.DATA'), '11223344', 'mapped tag inside the framed window');
    eq(tlvVal(ctx, 'TAIL'), 'TAIL', 'TAIL is the four bytes after the length+tags');
    const tail = ctx.fields.find(f => f.id === 'TAIL');
    eq(tail.startByte, 14, '2-byte length + 12-byte tags');
    eq(ctx.fields.some(f => /9F36/.test(f.id)), false, 'unknown:skip still applies');
  });
}

test('a zero-length value is a real triple, not a stop', () => {
  const bytes = [0x9F,0x26,0x00, 0x9F,0x36,0x02,0x00,0x01];
  const ctx = tlvMx({ field: 'BUF', tag_length: 2, length_length: 1 }, bytes);
  eq(tlvHex(ctx, 'BUF.9F26'), '', 'empty value');
  eq(ctx.fields.find(f => f.id === 'BUF.9F26').valueLength, 0, 'length 0');
  eq(tlvHex(ctx, 'BUF.9F36'), '0001', 'the next triple still frames');
});

test('a truncated value: simple path stops, mapped path reports', () => {
  const bytes = [0x9F,0x26,0x04,0x11,0x22];          // says 4, only 2 remain
  const simple = tlvMx({ field: 'BUF', tag_length: 2, length_length: 1 }, bytes);
  assert.ok(!simple.fields.some(f => f.id === 'BUF.9F26'), 'simple path emits nothing for the broken triple');
  assert.ok(!simple.fields.some(f => f.error), 'and does not say why');
  const mapped = tlvMx({ field: 'BUF', ber: true, tags: {}, unknown: 'emit' }, bytes);
  assert.ok(mapped.fields.some(f => f.error && /runs past the end/.test(f.error)),
    `mapped path names the overrun, got: ${tlvErr(mapped).join(' | ')}`);
});

test('missing field (and no len / de scope) is reported', () => {
  const ctx = tlvMx({ tag_length: 2, length_length: 1 }, TLV_BIN);
  assert.ok(ctx.fields.some(f => /Missing field/.test(f.error || '')),
    `got: ${tlvErr(ctx).join(' | ')}`);
});
test('fixed-width without tag_length / length_length is reported', () => {
  const ctx = tlvMx({ field: 'BUF' }, TLV_BIN);
  assert.ok(ctx.fields.some(f => /tag_length and length_length/.test(f.error || '')),
    `got: ${tlvErr(ctx).join(' | ')}`);
});
test('ascii encoding on binary bytes fails the length as non-decimal', () => {
  const ctx = tlvMx({ field: 'BUF', tag_length: 2, length_length: 1, encoding: 'ascii' }, TLV_BIN);
  assert.ok(ctx.fields.some(f => /not a decimal number/.test(f.error || '')),
    `got: ${tlvErr(ctx).join(' | ')}`);
});
test('ber + encoding:ascii keys the tag by its characters, so a hex tags map misses', () => {
  const ctx = tlvMx({ field: 'BUF', ber: true, encoding: 'ascii',
    tags: { '9F26': { field: 'ARQC' } }, unknown: 'emit' }, TLV_BIN);
  assert.ok(!tlvHex(ctx, 'ARQC.DATA'), 'the hex key does not match a character key');
  assert.ok(ctx.fields.some(f => f.id.startsWith('BUF.') && !f.error),
    'the triple is emitted as an invented row under the character key');
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
function vlgRun(lenBytes, extraPad = 0, overrides = undefined) {
  S.ddlTree = { V: { S: { D: VLG_DDL } } };
  S.inputFormat = 'hex';
  const bytes = [0x40, 0, 0, 0, 0, 0, 0, 0,       // bitmap, bit 2 set
                 ...lenBytes,                      // the LEN field
                 0x41, 0x42, 0x43, 0x44, 0x45,     // 5 payload bytes "ABCDE"
                 ...new Array(extraPad).fill(0x2E), // room, when a case needs it
                 0x54, 0x41, 0x49, 0x4C];          // "TAIL"
  return meExecParseSpec({ name: 'X', type: 'X', ddl_bindings: ['V/S/D/MSG'],
    de_map: [{ field: 'EMV', de: 2 }],             // DE numbering comes from Overrides
    ...(overrides ? { overrides } : {}),
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

// CHANGED ON PURPOSE (v1.2.3.0). Both of these asserted the complaint arrived as
// its own row with `f.error`. That row carried the LEN's id, so Parse Results
// listed the LEN twice — once blank, once real — which is the duplicate that was
// reported. The complaint now rides ON the LEN field as `issue`, so the
// assertions moved with it and gained the count check that pins the fix.
function vlgLenRows(ctx) { return ctx.fields.filter(f => f.id === 'EMV.LEN'); }

test('a length past the end of the message is reported, not read off the end', () => {
  const ctx = vlgRun([0x7F, 0xFF]);                // absurd binary length
  const rows = vlgLenRows(ctx);
  eq(rows.length, 1, `the LEN is ONE row, never a field plus an error row: ${JSON.stringify(rows)}`);
  assert.ok(/runs past the end/.test(rows[0].issue || ''),
    `expected the complaint on the field, got: ${JSON.stringify(rows[0])}`);
  assert.ok(/binary integer/.test(rows[0].issue), 'and it says how the length was read');
  assert.ok(rows[0].value !== undefined, 'the field still carries what it read');
});

test('a length beyond the declared payload is flagged but still framed by the wire', () => {
  // Padded so 25 fits in the message — otherwise it trips the end-of-message
  // check first and never reaches the capacity comparison.
  const ctx = vlgRun([0x00, 0x19], 30);           // 25 > DATA's declared 20
  const rows = vlgLenRows(ctx);
  eq(rows.length, 1, 'still one row');
  assert.ok(/exceeds the 20 byte/.test(rows[0].issue || ''),
    `expected a capacity warning on the field, got: ${JSON.stringify(rows[0])}`);
});

// ── The error text has to REACH the screen ──────────────────────────────────
// Parse Results never printed one. `f.error` only ever set a CSS class on a cell
// whose content was undefined, so every engine complaint — a bad VLG length, a
// DE with no DDL field — rendered as a row with an id and four empty columns.
// Nothing tested it because the parse-spec Test panel DOES print errors, so the
// same field list looked correct there while the main table swallowed it.

console.log('\nParse Results renders the error text');

// renderFieldTable writes into #resContainer, so capture that one element.
function renderRows(fields) {
  let html = '';
  elStubs.resContainer = new Proxy({}, {
    get: (t, k) => k === 'classList' ? { add: () => {}, remove: () => {}, contains: () => false }
                 : k === 'innerHTML' ? html : (() => {}),
    set: (t, k, v) => { if (k === 'innerHTML') html = String(v); return true; },
  });
  try {
    renderFieldTable({ msgType: { type: 'STM', label: 'STM' }, manualOverride: true,
                       bytes: [], raw: '', tokens: [], fields });
  } finally { delete elStubs.resContainer; }
  return html;
}

test('a standalone error row prints its message instead of a blank line', () => {
  const html = renderRows([{ id: 'DE-22', error: 'No DDL field mapped to this DE' }]);
  assert.ok(/No DDL field mapped to this DE/.test(html),
    `the text is in the table, got: ${html.slice(0, 400)}`);
});

test('a field that parsed but has an issue shows both its value and the problem', () => {
  const html = renderRows([{
    id: 'TRACK2.LEN', dataType: 'PIC 9(2)', valueLength: 2, value: '\u0001\u0010',
    rawHex: '0110', startByte: 14, endByte: 15,
    issue: 'TRACK2.LEN: length 272 runs past the end of the message',
  }]);
  assert.ok(/length 272 runs past the end/.test(html), 'the problem is stated');
  assert.ok(/0110/.test(html), 'and the field still shows what it read');
  eq((html.match(/data-fid="TRACK2\.LEN"/g) || []).length, 1, 'on ONE row, not two');
});

test('the Test panel and Parse Results report the same problems', () => {
  // Two renderers over one field list. They disagreed for the whole history of
  // the app: Test printed errors, Parse Results dropped them.
  const fields = [
    { id: 'DE-22', error: 'No DDL field mapped to this DE' },
    { id: 'EMV.LEN', dataType: 'PIC 9(2)', value: '05', rawHex: '3035',
      issue: 'EMV.LEN: length 5 exceeds the 3 byte(s) EMV declares for its payload' },
  ];
  const main = renderRows(fields);
  const panel = meTestFieldTable(fields);
  for (const msg of ['No DDL field mapped to this DE', 'exceeds the 3 byte(s)']) {
    assert.ok(main.includes(msg),  `Parse Results states: ${msg}`);
    assert.ok(panel.includes(msg), `the Test panel states: ${msg}`);
  }
});

// ── A "bytes" override has to reach the VLG group's own rows ────────────────
// Reported from the Field Map: TRACK2.LEN declared PIC 9(2), overridden to 1
// byte, and the Field Map's LEN column said 1 while Parse Results kept saying 2.
// The two views read the length from different places. _meReadOneFieldFromDef
// has always honoured the override, but the VLG path builds its LEN and payload
// rows BY HAND off `def.length`, so the override was displayed and never applied.

// ── OCCURS is a fixed count, measured in EFFECTIVE bytes ────────────────────
// Reported: a DDL with `02 GRP OCCURS 4 TIMES` containing PIC X(16) + PIC X(8),
// both overridden to hex-char, showed only GRP[01] in Parse Results while the raw
// data plainly held all four. Two defects stacked:
//
//   1. _occursShouldSkip measured the array in DECLARED bytes — groupOffset 24 and
//      childSize 24, where the hex-char overrides make the real numbers 12 and 12.
//   2. With no count field it INVENTED a count by dividing the remaining message
//      length by the child size: min(4, floor((51-24)/24)) = 1. OCCURS 4 TIMES
//      already said 4.
//
// 32 tests touched OCCURS and none of them set a size-changing override, which is
// how both survived: with no override, declared == effective and the division
// lands on the right answer for any full-length message.

// ── The overrides list and the table must agree about OCCURS ids ────────────
// Reported: applying an override from GRP[01].A correctly wrote ONE rule that
// governs all four occurrences — but then selecting that row highlighted no rule,
// and clicking the rule highlighted no row. Override keys are canonical (GRP.A);
// table rows are per-occurrence (GRP[01].A). Identical for an ordinary field,
// never equal for OCCURS, so raw id comparison worked everywhere else.

// ── read-ddl from/until: resolve the name, and say when it is ambiguous ─────
// Reported: `{"read-ddl": {"binding": 0, "until": "<field>"}}` read the whole DDL.
// The walk compares `def.id === until`, so ONLY a fully-qualified id matched — a
// leaf name or an occurrence-stripped one silently matched nothing. The lint said
// nothing either, because its id set contains canonical forms and group prefixes
// that the walk cannot match.

// ── NETARD formats: every byte knows which characters produced it ───────────
// Reported: highlighting a field in the Message Input pane was wrong for
// NETARD-HEX / -ASCII / -EBCDIC / -OCTAL, and right for plain NETARD and
// -HEXASCII. Only the hexascii branch tracked columns; every other branch pushed
// bytes with no position, so the map fell back to "highlight the whole line".
//
// Samples are the ones from test/Message-Tests/Message Formats.txt, inlined
// because test/ is gitignored (TODO item 5) and a test may not depend on a file
// that exists on one machine.

// ── Manual override is armed deliberately, not by selecting a DDL ───────────
// Reported as a design flaw, not a bug: authoring a DDL field by field meant the
// DDL was selected in the tree, and selecting it WAS arming override — so every
// Parse ignored the parse spec until the selection was cleared by hand. One
// gesture was doing two unrelated jobs, and the one you did not mean won.

// ── A length source cannot make a field longer than the message ────────────
// Reported: with an error on screen, hovering a parsed field locked the tab.
// GROUP.AA is a length source read as hex-char, so its bytes spell "24252626…"
// and — by the hex-char rule — that IS the number. The next field then claimed
// bytes 28..24,252,654, and the highlight walked every one of them on hover.
//
// Three defects met here: the leaf VLG path never bounded the length (the GROUP
// path always had), it ignored the character/byte unit its own group form uses,
// and endByte was derived from the DECLARED length rather than what was read —
// so the span outran the message even when the value did not.

console.log('\na length source cannot outrun the message');

const HANG_DDL = `DEFINITION REQMSG.
    02 AA PIC X(8).
    02 BB PIC X(8).
    02 SIZE PIC X(8).
    02 GROUP OCCURS 8 TIMES.
       04 AA PIC X(8).
       04 BB PIC X(8).
    02 MORE PIC X(8).
    02 WHAT PIC X(8).
    02 SOME PIC X(8).
    02 FIELD PIC X(8).
END.
`;
const HANG_HEX = '0001020304050607000000021223141516171819202122232425262728293031323334353637'
               + '3839404142434445464748495021223141516171819202122232425262728293031323334'
               + '35363738394041424344454647484950';
function hangRun(overrides, until) {
  S.ddlTree = { V: { S: { D: HANG_DDL } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from((HANG_HEX.match(/../g) || []).map(h => parseInt(h, 16)));
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/REQMSG'], overrides,
    parse_spec_binary: [{ 'read-ddl': { binding: 0, ...(until ? { until } : {}) } }] }, bytes);
  return { ctx, len: bytes.length };
}
// The reported configuration: AA is the length source, both hex-char.
const HANG_OVR = { 'GROUP.AA': { type: 'hex-char', vlg: true, count: 'digits' },
                   'GROUP.BB': { type: 'hex-char' } };

test('no field claims a byte the message does not have', () => {
  const { ctx, len } = hangRun(HANG_OVR, 'GROUP[01].BB');
  for (const f of ctx.fields) {
    if (f.error || f.startByte == null) continue;
    assert.ok(f.endByte < len,
      `${f.id} ends at ${f.endByte} in a ${len}-byte message — a hover would walk every one`);
    assert.ok(f.endByte >= f.startByte - 1, `${f.id} has a sane span`);
  }
});

test('the span agrees with what was actually read', () => {
  // endByte came from the DECLARED length; valueLength from the clamped slice.
  // When they disagree the highlight walks bytes that were never read.
  const { ctx } = hangRun(HANG_OVR, 'GROUP[01].BB');
  for (const f of ctx.fields) {
    if (f.error || f.startByte == null || f.valueLength == null) continue;
    const span = f.endByte - f.startByte + 1;
    const want = f.valueLength + (f.lenPrefix && !f.lenPrefixOwnRow ? f.lenPrefix.length : 0);
    eq(span, want, `${f.id}: span ${span} vs ${want} bytes read`);
  }
});

test('an impossible length is REPORTED, not silently clamped', () => {
  const { ctx, len } = hangRun(HANG_OVR, 'GROUP[01].BB');
  // It rides ON the length source as `issue` — a separate row under the same id
  // is the duplicate the group path was fixed for.
  const err = ctx.fields.find(f => f.issue && /runs past the end/.test(f.issue));
  assert.ok(err, `the length is called out, got: ${JSON.stringify(ctx.fields.map(f => f.issue || f.error).filter(Boolean))}`);
  assert.ok(/GROUP\[01\]\.AA/.test(err.id), `naming the length source: ${err.id}`);
  eq(ctx.fields.filter(f => f.id === err.id).length, 1, 'and it is ONE row, not two');
  const left = +(err.issue.match(/\((\d+) byte\(s\) left\)/) || [])[1];
  assert.ok(left > 0 && left < len,
    `it reports what remains (${left}) of a ${len}-byte message: ${err.issue}`);
});

test('a length source counting DIGITS converts before it judges the length', () => {
  // 0x12 0x23 spells "1223" → 1223 digits → 612 wire bytes. Still impossible
  // here, but it must be converted before it is judged, not after.
  const { ctx } = hangRun(HANG_OVR, 'GROUP[01].BB');
  const err = ctx.fields.find(f => f.issue && /runs past the end/.test(f.issue));
  assert.ok(/digit\(s\) = \d+ byte\(s\)/.test(err.issue),
    `the message states both units: ${err.issue}`);
});

test('hovering a field with an absurd span does not lock the tab', () => {
  // The reported symptom. Without the clamp this produces the SAME ranges — it
  // just walks every claimed byte to get there, so only elapsed time can catch
  // it. Bounded by the map this is 64 iterations; unbounded it is two billion,
  // which is the difference between instant and a locked tab.
  const map = Array.from({ length: 64 }, (_, i) => ({ s: i, e: i + 1 }));
  const fld = { id: 'RUNAWAY', startByte: 0, endByte: 2000000000, value: '', rawHex: '' };
  const saved = { m: S.messages, i: S.curIdx, sel: S.selFieldId, hov: S.hoverFieldId };
  try {
    S.messages = [{ fields: [fld], byteCharMap: map }];
    S.curIdx = 0; S.selFieldId = 'RUNAWAY'; S.hoverFieldId = null;
    const t0 = Date.now();
    const ranges = buildInputHLRanges();
    const ms = Date.now() - t0;
    assert.ok(ms < 1000, `bounded by the map, not the claim — took ${ms}ms`);
    assert.ok(ranges.length > 0, 'and it still highlights what exists');
    for (const r of ranges)
      assert.ok(r.e <= map.length, `range ends inside the map, got ${r.e}`);
  } finally {
    S.messages = saved.m; S.curIdx = saved.i;
    S.selFieldId = saved.sel; S.hoverFieldId = saved.hov;
  }
});

// ── The declared size is the MAXIMUM, not a default to discard ──────────────
// Stated directly: PAN is PIC X(19) because 19 is the most it can ever be. The
// LEN says how much of it is used — 08 reads 8, 16 reads 16 — but 99 cannot read
// 99. The DDL's size is a hard cap on a variable-length element.

// ── read { from, until }: keep going where the last block stopped ───────────
// Reported: after `repeat` ran 2 of a declared OCCURS 8, continuing with read-ddl
// put the next field 96 bytes too far — read-ddl positions at DECLARED offsets,
// which assume all 8 occurrences exist. `read` follows the cursor but takes one
// field at a time, and read-to-end returns a single blob rather than DDL fields.
// So there was no way to say "keep walking the DDL from here".

// ── repeat: OCCURS is the ceiling, and the count cannot be negative ─────────
// Reported: a SIZE holding 01000000 asked for sixteen million iterations. Each
// one past the last occurrence pushed an error row, so the tab stopped responding
// before the parse could finish being wrong. A count read off the wire is data,
// and data can be wrong — the DDL says how many occurrences exist.

console.log('\nrepeat is bounded by the OCCURS it reads');

const REP_DDL = `DEF R.
  02 SIZE PIC X(8).
  02 GRP OCCURS 3 TIMES.
    04 GA PIC X(2).
  02 TAIL PIC X(2).
END R.
`;
function repRun(sizeText) {
  S.ddlTree = { V: { S: { D: REP_DDL } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([
    ...sizeText.padEnd(8, '0').slice(0, 8).split('').map(c => c.charCodeAt(0)),
    ...Array.from({ length: 3 * 2 }, (_, i) => 0x61 + i),
    0x54, 0x4c,
  ]);
  const t0 = Date.now();
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    parse_spec_binary: [{ read: 'SIZE' },
                        { repeat: { count: 'SIZE', body: [{ read: 'GRP' }] } }] }, bytes);
  return { ctx, ms: Date.now() - t0,
           reads: ctx.fields.filter(f => /^GRP/.test(f.id) && !f.error).length,
           errs: ctx.fields.filter(f => f.error) };
}


test('a count within the declared OCCURS runs exactly that many times', () => {
  eq(repRun('00000002').reads, 2, 'SIZE 2 reads two occurrences');
  eq(repRun('00000002').errs.length, 0, 'and says nothing');
  eq(repRun('00000003').reads, 3, 'SIZE 3 reads all three');
});

test('a count ABOVE the declared OCCURS is capped and reported', () => {
  const { reads, errs } = repRun('01000000');           // the reported value
  eq(reads, 3, `OCCURS 3 is the ceiling — got ${reads} reads`);
  const err = errs.find(e => /OCCURS is the ceiling/.test(e.error));
  assert.ok(err, `it says so, got: ${JSON.stringify(errs)}`);
  assert.ok(/read as 3/.test(err.error), 'naming what it actually did');
});

test('sixteen million iterations do not lock the tab', () => {
  // The reported symptom. Unbounded this pushes an error row per iteration.
  const { ms } = repRun('01000000');
  assert.ok(ms < 1000, `bounded, so it finishes at once — took ${ms}ms`);
});

test('a negative count reads nothing, and says why', () => {
  const { reads, errs } = repRun('-0000002');
  eq(reads, 0, 'nothing is read');
  assert.ok(errs.some(e => /SIZE/.test(e.error)), `and the count field is named: ${JSON.stringify(errs)}`);
  // Defensive: the loop already runs zero times for a negative N, so this guard
  // exists to SAY so. No decoder yields a negative today, so assert the CONDITION
  // as well as the wording — checking the message alone survives gutting the test.
  const fn = psFnSource('_meExecRepeat');
  assert.ok(/N < 0/.test(fn), 'the negative case is actually tested for');
  assert.ok(/cannot be negative/.test(fn), 'and reported rather than passed over');
});

test('with no OCCURS to bound it, the message length is the ceiling', () => {
  // The discriminating half: a body that reads a plain field has no occurrences,
  // so the OCCURS rule cannot apply — but a runaway count must still be bounded.
  S.ddlTree = { V: { S: { D: 'DEF R.\n  02 SIZE PIC X(8).\n  02 ONE PIC X(2).\nEND R.\n' } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([...'01000000'.split('').map(c => c.charCodeAt(0)), 0x41, 0x42]);
  const t0 = Date.now();
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    parse_spec_binary: [{ read: 'SIZE' },
                        { repeat: { count: 'SIZE', body: [{ skip: { length: 1 } }] } }] }, bytes);
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `still bounded — took ${ms}ms`);
  assert.ok(ctx.fields.find(f => f.error && /byte\(s\) in the message/.test(f.error)),
    'and the ceiling it used is stated');
});

console.log('\nread {from, until} continues from the cursor');

const WIN_DDL = `DEF R.
  02 AA PIC X(2).
  02 SIZE PIC X(8).
  02 GROUP OCCURS 8 TIMES.
    04 GA PIC X(2).
  02 MORE PIC X(2).
  02 WHAT PIC X(2).
  02 SOME PIC X(2).
END R.
`;
function winRun(tail, count = '00000002') {
  S.ddlTree = { V: { S: { D: WIN_DDL } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([
    0x41, 0x42,                                        // AA
    ...count.split('').map(c => c.charCodeAt(0)),       // SIZE
    ...Array.from({ length: 8 * 2 }, (_, i) => 0x61 + i),
    0x4d, 0x4d, 0x57, 0x57, 0x53, 0x53,                // MORE WHAT SOME
  ]);
  return meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    parse_spec_binary: [
      { read: 'AA' }, { read: 'SIZE' },
      { repeat: { count: 'SIZE', body: [ { read: 'GROUP' } ] } },
      ...tail,
    ] }, bytes);
}
const winAt = (ctx, id) => (ctx.fields.find(f => f.id === id) || {}).startByte;

test('the window starts where the repeat stopped', () => {
  // AA(2) + SIZE(8) + 2 occurrences x 2 = 14.
  const ctx = winRun([{ read: { from: 'MORE' } }]);
  eq(winAt(ctx, 'MORE'), 14, `MORE follows the 2 occurrences read, got ${winAt(ctx, 'MORE')}`);
  eq(winAt(ctx, 'WHAT'), 16, 'and the rest follow it');
  eq(winAt(ctx, 'SOME'), 18, 'to the end of the DDL');
});

test('read-ddl still positions at the DECLARED offsets — unchanged', () => {
  // The discriminating half, and the reason this is a new block rather than a
  // change to read-ddl: six recorded cases depend on read-ddl restarting.
  const ctx = winRun([{ 'read-ddl': { binding: 0, from: 'MORE' } }]);
  eq(winAt(ctx, 'MORE'), 26, `declared position: 2 + 8 + 8x2 = 26, got ${winAt(ctx, 'MORE')}`);
});

test('until bounds the window, inclusively', () => {
  const ctx = winRun([{ read: { from: 'MORE', until: 'WHAT' } }]);
  eq(winAt(ctx, 'WHAT'), 16, 'WHAT is included');
  eq(winAt(ctx, 'SOME'), undefined, 'and SOME is not read');
});

test('a leaf or group name resolves, as it does in read-ddl', () => {
  const ctx = winRun([{ read: { from: 'GROUP' } }]);
  assert.ok(winAt(ctx, 'MORE') != null, 'the window ran to the end');
  const gas = ctx.fields.filter(f => f.id === 'GROUP[01].GA');
  eq(gas.length, 2, 'the repeat read it once and the window read it again');
  eq(gas[gas.length - 1].startByte, 14,
     `the window read at the cursor, not the declared 10 — got ${gas[gas.length - 1].startByte}`);
});

test('until without from is refused rather than reading everything', () => {
  const ctx = winRun([{ read: { until: 'WHAT' } }]);
  const err = ctx.fields.find(f => f.error && /needs a "from"/.test(f.error));
  assert.ok(err, `it says so, got: ${JSON.stringify(ctx.fields.filter(f => f.error))}`);
  eq(winAt(ctx, 'MORE'), undefined, 'and nothing was read');
});

test('a name that matches nothing is reported, not silently skipped', () => {
  const ctx = winRun([{ read: { from: 'NOSUCH' } }]);
  assert.ok(ctx.fields.find(f => f.error && /not found in the bound DDL/.test(f.error)),
    'the unknown name is named');
});

test('a backwards window is refused', () => {
  const ctx = winRun([{ read: { from: 'SOME', until: 'MORE' } }]);
  assert.ok(ctx.fields.find(f => f.error && /comes before/.test(f.error)),
    'an empty window is called out rather than silently doing nothing');
});

// ── A VLG marked through the UI lands on the group's FIRST LEAF ────────────
// The VLG button targets leaves[0], not the group, so the engine has to accept
// the flag in either place. It only looked at the group, so a UI-marked group
// fell through to the leaf rule: the length went to the next LEAF — for a nested
// payload, the first sub-field of the first subgroup — and was capped at ITS
// size, reporting "TAG declares at most 2" about a field nobody touched.
console.log('\na VLG marked on the group or on its first leaf behaves the same');

const VLG_NEST_DDL = `DEF MSG.
  02 F55.
    04 F55-LEN PIC X(2).
    04 F55-DATA.
      06 G1.
        08 A PIC X(2).
        08 B PIC X(6).
      06 G2.
        08 C PIC X(2).
        08 D PIC X(6).
  02 AFTER PIC X(4).
END MSG.
`;
function vlgNestRun(overrides, lenVal = 16) {
  S.ddlTree = { V: { S: { D: VLG_NEST_DDL } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([
    (lenVal >> 8) & 0xff, lenVal & 0xff,
    ...Array.from({ length: 24 }, (_, i) => 0x41 + (i % 26)),
  ]);
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/MSG'],
    ...(overrides ? { overrides } : {}),
    parse_spec_binary: [{ 'read-ddl': 'ANY' }] }, bytes);
  return { at: id => (ctx.fields.find(f => f.id === id) || {}).startByte,
           msgs: ctx.fields.filter(f => f.error || f.issue).map(f => f.error || f.issue),
           ctx };
}

test('the three ways of marking a VLG all frame the SAME group', () => {
  // On the group, on the group naming its leaf, and on the leaf itself — the
  // last is what the UI writes, and it used to be the one that did not work.
  const forms = {
    'on the group':        { F55: { vlg: true } },
    'group names the leaf':{ F55: { vlg: 'F55.F55-LEN' } },
    'on the first leaf':   { 'F55.F55-LEN': { vlg: true } },
  };
  const ref = vlgNestRun(forms['on the group']);
  for (const [label, ov] of Object.entries(forms)) {
    const r = vlgNestRun(ov);
    eq(r.at('AFTER'), ref.at('AFTER'), `${label}: AFTER lands in the same place`);
    eq(r.at('F55.F55-DATA.G2.C'), ref.at('F55.F55-DATA.G2.C'), `${label}: and so does the last leaf`);
  }
});

test('a length within the declared size is used exactly, across several subgroups', () => {
  // LEN 16 = exactly what G1+G2 declare, so everything sits where the DDL says.
  const r = vlgNestRun({ 'F55.F55-LEN': { vlg: true } }, 16);
  eq(r.at('F55.F55-DATA.G1.A'), 2,  'the first leaf follows the LEN');
  eq(r.at('F55.F55-DATA.G2.C'), 10, 'the second subgroup follows the first');
  eq(r.at('AFTER'), 18, 'and AFTER follows the whole group');
  deepEq(r.msgs, [], 'nothing to report');
});

test('a length BELOW the declared size stops the group early', () => {
  // LEN 8 covers G1 only. G2 is declared but the message says it is not there.
  const r = vlgNestRun({ 'F55.F55-LEN': { vlg: true } }, 8);
  eq(r.at('F55.F55-DATA.G1.A'), 2, 'G1 is read');
  eq(r.at('AFTER'), 10, 'and AFTER starts right after the 8 bytes the LEN claims');
});

test('a length ABOVE the declared size is capped, and names the LEN and the GROUP', () => {
  // The DDL is a hard cap. What matters as much is WHICH field the complaint
  // names: the leaf rule used to blame the first sub-field of the first subgroup.
  // 20 is over the DDL's 16 but inside the message, so the CAPACITY check is the
  // one that fires — 99 would run past the message end and report that instead.
  const r = vlgNestRun({ 'F55.F55-LEN': { vlg: true } }, 20);
  eq(r.at('AFTER'), 18, 'capped at the 16 the DDL declares');
  eq(r.msgs.length, 1, `one message, got: ${JSON.stringify(r.msgs)}`);
  assert.ok(/F55-LEN/.test(r.msgs[0]), `it names the LEN, got: ${r.msgs[0]}`);
  assert.ok(/"F55"/.test(r.msgs[0]), `and the group it frames, got: ${r.msgs[0]}`);
  assert.ok(!/G1\.A|\bA\b:/.test(r.msgs[0]), `and NOT a leaf inside it: ${r.msgs[0]}`);
});

test('a flat LEN + one leaf is unchanged — a leaf is a group of one', () => {
  // The PAN shape, which already worked. It must keep working identically, or
  // the fix traded one broken flavour for another.
  eq(panRun('08').pan.valueLength, 8,  'LEN 08 still reads 8');
  eq(panRun('16').pan.valueLength, 16, 'LEN 16 still reads 16');
  eq(panRun('99').pan.valueLength, 19, 'and 99 is still capped at the declared 19');
});

// ── Bracket matching in the parse-spec editor ──────────────────────────────
console.log('\nparse-spec bracket matching');

const brk = (text, pos) => sandbox._t.mePsMatchBracket(text, pos);
const brkPair = (text, pos) => { const m = brk(text, pos); return m ? [m.a, m.b] : null; };

test('a bracket matches its partner from either side of it', () => {
  const t = '[{"a":1}]';
  deepEq(brkPair(t, 0), [0, 8], 'cursor ON the opening bracket');
  deepEq(brkPair(t, 8), [8, 0], 'and on the closing one, looking back');
  // The character AT the cursor wins over the one before it, which is how an
  // editor behaves: at index 1 the cursor is sitting on the inner brace.
  deepEq(brkPair(t, 1), [1, 7], 'the character at the cursor takes precedence');
  // Past the last character there is nothing at the cursor, so it looks back —
  // this is the "just after a bracket" case that matters in practice.
  deepEq(brkPair(t, 9), [8, 0], 'just past a closing bracket still matches it');
  deepEq(brkPair(t, 2), [1, 7], 'the inner pair, from inside it');
});

test('nesting is counted, not just the next bracket of the same kind', () => {
  //          0123456789...
  const t = '[[[]]]';
  deepEq(brkPair(t, 0), [0, 5], 'outermost');
  deepEq(brkPair(t, 1), [1, 4], 'middle');
  deepEq(brkPair(t, 2), [2, 3], 'innermost');
});

test('the two bracket kinds do not pair with each other', () => {
  const t = '{"a":[1,2]}';
  deepEq(brkPair(t, 0), [0, 10], 'the brace pairs with the brace');
  deepEq(brkPair(t, 5), [5, 9],  'and the bracket with the bracket');
});

test('a bracket inside a string or a comment is text, not structure', () => {
  // The reason this is JSONC-aware rather than a plain scan.
  const t = '{"a":"}"}';
  deepEq(brkPair(t, 0), [0, 8], 'the } inside the string is skipped');
  eq(brk(t, 6), null, 'and it matches nothing itself');
  const c = '[ // ]\n]';
  deepEq(brkPair(c, 0), [0, 7], 'a ] in a line comment is skipped');
  const b = '[ /* ] */ ]';
  deepEq(brkPair(b, 0), [0, 10], 'and in a block comment');
});

test('an unmatched bracket highlights nothing rather than guessing', () => {
  eq(brk('[{"a":1}', 0), null, 'no closing bracket');
  eq(brk('}', 0), null, 'a stray closer');
  eq(brk('', 0), null, 'an empty document');
});

test('a position that is not a bracket matches nothing', () => {
  const t = '[{"a":1}]';
  eq(brk(t, 4), null, 'inside a key');
  eq(brk(t, 6), null, 'on a value');
});

test('it works on a realistic nested parse spec', () => {
  const t = JSON.stringify([
    { 'read-ddl': { until: 'DE-54' } },
    { 'read-tlv': { field: 'DE-55', len: 'F.LEN', tags: { '9F26': { field: 'ARQC' } } } },
  ], null, 2);
  const open = t.indexOf('[');
  const m = brk(t, open);
  assert.ok(m, 'the outermost bracket matches');
  eq(t[m.b], ']', 'with a closing bracket');
  eq(m.b, t.length - 1, 'the last character of the document');
  // The tags object, deep inside, resolves to its own partner.
  const tagsAt = t.indexOf('{', t.indexOf('"tags"'));
  const tm = brk(t, tagsAt);
  assert.ok(tm && t[tm.b] === '}', 'and so does a deeply nested one');
  assert.ok(tm.b < t.length - 2, 'closing before the outer brackets');
});

console.log('\na length source is capped by the declared size');

function panRun(lenByte, panPic = 19, msgLen = 60) {
  S.ddlTree = { V: { S: { D: `DEF R.
  02 PAN-LEN PIC X(2).
  02 PAN PIC X(${panPic}).
  02 TAIL PIC X(2).
END R.
` } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([
    ...String(lenByte).padStart(2, '0').split('').map(c => c.charCodeAt(0)),
    ...Array.from({ length: msgLen }, (_, i) => 0x41 + (i % 26)),
  ]);
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    overrides: { 'PAN-LEN': { vlg: true } },
    parse_spec_binary: [{ 'read-ddl': { binding: 0 } }] }, bytes);
  return { ctx, pan: ctx.fields.find(f => f.id === 'PAN'),
           errs: ctx.fields.filter(f => f.error || f.issue) };
}

test('a length below the declared size is used exactly', () => {
  eq(panRun('08').pan.valueLength, 8,  'LEN 08 reads 8');
  eq(panRun('16').pan.valueLength, 16, 'LEN 16 reads 16');
  eq(panRun('08').errs.length, 0, 'and nothing is reported');
});

test('a length ABOVE the declared size is capped at the declared size', () => {
  const { pan, errs } = panRun('99');
  eq(pan.valueLength, 19, `PIC X(19) can never read 99 — got ${pan.valueLength}`);
  const capped = errs.find(e => /declares at most 19/.test(e.issue || e.error));
  assert.ok(capped, `and it says so, got: ${JSON.stringify(errs)}`);
  assert.ok(/read as 19/.test(capped.issue), 'naming what it actually read');
  eq(errs.filter(e => e.id === 'PAN').length, 1, 'on ONE PAN row, not a second one');
});

test('the cap does not swallow the field that follows', () => {
  // Capping must not leave the cursor where the bogus length pointed, or every
  // later field shifts by 80 bytes.
  const { ctx } = panRun('99');
  const tail = ctx.fields.find(f => f.id === 'TAIL');
  eq(tail.startByte, 2 + 19, `TAIL follows the capped PAN, got ${tail.startByte}`);
});

test('the cap is the DECLARED size, so a different PIC caps differently', () => {
  // Discriminating: a fixed cap of 19 would pass the test above by accident.
  eq(panRun('99', 8).pan.valueLength,  8,  'PIC X(8) caps at 8');
  eq(panRun('99', 30).pan.valueLength, 30, 'PIC X(30) caps at 30');
});

test('a VLG GROUP is capped by the group\'s total declared payload', () => {
  // Same rule one level up: a group's declared size is the most it can hold, so a
  // LEN above it is bad data. The group path used to report the overrun and then
  // use the wire value anyway — "the wire decides the framing" — which is the
  // opposite policy to the leaf form it is the group version of.
  S.ddlTree = { V: { S: { D: `DEF R.
  02 EMV.
    04 LEN PIC X(2).
    04 DATA PIC X(12).
  02 TAIL PIC X(2).
END R.
` } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([0x39, 0x39,                       // LEN = "99"
    ...Array.from({ length: 120 }, (_, i) => 0x41 + (i % 26))]);
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    overrides: { 'EMV': { vlg: 'EMV.LEN' } },
    parse_spec_binary: [{ 'read-ddl': { binding: 0 } }] }, bytes);
  const data = ctx.fields.find(f => f.id === 'EMV.DATA');
  eq(data.valueLength, 12, `the group declares 12 for its payload — got ${data.valueLength}`);
  const said = ctx.fields.find(f => (f.issue || f.error || '').includes('declares for its payload'));
  assert.ok(said, 'and the overrun is reported');
  assert.ok(/read as 12/.test(said.issue || said.error), 'naming what it actually read');
  // The field after the group must not be pushed out by the bogus length.
  const tail = ctx.fields.find(f => f.id === 'TAIL');
  assert.ok(tail && tail.startByte === 2 + 12, `TAIL follows the capped group, got ${tail && tail.startByte}`);
});

test('a DECLARED length longer than the message does not inflate the span', () => {
  // Independent of any length source: the DDL alone can declare more than the
  // message holds. endByte came from the declared length while valueLength came
  // from the clamped slice, so the span outran the data with no override in play.
  S.ddlTree = { V: { S: { D: 'DEF R.\n  02 BIG PIC X(200).\nEND R.\n' } } };
  S.inputFormat = 'hex';
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    parse_spec_binary: [{ 'read-ddl': { binding: 0 } }] },
    Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  const f = ctx.fields.find(x => x.id === 'BIG');
  eq(f.valueLength, 10, 'ten bytes were read');
  eq(f.endByte, 9, `and the span ends at 9, not 199 — got ${f.endByte}`);
});

test('a length source counting DIGITS converts to bytes before sizing', () => {
  // 0x10 spells "10" → 10 DIGITS → 5 wire bytes. Without the conversion the
  // next field takes 10, which is the group form's rule ignored by the leaf form.
  // `count` says what the number counts; the type only says how to read it.
  S.ddlTree = { V: { S: { D: `DEF R.
  02 LEN PIC X(1).
  02 DATA PIC X(20).
END R.
` } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([0x10, ...Array.from({ length: 20 }, (_, i) => i + 1)]);
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    overrides: { LEN: { type: 'hex-char', vlg: true, count: 'digits' } },
    parse_spec_binary: [{ 'read-ddl': { binding: 0 } }] }, bytes);
  const data = ctx.fields.find(f => f.id === 'DATA');
  eq(data.valueLength, 5, `10 digits is 5 bytes, got ${data.valueLength}`);
  eq(ctx.fields.filter(f => f.error).length, 0, 'and it fits, so nothing is reported');
});

test('a length that FITS is still honoured — the clamp is not a cap on everything', () => {
  // The discriminating half: a plain (non-hex-char) length source whose value is
  // small must size the next field exactly, with no complaint.
  S.ddlTree = { V: { S: { D: `DEF R.
  02 LEN PIC X(1).
  02 DATA PIC X(20).
  02 TAIL PIC X(2).
END R.
` } } };
  S.inputFormat = 'hex';
  const bytes = Uint8Array.from([0x05, 1, 2, 3, 4, 5, 0x54, 0x4C]);
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    overrides: { LEN: { vlg: true } },
    parse_spec_binary: [{ 'read-ddl': { binding: 0 } }] }, bytes);
  const data = ctx.fields.find(f => f.id === 'DATA');
  eq(data.valueLength, 5, 'the wire length is used');
  eq(ctx.fields.filter(f => f.error).length, 0, 'and nothing is reported');
});

console.log('\nmanual override is armed deliberately');

function ovrReset() {
  S.ddlTree = { V: { S: { D: 'DEF R.\n  02 AA PIC X(2).\nEND R.\n' },
                     T: { U: 'DEF Q.\n  02 BB PIC X(2).\nEND Q.\n' } } };
  S.parseOverride = null;
  S.scope = null;
}

test('selecting a DDL does not arm override', () => {
  ovrReset();
  S.scope = { type: 'ddl', vol: 'V', sv: 'S', name: 'D' };
  eq(parseOverrideScope(), null, 'a selected DDL is not an armed one');
});

test('arming is explicit, and names the DDL it armed', () => {
  ovrReset();
  toggleParseOverride('def', 'V', 'S', 'D', 'R');
  const o = parseOverrideScope();
  assert.ok(o, 'armed');
  eq(`${o.vol}/${o.sv}/${o.name}`, 'V/S/D', 'the armed path');
  // CHANGED ON PURPOSE (v1.14.1.2). These armed the FILE. A file that holds
  // definitions is a container, not a parse unit — "parse everything as this
  // file" has no meaning when it holds four of them — so the override targets
  // a DEFINITION now. Exclusion still belongs on the file, where it is a bulk
  // action over everything inside.
  assert.ok(isParseOverride('V', 'S', 'D', 'R'), 'the tree marks the armed definition');
  assert.ok(!isParseOverride('V', 'S', 'D'), 'and not the file that contains it');
  assert.ok(!isParseOverride('V', 'T', 'U', 'Q'), 'without marking any other');
});

test('a file that holds definitions cannot be the override target', () => {
  // Reported: a file was armed, which cannot be parsed as one thing.
  ovrReset();
  toggleParseOverride('ddl', 'V', 'S', 'D');      // the fixture file holds DEF R
  eq(parseOverrideScope(), null, 'armed on a file with definitions, it does not stand');
  // A FLAT ddl (simple ISO format, no DEF sections) has nothing else to pick,
  // so there the file itself is the parse unit and must still work.
  S.ddlTree = { V: { S: { FLAT: 'MTI FIXED 4 "Message Type"\n' } } };
  S.parseOverride = null;
  toggleParseOverride('ddl', 'V', 'S', 'FLAT');
  const o = parseOverrideScope();
  assert.ok(o && o.name === 'FLAT', 'a flat DDL can still be armed as a file');
});

test('arming the same DDL again disarms it', () => {
  ovrReset();
  toggleParseOverride('def', 'V', 'S', 'D', 'R');
  toggleParseOverride('def', 'V', 'S', 'D', 'R');
  eq(parseOverrideScope(), null, 'toggled off');
});

test('arming a second DDL replaces the first — only one is ever in charge', () => {
  ovrReset();
  toggleParseOverride('def', 'V', 'S', 'D', 'R');
  toggleParseOverride('def', 'V', 'T', 'U', 'Q');
  eq(parseOverrideScope().name, 'U', 'the newer one');
  assert.ok(!isParseOverride('V', 'S', 'D'), 'and the older is released');
});

test('an armed DDL that no longer exists disarms itself', () => {
  // Deleting or renaming the armed DDL must not leave a parse pointed at nothing.
  ovrReset();
  toggleParseOverride('def', 'V', 'S', 'D', 'R');
  delete S.ddlTree.V.S.D;
  eq(parseOverrideScope(), null, 'it releases rather than pointing at a gap');
  eq(S.parseOverride, null, 'and clears the stored value');
});

test('the override parse reads the ARMED ddl, not the selected one', () => {
  // The whole point: what parses no longer depends on what is open in the editor.
  ovrReset();
  toggleParseOverride('def', 'V', 'T', 'U', 'Q');       // armed
  S.scope = { type: 'ddl', vol: 'V', sv: 'S', name: 'D' };   // merely selected
  const armed = getDDLsForScope(parseOverrideScope()).map(x => x.path).join(',');
  eq(armed, 'V/T/U', 'the armed DDL is what parses');
  const sel = getDDLsForScope().map(x => x.path).join(',');
  eq(sel, 'V/S/D', 'while the selection still drives the editor');
});

test('nothing still tells the user that SELECTING a DDL overrides', () => {
  // The help and four hints all said "select a DDL in the tree and press Parse".
  // That instruction is now wrong, and it is the exact habit that caused the
  // false positives — documentation that teaches the trap.
  const stale = [...html.matchAll(/select a DDL[\s\S]{0,90}?(manual override|▶ Parse)/gi)].map(m => m[0]);
  assert.deepStrictEqual(stale.map(String), [],
    `these still describe the old behaviour:\n${stale.join('\n')}`);
  // And the new gesture is named where the old one was.
  assert.ok((html.match(/Use for parsing \(override\)/g) || []).length >= 4,
    'the arming gesture is named in the help and the hints');
});

test('arming repaints the tree immediately, via a function that exists', () => {
  // The marker appeared only after a later click: the toggle called renderTree(),
  // which does not exist — the renderer is renderDDLTree — and the `typeof`
  // guard turned that typo into silence rather than an error.
  const fn = psFnSource('toggleParseOverride');
  const calls = [...fn.matchAll(/typeof (\w+) === 'function'\)\s*(\w+)\(/g)];
  assert.ok(calls.length >= 2, `it refreshes the surfaces: ${fn}`);
  for (const [, guarded, called] of calls) {
    eq(guarded, called, 'the guard checks the same name it calls');
    assert.ok(new RegExp(`function ${called}\\b`).test(APP_SRC),
      `${called}() is a real function — a guarded call to a missing one is silent`);
  }
});

test('the armed marker survives the cascade and does not rely on text colour', () => {
  // First attempt coloured the ROW; .tree-ddl-lbl / .tree-def-lbl set their own
  // colour and won, so only the ▶ glyph changed — the same specificity trap that
  // hid the DE fade and the row-number alignment.
  assert.ok(/\.tree-node\.tree-ovr \.tree-ddl-lbl/.test(html), 'the DDL label is targeted');
  assert.ok(/\.tree-node\.tree-ovr \.tree-def-lbl/.test(html), 'and the DEF label');
  // Selection sets those labels to the accent — an armed row must stay amber.
  assert.ok(/\.tree-node\.tree-ovr\.tree-sel \.tree-def-lbl/.test(html),
    'and selection cannot repaint it');
  // Three palettes: text colour alone is not enough, so it also tints and bars.
  const row = html.match(/\.tree-node\.tree-ovr \{[^}]*\}/)[0];
  assert.ok(/background:/.test(row), `it tints the row: ${row}`);
  assert.ok(/box-shadow:\s*inset/.test(row), 'and carries a solid left bar');
});

test('every override decision asks the armed scope, not the tree selection', () => {
  // Source tripwire: three call sites decided this independently, all by testing
  // S.scope.type. One of them left behind would bring the trap back for that flow.
  const dispatch = APP_SRC.slice(APP_SRC.indexOf('isFupCopyLog(msgText)'),
                                 APP_SRC.indexOf('function _runP1Parse'));
  assert.ok(!/S\.scope\?\.type === 'ddl'/.test(dispatch),
    `no dispatch path arms override from the selection:\n${dispatch.slice(0, 400)}`);
  eq((dispatch.match(/parseOverrideScope\(\)/g) || []).length >= 3, true,
     'all three flows ask the same question');
});

console.log('\nNETARD formats map each byte to its own characters');

const netMk = ls => ls.map((content, i) => ({ content, charStart: i * 100, indent: 7 }));
const NET_SAMPLES = {
  hex: netMk([
    'H-     0: F0 F8    F0 F0    82 20    00 00    80 00    00 00    04 00',
    '       7: 00 00    00 00    00 00    F0 F3    F2 F0    F0 F8    F2 F2',
    '      16: F0 F6    F0 F1    F0 F3    F8 F1    F1 F0    F9 F0    F0 F0',
    '      25: F0 F0    F1 F2    F0 F5    F2 F7    F0 --',
  ]),
  octal: netMk([
    '0-    0: 170370   170360   101040   000000   100000   000000   02200',
    '      7: 000000   000000   000000   170363   171360   170370   171362',
  ]),
  ascii: netMk([
    'A-    0:   p   x    p   p  STX      NUL NUL  NUL NUL  NUL NUL  EOT NUL',
    '      7: NUL NUL  NUL NUL  NUL NUL    p   s    r   p    p   x    r   q',
  ]),
  ebcdic: netMk([
    'E-    0:   0  8     0  0     b DS   NULNUL   80NUL   NULNUL    PFNUL',
    '      7: NULNUL   NULNUL   NULNUL     0  3    2  0     0  8     2  1',
  ]),
  // The format the loop below used to skip, because this key was not here.
  // Not built with netMk: the address column is RIGHT-aligned, so the parser
  // hands each line a different `indent` and every content starts at the first
  // address digit. Flattening that to one indent would hide the very thing that
  // was broken. These are the values parseNetardLog produces for the HEXASCII
  // record in test/Message-Tests/Message Formats.txt.
  hexascii: [
    { content: '0: F0F8 F0F0 8220 0000 8000 0000 0400 0000  [..... ..........]',  charStart: 0,   indent: 14 },
    { content: '16: 0000 0000 F0F3 F2F0 F0F8 F2F0 F1F9 F0F1  [................]', charStart: 100, indent: 13 },
    { content: '32: F0F3 F7F6 F1F0 F9F0 F0F0 F0F0 F1F2 F0F5  [................]', charStart: 200, indent: 13 },
    { content: '48: F2F7 F0                                  [...]',              charStart: 300, indent: 13 },
  ],
};

for (const fmt of Object.keys(NET_SAMPLES)) {
  test(`${fmt}: every byte maps to characters, not to the whole line`, () => {
    const r = netardExtractBytes(NET_SAMPLES[fmt], fmt);
    assert.ok(r.bytes.length > 0, 'bytes were extracted');
    const noCol = r.byteCol.filter(c => c < 0).length;
    eq(noCol, 0, `${noCol} of ${r.bytes.length} bytes fell back to a whole-line highlight`);
  });

  test(`${fmt}: each span sits inside its line and is non-empty`, () => {
    const r = netardExtractBytes(NET_SAMPLES[fmt], fmt);
    for (let i = 0; i < r.bytes.length; i++) {
      const line = NET_SAMPLES[fmt][r.lineIdx[i]].content;
      const c = r.byteCol[i], w = r.byteWid[i];
      assert.ok(w > 0, `byte ${i} has a width`);
      assert.ok(c >= 0 && c + w <= line.length,
        `byte ${i} span [${c},${c + w}) is inside a ${line.length}-char line`);
      assert.ok(line.slice(c, c + w).trim() !== '',
        `byte ${i} points at real text, got "${line.slice(c, c + w)}"`);
    }
  });
}

test('hex: the span is exactly the two characters of that byte', () => {
  // The strongest form: re-read the text the map points at and get the byte back.
  const r = netardExtractBytes(NET_SAMPLES.hex, 'hex');
  for (let i = 0; i < r.bytes.length; i++) {
    const line = NET_SAMPLES.hex[r.lineIdx[i]].content;
    const txt  = line.slice(r.byteCol[i], r.byteCol[i] + r.byteWid[i]);
    eq(parseInt(txt, 16), r.bytes[i], `byte ${i}: "${txt}" re-reads as itself`);
  }
});

test('hexascii: the span is exactly the two characters of that byte', () => {
  // Reported: highlighting a HEXASCII record lit whole dump lines — address
  // column, padding and all — instead of the two characters of the byte.
  // _netardExtractBytes built the columns and then passed them as `dataOff`,
  // which is a single number, while pushing bare byte values; `add` reads a
  // position only off a {v,c,w} item, so every byte took the no-position path.
  const r = netardExtractBytes(NET_SAMPLES.hexascii, 'hexascii');
  eq(r.bytes.length, 51, 'all 51 bytes, including the odd one on the short line');
  for (let i = 0; i < r.bytes.length; i++) {
    const line = NET_SAMPLES.hexascii[r.lineIdx[i]].content;
    const txt  = line.slice(r.byteCol[i], r.byteCol[i] + r.byteWid[i]);
    eq(r.byteWid[i], 2, `byte ${i} is two characters wide`);
    eq(parseInt(txt, 16), r.bytes[i], `byte ${i}: "${txt}" re-reads as itself`);
  }
  // The address digits are never data. Byte 16 opens the second line, whose
  // address is "16" — the two characters that a shifted map would claim.
  const l2 = NET_SAMPLES.hexascii[r.lineIdx[16]].content;
  eq(l2.slice(r.byteCol[16], r.byteCol[16] + 2), '00', 'byte 16 is the data, not the address');
  assert.ok(r.byteCol[16] > l2.indexOf(':'), 'and it sits past the colon');
});

test('every NETARD sub-format the detector can return has a sample', () => {
  // hexascii was excluded from the loop above for as long as the loop existed —
  // not by a passing assertion but by the absence of a key, on the strength of a
  // comment that said hexascii was the one branch already tracking columns. It
  // was the one branch that was not. A format with no sample is not covered, and
  // nothing said so.
  const returned = [...html.matchAll(/'netard-(\w+)'/g)].map(m => m[1])
    .filter(f => f !== 'ruler');
  const known = new Set(['hex', 'dump', 'oct', 'ebcdic', 'ascii']);
  // Map the detector's names onto _netardExtractBytes's own vocabulary.
  const asFmt = { hex: 'hex', dump: 'hexascii', oct: 'octal', ebcdic: 'ebcdic', ascii: 'ascii' };
  const missing = [...new Set(returned)].filter(f => known.has(f) && !NET_SAMPLES[asFmt[f]]);
  deepEq(missing, [], 'NETARD sub-formats with no sample, so no column coverage');
});

test('octal: a word span re-reads as the PAIR of bytes it produced', () => {
  const r = netardExtractBytes(NET_SAMPLES.octal, 'octal');
  for (let i = 0; i + 1 < r.bytes.length; i += 2) {
    const line = NET_SAMPLES.octal[r.lineIdx[i]].content;
    const txt  = line.slice(r.byteCol[i], r.byteCol[i] + r.byteWid[i]);
    eq(r.byteCol[i], r.byteCol[i + 1], `bytes ${i}/${i + 1} share the word's characters`);
    const v = parseInt(txt, 8);
    eq((v >> 8) & 0xff, r.bytes[i],     `high byte of "${txt}"`);
    eq(v & 0xff,        r.bytes[i + 1], `low byte of "${txt}"`);
  }
});

test('a COMBINED H-/A-/E- record still maps each byte to its hex characters', () => {
  // The multi-format shape from the samples file: three renderings interleaved,
  // prefixes only on the first group. A single-format sample never reaches this
  // branch, so dropping its columns passed the whole suite.
  const rows = netMk([
    'H-    0:  F0 F8    F0 F0    82 20    00 00    80 00    00 00    04 00',
    'A-         p   x    p   p  STX      NUL NUL  NUL NUL  NUL NUL  EOT NUL',
    'E-         0  8     0  0     b DS   NULNUL    80NUL   NULNUL    PFNUL',
    '      7:  00 00    00 00    00 00    F0 F3    F2 F0    F0 F8    F2 F2',
    '          NUL NUL  NUL NUL  NUL NUL   p   s    r   p    p   x    r   r',
    '          NULNUL   NULNUL   NULNUL    0  3     2  0     0  8     2  2',
  ]);
  eq(detectNetardFmt(rows.map(r => r.content)), 'hex', 'the H- rows drive it');
  const r = netardExtractBytes(rows, 'hex');
  eq(r.byteCol.filter(c => c < 0).length, 0, 'no byte falls back to a whole-line highlight');
  for (let i = 0; i < r.bytes.length; i++) {
    const txt = rows[r.lineIdx[i]].content.slice(r.byteCol[i], r.byteCol[i] + r.byteWid[i]);
    eq(parseInt(txt, 16), r.bytes[i], `byte ${i}: "${txt}" re-reads as itself`);
  }
  // And only the H- rows contributed — the A-/E- rows are the same bytes again.
  const hexOnly = netardExtractBytes(NET_SAMPLES.hex, 'hex').bytes.slice(0, r.bytes.length);
  assert.deepStrictEqual(r.bytes, hexOnly, 'the combined record decodes to the same bytes');
});

test('a COMBINED record with no H- row reads its OWN rows, not its neighbour\'s', () => {
  // The samples file carries three combined records: A-/E-, H-/E-, and
  // H-/A-/E-. Only the hex branch knew that combined output is INTERLEAVED —
  // first N prefixed lines, then groups of N repeating in the same order — so
  // the two with an H- row were fine and the A-/E- one was not.
  //
  // Reading it as EBCDIC took row 1 (the real E-) and then row 2, which is the
  // ASCII continuation: the glyph names "p s r p" were decoded as EBCDIC and
  // came out 97 A2 99 97. Reading it as ASCII stopped after row 0 — 13 bytes of
  // 51 — because row 1's E- prefix cleared the active flag.
  const rows = netMk([
    'A-    0:   p   x    p   p  STX      NUL NUL  NUL NUL  NUL NUL  EOT NUL',
    'E-         0  8     0  0     b DS   NULNUL    80NUL   NULNUL    PFNUL',
    '      7: NUL NUL  NUL NUL  NUL NUL    p   s    r   p    p   x    r   r',
    '         NULNUL   NULNUL   NULNUL     0  3     2  0     0  8     2  2',
  ]);
  const eb = netardExtractBytes(rows, 'ebcdic');
  deepEq([...new Set(eb.lineIdx)], [1, 3], 'EBCDIC reads the E- row and ITS continuation');
  const asc = netardExtractBytes(rows, 'ascii');
  deepEq([...new Set(asc.lineIdx)], [0, 2], 'ASCII reads the A- row and ITS continuation');
  // Both renderings describe one message, so the EBCDIC one must agree with the
  // H- rendering of the same record byte for byte.
  // Array.from: these come from the VM sandbox, so they carry ITS Array
  // prototype and deepStrictEqual would reject them against a local array on
  // identity alone, whatever the numbers said.
  const ref = Array.from(netardExtractBytes(NET_SAMPLES.hex, 'hex').bytes);
  const n = Math.min(eb.bytes.length, ref.length);
  assert.ok(n >= 28, `expected both continuation rows to be read, got ${eb.bytes.length} bytes`);
  deepEq(eb.bytes.slice(0, n), ref.slice(0, n), 'the EBCDIC rendering decodes to the same message');
  // The ASCII rendering is lossy — NETARD strips the high bit — so it cannot
  // equal the wire bytes. It must still cover the record, not stop at row 0.
  assert.ok(asc.bytes.length >= 27, `ASCII stopped after ${asc.bytes.length} bytes`);
  eq(asc.bytes[0], ref[0] & 0x7f, 'and it is the high-bit-stripped form of the same byte');
});

test('an octal rendering inside a combined record reads its own rows too', () => {
  // CONSTRUCTED, not captured: the samples file has no combined record carrying
  // a 0- row, so this applies the documented interleave rule — N prefixed lines,
  // then groups of N in the same order — to the file's real H- and 0- samples.
  // Without it the octal branch would keep the same defect the other two had,
  // with nothing to reveal it.
  const rows = netMk([
    'H-    0: F0 F8    F0 F0    82 20    00 00    80 00    00 00    04 00',
    '0-       170370   170360   101040   000000   100000   000000   002000',
    '      7: 00 00    00 00    00 00    F0 F3    F2 F0    F0 F8    F2 F2',
    '         000000   000000   000000   170363   171360   170370   171362',
  ]);
  const oct = netardExtractBytes(rows, 'octal');
  deepEq([...new Set(oct.lineIdx)], [1, 3], 'octal reads the 0- row and ITS continuation');
  const hex = netardExtractBytes(rows, 'hex');
  deepEq([...new Set(hex.lineIdx)], [0, 2], 'and hex still reads only its own');
  const n = Math.min(oct.bytes.length, hex.bytes.length);
  assert.ok(n >= 28, `both continuation rows must be read, got ${oct.bytes.length}/${hex.bytes.length}`);
  deepEq(oct.bytes.slice(0, n), Array.from(hex.bytes).slice(0, n),
    'the two renderings of one record decode to the same bytes');
});

test('the char map uses each byte\'s own width, not a hardcoded 2', () => {
  // The map is built inline in parseNetardLog, so this is a source check: an
  // octal word is 6 characters and a control name 1..3, and assuming 2 would
  // highlight a fragment of each.
  const flush = APP_SRC.slice(APP_SRC.indexOf('Precise: map to the characters'),
                              APP_SRC.indexOf('Fallback: highlight the entire'));
  assert.ok(/byteWid\[i\]/.test(flush), `the entry width comes from byteWid: ${flush}`);
  assert.ok(!/e: s \+ 2\b/.test(flush), 'and is not a hardcoded 2');
});

test('the four formats agree on the bytes they describe', () => {
  // hex, octal and ebcdic are three renderings of one record — they must decode
  // to the same bytes, which is what makes the column checks meaningful.
  const b = f => netardExtractBytes(NET_SAMPLES[f], f).bytes.slice(0, 8);
  const asHex = a => a.map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  eq(asHex(b('hex')),    'F0 F8 F0 F0 82 20 00 00', 'hex');
  eq(asHex(b('octal')),  asHex(b('hex')),           'octal agrees');
  eq(asHex(b('ebcdic')), asHex(b('hex')),           'ebcdic agrees');
});

console.log('\nread-ddl from/until resolve the way every other reference does');

const UNTIL_DDL = `DEF R.
  02 AA PIC X(2).
  02 BB PIC X(2).
  02 GROUP.
    04 AA PIC X(6).
    04 BB PIC X(6).
  02 REP OCCURS 3 TIMES.
    04 DD PIC X(2).
  02 ZZ PIC X(2).
END R.
`;
function untilRun(attrs) {
  S.ddlTree = { V: { S: { D: UNTIL_DDL } } };
  S.inputFormat = 'hex';
  const b = Uint8Array.from(Array.from({ length: 40 }, (_, i) => 0x41 + (i % 26)));
  return meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    parse_spec_binary: [{ 'read-ddl': { binding: 0, ...attrs } }] }, b)
    .fields.filter(f => !f.error).map(f => f.id);
}

test('a fully-qualified id still stops exactly where it did', () => {
  eq(untilRun({ until: 'GROUP.BB' }).join(' '), 'AA BB GROUP.AA GROUP.BB', 'unchanged');
});

test('a leaf name that exists only nested still resolves', () => {
  // "DD" is not an id at any level — only REP[01..03].DD are. Under the old
  // exact-id matching this read the entire DDL and said nothing.
  const ids = untilRun({ until: 'DD' });
  eq(ids[ids.length - 1], 'REP[03].DD', `stops at the nested field, got: ${ids.join(' ')}`);
  assert.ok(!ids.includes('ZZ'), 'and does not run to the end');
  // "BB" is ALSO a top-level id, so the exact match wins outright.
  eq(untilRun({ until: 'BB' }).join(' '), 'AA BB', 'an exact id is never overridden');
});

test('an occurrence-stripped name covers the whole array', () => {
  // `until` takes the LAST match, so REP.DD means "through the array" — the same
  // reading as naming a group. Use REP[01].DD to stop inside it.
  const ids = untilRun({ until: 'REP.DD' });
  eq(ids[ids.length - 1], 'REP[03].DD', 'stops after the last occurrence');
  assert.ok(!ids.includes('ZZ'), 'rather than reading past the array');
  eq(untilRun({ until: 'REP[01].DD' }).pop(), 'REP[01].DD', 'an exact id still stops inside');
});

test('naming a GROUP as until includes the whole group', () => {
  // "through GROUP" is the natural reading, so its LAST leaf ends the window.
  eq(untilRun({ until: 'GROUP' }).join(' '), 'AA BB GROUP.AA GROUP.BB',
     'the group is read in full, then it stops');
});

test('an unmatched name still reads everything, as it must', () => {
  // Nothing to stop at — the lint is what tells the user, not a silent truncation.
  assert.ok(untilRun({ until: 'NOSUCHFIELD' }).includes('ZZ'), 'no accidental stop');
});

test('the lint warns that an ambiguous name resolves to the first match', () => {
  S.ddlTree = { V: { S: { D: UNTIL_DDL } } };
  const item = { ddl_bindings: ['V/S/D/R'] };
  const spec = [{ 'read-ddl': { binding: 0, until: 'BB' } }];
  const w = mePsLintWarns(item, spec).join('\n');
  assert.ok(/until.*"BB".*matches 2 fields/.test(w), `states the ambiguity: ${w}`);
  assert.ok(/"BB" is used/.test(w), `and names the winner the walk will use: ${w}`);
  assert.ok(/GROUP\.BB/.test(w), 'while listing the other candidate, which is the point');
  // The warning must agree with the engine — assert against the actual parse.
  eq(untilRun({ until: 'BB' }).pop(), 'BB', 'exact id wins outright for the walk');
  // Discriminating: an unambiguous name must NOT be warned about.
  const w2 = mePsLintWarns(item, [{ 'read-ddl': { binding: 0, until: 'GROUP.BB' } }]).join('\n');
  assert.ok(!/matches \d+ fields/.test(w2), `qualified name is quiet: ${w2}`);
});

test('the lint warns when "fields" makes from/until dead', () => {
  S.ddlTree = { V: { S: { D: UNTIL_DDL } } };
  const item = { ddl_bindings: ['V/S/D/R'] };
  const w = mePsLintWarns(item, [{ 'read-ddl': { binding: 0, fields: ['AA'], until: 'BB' } }]).join('\n');
  assert.ok(/"until" has no effect while "fields" is set/.test(w),
    `the dead attribute is named: ${w}`);
  // Discriminating: without `fields`, until is live and must not be flagged.
  const w2 = mePsLintWarns(item, [{ 'read-ddl': { binding: 0, until: 'BB' } }]).join('\n');
  assert.ok(!/no effect while/.test(w2), `not flagged when it does work: ${w2}`);
});

// ── EVERY override kind, on EVERY row shape, across all three surfaces ──────
// Asked directly: why is there no test that walks all the overrides and checks
// they behave? There wasn't one, and that is why the same defect kept arriving in
// a new costume — canonical key vs occurrence-labelled row id broke the DE cell,
// then the list highlight, then the VLG marker, each reported separately.
//
// This is the matrix. For each override kind it asserts the three surfaces agree:
// the stored key, the table cell, and the parse. A regression in any one of them
// fails here rather than being found by hand weeks later.

console.log('\nevery override kind, on every row shape');

const MTX_DDL = `DEF R.
  02 HDR PIC X(4).
  02 GRP.
    04 AA PIC X(2).
    04 BB PIC X(4).
  02 REP OCCURS 2 TIMES.
    04 CC PIC X(2).
    04 DD PIC X(4).
END R.
`;
// One plain field, one field inside a plain group, one inside an OCCURS group —
// the three id shapes that exist. The last is the one that kept breaking.
const MTX_ROWS = [
  { label: 'plain field',    row: 'HDR',         key: 'HDR' },
  { label: 'in a group',     row: 'GRP.AA',      key: 'GRP.AA' },
  { label: 'in an OCCURS',   row: 'REP[01].CC',  key: 'REP.CC' },
  { label: 'OCCURS group',   row: 'REP[01]',     key: 'REP' },
];
function mtxCtx(overrides) {
  S.ddlTree = { V: { S: { D: MTX_DDL } } };
  const item = { ddl_bindings: ['V/S/D/R'], overrides };
  const rows = meWalkDEFields(getDDLFromPath('V/S/D/R').defs, item);
  const fo = new Map();
  for (const id in overrides) fo.set(id, overrides[id]);
  return { rows, item,
    ctx: { ea: x => String(x), vlgMap: meVlgLenMap(item), foByField: fo,
           usesBitmapFields: true, leavesByGroup: new Map() } };
}
const mtxCell = (html, col) => {
  const m = html.match(new RegExp(`<td class="me-fm-${col}[^"]*"[^>]*>(.*?)</td>`));
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '(no cell)';
};

// Each kind: what to store, which column should show it, and what the cell must contain.
const MTX_KINDS = [
  { kind: 'type',    ovr: { type: 'hex-char' },  col: 'dt',  want: /hex-char/ },
  { kind: 'display', ovr: { display: 'hex' },    col: 'dt',  want: /HEX/ },
  { kind: 'bytes',   ovr: { bytes: 6 },          col: 'len', want: /6/ },
  { kind: 'de',      ovr: { de: 7 },             col: 'de',  want: /7/ },
  { kind: 'vlg',     ovr: { vlg: true },         col: 'vlg', want: /VLG/ },
  { kind: 'de:false',    ovr: { de: false },      col: 'de',  want: /—/,        only: ['plain field', 'OCCURS group'] },
  { kind: 'de:children', ovr: { de: 'children' }, col: 'de',  want: /children/, only: ['plain field', 'OCCURS group'] },
];

for (const shape of MTX_ROWS) {
  for (const k of MTX_KINDS) {
    if (k.only && !k.only.includes(shape.label)) continue;
    test(`${k.kind} on a ${shape.label} shows in the table`, () => {
      const { rows, ctx } = mtxCtx({ [shape.key]: k.ovr });
      const row = rows.find(r => r.id === shape.row);
      assert.ok(row, `the row exists: ${shape.row}`);
      const html = meFmRowHtml(row, ctx, { n: 0 });
      const cell = mtxCell(html, k.col);
      assert.ok(k.want.test(cell),
        `${shape.row} ${k.kind} → ${k.col} cell should match ${k.want}, got "${cell}"`);
      assert.ok(/me-fm-has-ovr/.test(html), 'and the row is marked as overridden');
    });
  }
}

test('the VLG marker shows without read-bitmap-fields', () => {
  // Reported: a plain read-ddl spec applied the length-source override — the walk
  // honours it — but the table stayed blank, because the whole VLG cell was gated
  // on usesBitmapFields. That gate dated from when VLG existed only inside
  // read-bitmap-fields; _meDDLVlgRuns and the pending length made it stale.
  const { rows, ctx } = mtxCtx({ 'GRP.AA': { vlg: true } });
  ctx.usesBitmapFields = false;                  // a plain read-ddl spec
  const cell = mtxCell(meFmRowHtml(rows.find(r => r.id === 'GRP.AA'), ctx, { n: 0 }), 'vlg');
  assert.ok(/VLG/.test(cell), `the marker shows anyway, got "${cell}"`);
});

test('DE controls stay gated on read-bitmap-fields', () => {
  // The discriminating half: DE numbers only mean something with a bitmap, so
  // ungating everything would have been the wrong fix.
  const { rows, ctx } = mtxCtx({ HDR: { de: 7 } });
  ctx.usesBitmapFields = false;
  const cell = mtxCell(meFmRowHtml(rows.find(r => r.id === 'HDR'), ctx, { n: 0 }), 'de');
  assert.ok(!/\b7\b/.test(cell), `no DE number without a bitmap, got "${cell}"`);
});

test('an override keyed with an occurrence label is normalised on load', () => {
  // The reported case: VLG stored as REP[01].CC. Every reader canonicalises the
  // ROW id but not the KEY, so nothing found it — the list showed it, the table
  // did not, and the parse ignored it entirely.
  const spec = { name: 'X', overrides: { 'REP[01].CC': { vlg: true } } };
  migrateSpec(spec);
  assert.deepStrictEqual(Object.keys(spec.overrides), ['REP.CC'],
    `the key loses its occurrence label: ${JSON.stringify(spec.overrides)}`);
  eq(spec.overrides['REP.CC'].vlg, true, 'and keeps what it configured');

  // Proven through the surface that was wrong: the marker now renders.
  const { rows, ctx } = mtxCtx(spec.overrides);
  const cell = mtxCell(meFmRowHtml(rows.find(r => r.id === 'REP[01].CC'), ctx, { n: 0 }), 'vlg');
  assert.ok(/VLG/.test(cell), `the table shows it, got "${cell}"`);
});

test('normalising a key MERGES rather than discarding', () => {
  // Both forms present: neither setting may be lost.
  const spec = { name: 'X', overrides: {
    'REP.CC':     { type: 'hex-char' },
    'REP[01].CC': { vlg: true },
  } };
  migrateSpec(spec);
  assert.deepStrictEqual(Object.keys(spec.overrides), ['REP.CC'], 'one key survives');
  eq(spec.overrides['REP.CC'].type, 'hex-char', 'the canonical entry is kept');
  eq(spec.overrides['REP.CC'].vlg, true,        'and the labelled one is folded in');
});

console.log('\nthe overrides list and the table agree about OCCURS ids');

const OCCSEL_DDL = `DEF R.
  02 PLAIN PIC X(4).
  02 GRP OCCURS 4 TIMES.
    04 A PIC X(6).
END R.
`;
function occSelRows() {
  S.ddlTree = { V: { S: { D: OCCSEL_DDL } } };
  return meWalkDEFields(getDDLFromPath('V/S/D/R').defs,
    { ddl_bindings: ['V/S/D/R'], overrides: {} });
}

test('selecting one occurrence matches the rule that governs it', () => {
  // This is the comparison the list does to decide which rule to light up.
  const canon = meCanonSet(['GRP[01].A']);
  assert.ok(canon.has('GRP.A'),
    `GRP[01].A must match the rule GRP.A, got: ${[...canon]}`);
  // The discriminating half: an ordinary field still matches itself, and only it.
  const plain = meCanonSet(['PLAIN']);
  assert.ok(plain.has('PLAIN'), 'an ordinary field is unaffected');
  assert.ok(!plain.has('GRP.A'), 'and does not match an unrelated rule');
});

test('clicking the rule selects every occurrence it drives', () => {
  setFmVirt({ all: occSelRows() });
  eq(meRowsForOverride('GRP.A').join(','), 'GRP[01].A,GRP[02].A,GRP[03].A,GRP[04].A',
     'one rule resolves to all four rows');
  const sel = [...meNextSelection('GRP.A', false, new Set())].sort();
  eq(sel.join(','), 'GRP[01].A,GRP[02].A,GRP[03].A,GRP[04].A',
     `the table selects all four, got: ${sel}`);
  // Cmd-click toggles the whole group off again rather than half of it.
  const off = meNextSelection('GRP.A', true, new Set(sel));
  eq(off.size, 0, 'toggling with the group already selected clears all four');
});

test('a rule for a field with no rows still resolves to itself', () => {
  // A stale override left behind after a DDL edit must not vanish from the list or
  // throw — it resolves to its own id and simply matches nothing in the table.
  setFmVirt({ all: occSelRows() });
  eq(meRowsForOverride('GONE.FIELD').join(','), 'GONE.FIELD', 'falls back to the id itself');
});

console.log('\nOCCURS: a fixed count, measured in effective bytes');

const OCC_DDL = `DEF R.
  02 DUMMY PIC X(16).
  02 B PIC X(8).
  02 GRP OCCURS 4 TIMES.
    04 A PIC X(16).
    04 B PIC X(8).
END R.
`;
// 51 bytes, exactly as reported: enough for three whole occurrences at the
// effective 12 bytes each (12 header + 36), three bytes short of a fourth.
function occRun(overrides, len = 51) {
  S.ddlTree = { V: { S: { D: OCC_DDL } } };
  S.inputFormat = 'hex';
  const bytes = Array.from({ length: len }, (_, i) => i & 0xff);
  return meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    ...(overrides ? { overrides } : {}),
    parse_spec_binary: [{ 'read-ddl': { binding: 0 } }] }, Uint8Array.from(bytes));
}
// Every field halved: a 12-byte header and a 12-byte stride instead of 24/24.
// This used to be four `hex-char` types, which halved a field as a side effect of
// its READING. That is gone — a type says how to read bytes, never how many —
// so the same geometry is now asked for outright. The mechanism under test is
// unchanged: the array must be measured in EFFECTIVE bytes, not declared ones.
const HALVED_ALL = { DUMMY: { bytes: 8 }, B: { bytes: 4 },
                     'GRP.A': { bytes: 8 }, 'GRP.B': { bytes: 4 } };
const occIds = ctx => ctx.fields.filter(f => !f.error).map(f => f.id);

test('every declared occurrence is read, not a count guessed from the length', () => {
  const ids = occIds(occRun(HALVED_ALL));
  for (const n of ['01', '02', '03']) {
    assert.ok(ids.includes(`GRP[${n}].A`), `GRP[${n}].A is read, got: ${ids.join(', ')}`);
    assert.ok(ids.includes(`GRP[${n}].B`), `GRP[${n}].B is read`);
  }
});

test('the occurrences sit at the EFFECTIVE stride, not the declared one', () => {
  const ctx = occRun(HALVED_ALL);
  const at = id => (ctx.fields.find(f => f.id === id) || {}).startByte;
  eq(at('GRP[01].A'), 12, 'the array starts after a 12-byte header, not 24');
  eq(at('GRP[02].A'), 24, 'stride is 12 effective bytes, not 24 declared');
  eq(at('GRP[03].A'), 36, 'and it keeps holding');
});

test('a fourth occurrence the message cannot hold is REPORTED, not dropped', () => {
  // 51 bytes cannot supply 12 + 4x12 = 60. Silence here is what made the bug look
  // like "the array only has one occurrence".
  const ctx = occRun(HALVED_ALL);
  const err = ctx.fields.find(f => f.error && /could not be read/.test(f.error));
  assert.ok(err, `the shortfall is stated, got: ${JSON.stringify(ctx.fields.filter(f => f.error))}`);
  assert.ok(/GRP\[04\]/.test(err.id), `naming the field that ran out: ${err.id}`);
});

test('a message long enough yields all four, with nothing reported', () => {
  const ctx = occRun(HALVED_ALL, 60);
  const ids = occIds(ctx);
  eq(ids.filter(i => /^GRP\[\d+\]\.A$/.test(i)).length, 4, 'four occurrences');
  eq(ctx.fields.filter(f => f.error).length, 0, 'and no complaint');
});

test('without overrides the declared stride is still used', () => {
  // The discriminating half: effective == declared when nothing is overridden, so
  // a fix that ignored overrides entirely would pass the tests above and fail here.
  const ctx = occRun(null, 120);
  const at = id => (ctx.fields.find(f => f.id === id) || {}).startByte;
  eq(at('GRP[01].A'), 24, 'array starts at the declared 24');
  eq(at('GRP[02].A'), 48, 'declared stride of 24');
  eq(occIds(ctx).filter(i => /^GRP\[\d+\]\.A$/.test(i)).length, 4, 'all four');
});

test('an eye-catcher ends the array early, measured in EFFECTIVE bytes', () => {
  // The only path that still divides: a real '& ' token in the bytes. It has to
  // divide by the EFFECTIVE stride. Declared, this same token computes
  // floor((36-24)/24) = 0 and every occurrence disappears; effective, it is
  // floor((36-12)/12) = 2.
  //
  // Without this test the effective-size half of the fix is invisible: with the
  // count authoritative, nothing else consults childSize for a single-level
  // OCCURS, so reverting it passed the whole suite.
  S.ddlTree = { V: { S: { D: OCC_DDL } } };
  S.inputFormat = 'hex';
  const bytes = Array.from({ length: 60 }, (_, i) => (i & 0xff) || 1);
  bytes[36] = 0x26; bytes[37] = 0x20;              // '& ' after two occurrences
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    overrides: HALVED_ALL,
    parse_spec_binary: [{ 'read-ddl': { binding: 0 } }] }, Uint8Array.from(bytes));
  const ids = ctx.fields.filter(f => !f.error).map(f => f.id);
  eq(ids.filter(i => /^GRP\[\d+\]\.A$/.test(i)).length, 2,
     `the token ends it after two occurrences, got: ${ids.join(', ')}`);
});

test('a declared count field still wins over OCCURS n', () => {
  // OCCURS DEPENDING ON genuinely varies — that path must not be flattened to n.
  S.ddlTree = { V: { S: { D: `DEF R.
  02 NUM-GRP PIC 9(2).
  02 GRP OCCURS 4 TIMES.
    04 A PIC X(4).
END R.
` } } };
  S.inputFormat = 'hex';
  const bytes = [0x30, 0x32];                       // "02" — two occurrences
  for (let i = 0; i < 16; i++) bytes.push(0x41 + i);
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    parse_spec_binary: [{ 'read-ddl': { binding: 0 } }] }, Uint8Array.from(bytes));
  const ids = ctx.fields.filter(f => !f.error).map(f => f.id);
  eq(ids.filter(i => /^GRP\[\d+\]\.A$/.test(i)).length, 2,
     `the count field says 2, so 2 — got: ${ids.join(', ')}`);
});

console.log('\nVLG group rows honour a bytes override');

test('a bytes override on the LEN changes what the parse reads, not just the display', () => {
  // One byte, 0x05, followed by a byte the declared 2-wide LEN would have eaten.
  const ctx = vlgRun([0x05, 0x41], 0, { 'EMV.LEN': { bytes: 1 } });
  const len = ctx.fields.find(f => f.id === 'EMV.LEN');
  eq(len.valueLength, 1, 'the LEN occupies one byte, as the override says');
  const data = ctx.fields.find(f => f.id === 'EMV.DATA');
  eq(data.startByte, 9, 'so the payload starts one byte earlier');
  eq(data.valueLength, 5, 'and the length decoded from that single byte is 5');
});

test('without the override the same bytes read the declared two', () => {
  // The discriminating half: identical input, no override. If the override were
  // being ignored again both cases would land here and the pair would still pass.
  const ctx = vlgRun([0x05, 0x41]);
  eq(ctx.fields.find(f => f.id === 'EMV.LEN').valueLength, 2, 'declared width');
  eq(ctx.fields.find(f => f.id === 'EMV.DATA').startByte, 10, 'payload one byte later');
});

test('a bytes override on a payload sub-field caps it at the override', () => {
  const ctx = vlgRun([0x30, 0x35], 0, { 'EMV.DATA': { bytes: 3 } });
  eq(ctx.fields.find(f => f.id === 'EMV.DATA').valueLength, 3,
     'three bytes, not the 5 the wire length offered nor the 20 declared');
});

test('what the Field Map shows for a length is what the engine reads', () => {
  // The bug the user actually saw: two surfaces, two answers. Both must come
  // from the same effective length.
  const ov = { 'EMV.LEN': { bytes: 1 } };
  const shown = meOvEffectiveLen(ov['EMV.LEN']);
  const read  = vlgRun([0x05, 0x41], 0, ov).fields.find(f => f.id === 'EMV.LEN').valueLength;
  eq(read, shown, 'the parse reads exactly what the Field Map advertises');
});

test('the Field Map and the engine lay out a bytes override the same way', () => {
  // Both surfaces have to spend the same bytes. The Field Map used the number as
  // WRITTEN while the engine converted it, which is the disagreement that
  // started this whole thread — the table said one width, the parse used another.
  // The lever is a `bytes` override now; a TYPE moves nothing on either surface.
  S.ddlTree = { V: { S: { D: DDL_BYTES } } };
  const defs = getDDLFromPath('V/S/D/REC').defs;
  const rowsFor = ov => meWalkDEFields(getDDLFromPath('V/S/D/REC').defs,
    { ddl_bindings: ['V/S/D/REC'], overrides: { MSGTYPE: ov } });
  // A type alone: nothing moves, on either surface.
  const byType = rowsFor({ type: 'hex-char' });
  eq(byType.find(r => r.id === 'MSGTYPE').length, 4, 'a type does not resize the Field Map row');
  eq(byType.find(r => r.id === 'TAIL').offset, 4, 'so TAIL does not move either');
  eq(bytesCase({ type: 'hex-char' }).fields.find(f => f.id === 'TAIL').startByte, 4,
     'and the engine agrees');
  // A width override: both surfaces move together.
  const byBytes = rowsFor({ type: 'hex-char', bytes: 2 });
  const msg  = byBytes.find(r => r.id === 'MSGTYPE');
  const tail = byBytes.find(r => r.id === 'TAIL');
  eq(msg.length, 2, 'the override width is what the Field Map shows');
  eq(msg.declaredLen, 4, 'and it still reports what the DDL declared');
  eq(tail.offset, 2, 'so TAIL is re-laid out to where the parse will read it');
  eq(bytesCase({ type: 'hex-char', bytes: 2 }).fields.find(f => f.id === 'TAIL').startByte,
     tail.offset, 'the two surfaces agree on where TAIL starts');
});

// ── The length decode follows the declared type, not the byte values ────────
// Reported: LEN bytes 0x37 0x45 decoded as 14149 (correct), and the SAME field
// trimmed to one byte decoded as 7 instead of 55. Nothing about the field
// changed except its width — 0x37 alone is the ASCII digit "7", so it fell down
// the other side of a guess made from byte values. The hex-char override says
// which it is, and the decoder was not reading it.

console.log('\nlength decode honours a type override');

// CHANGED ON PURPOSE (v1.2.4.1). These asserted hex-char meant "read the bytes as
// a number" — 0x37 → 55. That made hex-char answer two different questions at
// once, and the LEN column then disagreed with the value column by design: the
// row showed "37" and the parse used 55. hex-char now means what it says — the
// value IS the hex characters, so the length is 37 — and uint8/uint16-be/binary
// are how you ask for the numeric conversion.

test('a LEN of "37" counting DIGITS is 19 wire bytes of payload', () => {
  // EMV.LEN is PIC X(2). It used to read ONE byte, because hex-char re-read the
  // declared 2 as characters — the width moved as a side effect of the reading.
  // Now the width is asked for: `bytes: 1`. It shows "37", and with `count`
  // saying digits, 37 digits of payload is ceil(37/2) = 19 bytes.
  const ctx = vlgRun([0x37, 0x45], 60,
    { 'EMV.LEN': { type: 'hex-char', bytes: 1, count: 'digits' } });
  const len  = ctx.fields.find(f => f.id === 'EMV.LEN');
  const data = ctx.fields.find(f => f.id === 'EMV.DATA');
  eq(len.valueLength, 1, 'the width comes from the bytes override, not the type');
  eq(len.value, '37', 'shown as its hex spelling');
  eq(data.valueLength, 19, '37 digits of payload = 19 wire bytes');
  eq(data.startByte, len.endByte + 1, 'and it starts right after the LEN');
});

test('ignore suppresses the automatic "-LEN" guess for ONE field', () => {
  // Reported: a group whose first leaf ends in -LEN is made variable-length by a
  // built-in rule, and it may not be one. The only off-switch was
  // vlg_identifier:"" — which turns the guess off for the WHOLE DDL, taking
  // every genuine LLVAR with it.
  S.ddlTree = { V: { S: { D: `DEF R.
  02 AMT.
    04 AMT-LEN PIC X(2).
    04 AMT-VAL PIC X(6).
  02 TAIL PIC X(4).
END R.
` } } };
  S.inputFormat = 'hex';
  //           A M T - L E N   |  A M T - V A L      |  T A I L
  const bytes = Uint8Array.from([0x30,0x32, 0x30,0x30,0x30,0x31,0x32,0x33, 0x54,0x41,0x49,0x4C]);
  const run = ov => meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/R'],
    ...(ov ? { overrides: ov } : {}), parse_spec_binary: [{ 'read-ddl': 'ANY' }] }, bytes);
  const at = (ctx, id) => (ctx.fields.find(f => f.id === id) || {}).startByte;

  // The guess fires: AMT-LEN reads "02", so AMT-VAL takes 2 of its declared 6
  // and TAIL slides up to 4.
  const guessed = run(null);
  eq(at(guessed, 'TAIL'), 4, 'the built-in rule frames the group by AMT-LEN');

  // Ignore, and the group is fixed-width again: AMT-VAL takes its declared 6.
  const ignored = run({ AMT: { vlg: false } });
  eq(at(ignored, 'TAIL'), 8, 'ignored on the GROUP — TAIL lands where the DDL puts it');

  // The button targets a group's first leaf, so an ignore can land on either id.
  const onLeaf = run({ 'AMT.AMT-LEN': { vlg: false } });
  eq(at(onLeaf, 'TAIL'), 8, 'ignored on the LEAF works the same way');

  // Discriminating half: a genuine length source elsewhere is untouched.
  const still = run({ AMT: { vlg: true, count: 'bytes' } });
  eq(at(still, 'TAIL'), 4, 'an explicit VLG still frames the group');
});

test('an ignored field is rendered as a decision, not as an empty cell', () => {
  // vlg:false is falsy, so every truthiness check treats it as "nothing set".
  // Without a rendering of its own an ignore looks exactly like a field nobody
  // touched — you would press it and see no change at all.
  const chips = meOvlChips({ vlg: false });
  assert.ok(chips.some(c => /not a length source/i.test(c)),
    `the overrides list says so, got: ${JSON.stringify(chips)}`);
  // And the Field Map marks it distinctly from both a source and a blank. The
  // rule lives in the stylesheet, which is outside <script id="app">.
  assert.ok(/me-fm-vlg-off/.test(APP_SRC), 'the renderer emits the class');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const rule = (css.match(/\.me-fm-vlg-off\s*\{([^}]*)\}/) || [, ''])[1];
  assert.ok(rule, 'the Field Map has a style for a suppressed guess');
  assert.ok(/line-through/.test(rule),
    `struck through, so it reads as "this WOULD have been a length source", got: ${rule}`);
});

test('selecting a field brings its override entry into view', () => {
  // Reported: click a field that has an override and nothing appears to happen
  // in the Overrides list. The `sel` class was applied — but the list is capped
  // at 180px and sorted by id, so the highlighted row was usually below the fold.
  const fn = psFnSource('_meOvlRefresh');
  assert.ok(/\.me-ovl-row\.sel/.test(fn), 'it looks for the selected row');
  assert.ok(/scrollIntoView/.test(fn), 'and scrolls it into view');
  assert.ok(/block:\s*'nearest'/.test(fn),
    "'nearest' — an already-visible row must not make the list jump");
  // The two directions share one handler, so the table drives the list as well.
  const rowHtml = psFnSource('_meFmRowHtml');
  assert.ok(/_meOvlRowClick/.test(rowHtml), 'a Field Map row click goes through the same funnel');
  assert.ok(/_meOvlRefresh\(\)/.test(psFnSource('_meOvlRowClick')), 'which refreshes the list');
});

test('the VLG button is a picker, and its three options are the three states', () => {
  // It used to set vlg:true silently, which asked no question at the one moment
  // the question matters — bytes or digits — and offered no way to say "no".
  const ed = APP_SRC.slice(APP_SRC.indexOf("'vlg':       {"), APP_SRC.indexOf("'type':      {"));
  assert.ok(/kind:\s*'sel'/.test(ed), 'it opens the select editor, not a silent toggle');
  for (const opt of ['bytes', 'digits', 'ignore'])
    assert.ok(new RegExp(`'${opt}'`).test(ed), `the picker offers ${opt}`);
  assert.ok(/o\.vlg = false/.test(ed), 'ignore stores an explicit false');
  assert.ok(/o\.count = v/.test(ed), 'the other two store the unit');
  // The old silent toggle must be gone, or the button would have two behaviours.
  const act = psFnSource('_meFmAct');
  assert.ok(!/case 'vlg'/.test(act), 'no dead toggle branch left behind');
  assert.ok(/_ME_FM_ED\[act\]/.test(act), 'and the dispatcher routes it to the editor');
});

test('the unit is INDEPENDENT of how the length was read', () => {
  // The gap this closes: `count` used to be inferred from the LEN's own type
  // being hex-char, so "a binary length in front of hex-char data, counting
  // digits" could not be expressed at all. The type and the unit are now free.
  const run = (type, count, lenBytes) =>
    vlgRun(lenBytes, 60, { 'EMV.LEN': { type, bytes: 1, count } })
      .fields.find(f => f.id === 'EMV.DATA').valueLength;
  // 0x0C read as a binary integer is 12.
  eq(run('uint-be', 'bytes',  [0x0C, 0x45]), 12, 'binary length, counting bytes');
  eq(run('uint-be', 'digits', [0x0C, 0x45]),  6, 'the SAME binary length, counting digits');
  // 0x12 read as its hex spelling is also 12 — same number, different reading.
  eq(run('hex-char', 'bytes',  [0x12, 0x45]), 12, 'hex spelling, counting bytes');
  eq(run('hex-char', 'digits', [0x12, 0x45]),  6, 'hex spelling, counting digits');
});

test('an absent count means bytes, which is what every non-hex-char LEN did', () => {
  const n = vlgRun([0x0C, 0x45], 60, { 'EMV.LEN': { type: 'uint-be', bytes: 1 } })
    .fields.find(f => f.id === 'EMV.DATA').valueLength;
  eq(n, 12, 'no count stated → bytes');
});

test('the SAME bytes counted two ways give two payload sizes', () => {
  // The pair that was impossible before: one reading of the number, two units.
  // Only `count` differs between these two, and DATA is PIC X(20) so both fit —
  // no capping to muddy the comparison.
  const run = count => {
    const ctx = vlgRun([0x12, 0x45], 60,
      { 'EMV.LEN': { type: 'hex-char', bytes: 1, count } });
    return ctx.fields.find(f => f.id === 'EMV.DATA').valueLength;
  };
  eq(run('digits'), 6,  '"12" as digits is ceil(12/2) = 6 bytes');
  eq(run('bytes'), 12, 'the same "12" as bytes is 12');
});

test('uint8 on the same byte is 55 — that is the type that converts', () => {
  // The other half of the rule: asking for the numeric reading still gets it.
  const ctx = vlgRun([0x37, 0x45], 60, { 'EMV.LEN': { bytes: 1, type: 'uint8' } });
  assert.ok(/length 55 /.test(ctx.fields.find(f => f.id === 'EMV.LEN').issue || ''),
    'uint8 reads the byte as a number');
});

test('without the override the same byte is still read as the digit 7', () => {
  // Discriminating half: if the type were ignored again, every case gives 7.
  const ctx = vlgRun([0x37, 0x45], 60, { 'EMV.LEN': { bytes: 1 } });
  eq(ctx.fields.find(f => f.id === 'EMV.DATA').valueLength, 7,
     'the byte-value guess still applies when nothing declares the type');
});

test('two wire bytes read as hex-char spell 3745', () => {
  // PIC X(2) is two bytes, and hex-char spells them "3745". The width needs no
  // override at all now — under v1.2.5.0 the same field bought only ONE byte and
  // you had to ask for 4 to get 2 back.
  const iss = c => (c.fields.find(x => x.id === 'EMV.LEN').issue || '');
  assert.ok(/length 3745 digit/.test(iss(vlgRun([0x37, 0x45], 60,
      { 'EMV.LEN': { type: 'hex-char', count: 'digits' } }))),
    'hex-char: the characters "3745", counted as digits');
  assert.ok(/length 14149 /.test(iss(vlgRun([0x37, 0x45], 60, { 'EMV.LEN': { type: 'uint16-be' } }))),
    'uint16-be: the number 0x3745, and its length is already in bytes');
  assert.ok(/length 14149 /.test(iss(vlgRun([0x37, 0x45], 60))),
    'undeclared: the old guess, unchanged');
});

test('hex characters that are not decimal are reported, not silently misread', () => {
  // 0x4E spells "4e". parseInt("4e", 10) is 4 — a plausible length from bytes
  // that cannot be a hex-char number at all.
  const ctx = vlgRun([0x4E], 60, { 'EMV.LEN': { bytes: 1, type: 'hex-char' } });
  const len = ctx.fields.find(f => f.id === 'EMV.LEN');
  assert.ok(/"4e" is not a decimal number/.test(len.issue || ''),
    `expected the a-f complaint, got: ${JSON.stringify(len.issue)}`);
  assert.ok(!/is empty/.test(len.issue), 'and not the "no bytes left" message');
});

test('the "read as" wording follows the branch actually taken', () => {
  const ctx = vlgRun([0x37], 60, { 'EMV.LEN': { bytes: 1, type: 'hex-char' } });
  const issue = ctx.fields.find(f => f.id === 'EMV.LEN').issue || '';
  assert.ok(!/read as digits/.test(issue),
    `must not claim digits for bytes forced through as an integer: ${issue}`);
});

// ── The payload's borrowed LEN must match the LEN's own row ─────────────────
// Reported from a hex-char LEN: the LEN row showed "37" and the payload row
// showed "7" for the same byte, one line apart. The children borrowed `lValue`,
// captured as raw characters BEFORE the type override was applied to the LEN
// row, so the override reached one rendering of that byte and not the other.

console.log('\nthe payload shows the LEN the way the LEN row does');

test('a hex-char LEN is prefixed to the payload as "37", not as "7"', () => {
  const ctx = vlgRun([0x37, 0x45], 60, { 'EMV.LEN': { bytes: 1, type: 'hex-char' } });
  const len  = ctx.fields.find(f => f.id === 'EMV.LEN');
  const data = ctx.fields.find(f => f.id === 'EMV.DATA');
  eq(len.value, '37', 'the LEN row shows its hex spelling');
  eq(data.lenPrefix, len.value, 'and the payload borrows exactly that');
});

test('the borrowed prefix does not bill the LEN byte to the payload', () => {
  // The LEN has its own row, already 1 byte in its own LEN column. Counting it
  // again on the payload double-bills the byte; counting the STRING bills "37"
  // as two bytes for one.
  const ctx = vlgRun([0x37, 0x45], 60, { 'EMV.LEN': { bytes: 1, type: 'hex-char' } });
  const data = ctx.fields.find(f => f.id === 'EMV.DATA');
  const html = renderRows([data]);
  const lenCell = html.match(/<td class="c-len">(\d*)<\/td>/);
  assert.ok(lenCell, 'the row has a LEN cell');
  eq(lenCell[1], String(data.valueLength), 'the LEN column is the payload alone');
  assert.ok(html.includes('>37<'), 'while the prefix is still shown beside the value');
});

test('an LLVAR prefix IS still counted — it belongs to that field', () => {
  // The discriminating half. LLVAR's prefix is part of the field's own bytes and
  // has no row of its own, so dropping it from every length would be the same
  // bug pointed the other way.
  const html = renderRows([{ id: 'PAN', dataType: 'LLVAR', valueLength: 5,
                             value: 'ABCDE', lenPrefix: '05' }]);
  const lenCell = html.match(/<td class="c-len">(\d*)<\/td>/);
  eq(lenCell[1], '7', 'five payload bytes plus the two-character prefix');
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

test('de:true forces a field in, and its group yields', () => {
  // Changed deliberately 2026-08-05: this used to assert the group kept its own
  // DE. It cannot — ADDITIONA being one element while FIELD-YY inside it is
  // another is a contradiction, and the table showed both.
  const r = deselRows({ 'ADDITIONA.FIELD-YY': { de: true } });
  eq(deAt(r, 'ADDITIONA'), null, 'the group can no longer be a single element');
  eq(deAt(r, 'ADDITIONA.FIELD-XX'), 5, 'so its siblings own DEs too');
  eq(deAt(r, 'ADDITIONA.FIELD-YY'), 6, 'and the named field owns one');
  eq(deAt(r, 'SOME'), 7, 'the tail continues from there');
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

// ── A group's DE belongs to everything inside it ───────────────────────────
// Bit N reads every leaf under the group that owns DE N, so those rows DO belong
// to a data element — they just do not own one. They rendered blank, which made
// the membership invisible.

const derived = (rows, id) => { const r = rows.find(x => x.id === id) || {}; return r.ownerDE; };

test('descendants of a DE-owning group carry that number', () => {
  const r = deselRows();                       // no overrides at all
  eq(deAt(r, 'ADDITIONA'), 5, 'the group owns the DE');
  eq(derived(r, 'ADDITIONA.FIELD-XX'), 5, 'its child derives it');
  eq(derived(r, 'ADDITIONA.FIELD-XX.DATA'), 5, 'and so does the grandchild');
  eq(deAt(r, 'ADDITIONA.FIELD-XX'), null, 'but neither OWNS a DE');
});

test('a deliberate number on a group applies to everything inside it', () => {
  const r = deselRows({ ADDITIONA: { de: 9 } });
  eq(deAt(r, 'ADDITIONA'), 9, 'the group is DE 9');
  eq(derived(r, 'ADDITIONA.FIELD-XX'), 9, 'FIELD-XX is part of DE 9');
  eq(derived(r, 'ADDITIONA.FIELD-YY'), 9, 'and so is FIELD-YY — the same number, not 10');
  eq(deAt(r, 'SOME'), 10, 'the counter advanced once for the group');
});

test('children numbers its children, and each owns its own', () => {
  // The other reading: ignore the group, number what is inside it in sequence.
  const r = deselRows({ ADDITIONA: { de: 'children' } });
  eq(deAt(r, 'ADDITIONA'), null, 'the group owns nothing');
  eq(deAt(r, 'ADDITIONA.FIELD-XX'), 5, 'the children own theirs');
  eq(deAt(r, 'ADDITIONA.FIELD-YY'), 6, 'in sequence');
  eq(derived(r, 'ADDITIONA.FIELD-XX'), undefined, 'an owner never derives');
  eq(derived(r, 'ADDITIONA.FIELD-XX.DATA'), 5, 'but ITS leaf derives from it');
});

test('a row that owns a DE never derives one', () => {
  const r = deselRows({ 'ADDITIONA.FIELD-YY': { de: 30 } });
  eq(deAt(r, 'ADDITIONA.FIELD-YY'), 30, 'owns 30');
  eq(derived(r, 'ADDITIONA.FIELD-YY'), undefined, 'so it does not also derive a group number');
  // The sibling OWNS one now rather than deriving: numbering FIELD-YY made the
  // group yield, which promotes every immediate child.
  eq(deAt(r, 'ADDITIONA.FIELD-XX'), 5, 'the sibling owns its own');
  eq(derived(r, 'ADDITIONA.FIELD-XX.DATA'), 5, 'and ITS leaf derives from it');
});

test('numbering something inside a group makes the group yield', () => {
  // Reported: anchoring FIELD-XX to 11 left ADDITIONA owning its DE, so FIELD-YY
  // still derived the group number and the tail numbered from the wrong place.
  const r = deselRows({ 'ADDITIONA.FIELD-XX': { de: 11 } });
  eq(deAt(r, 'ADDITIONA'), null, 'the group yields');
  eq(deAt(r, 'ADDITIONA.FIELD-XX'), 11, 'the numbered field owns it');
  eq(derived(r, 'ADDITIONA.FIELD-XX.DATA'), 11, 'its leaf belongs to 11');
  eq(deAt(r, 'ADDITIONA.FIELD-YY'), 12, 'the sibling is promoted and follows');
  eq(derived(r, 'ADDITIONA.FIELD-YY.DATA'), 12, 'with its own leaf');
  eq(deAt(r, 'SOME'), 13, 'and the tail continues');
});

test('the "was" number reflects what the row would have shown', () => {
  // It reported the raw counter, which is not what was on screen: the row was
  // displaying the number it DERIVED from its group.
  const r = deselRows({ 'ADDITIONA.FIELD-XX': { de: 11 } });
  const row = r.find(x => x.id === 'ADDITIONA.FIELD-XX');
  eq(row.naturalDE, 5, 'the slot the group would have occupied, not the counter past it');
});

test('a leaf inside a terminal group still shows the DE it belongs to', () => {
  // It had the number all along — the cell returned early for underTerminal rows
  // and never drew it, so the deepest rows rendered blank.
  const ctx = { ea: s => String(s), usesBitmapFields: true, foByField: new Map() };
  const cell = meFmDeCellHtml({ id: 'G.X.DATA', de: null, ownerDE: 9, ownerId: 'G',
                                underTerminal: true }, ctx);
  assert.ok(/>DE 9</.test(cell), `drawn in the same "DE n" form as an owned row, got: ${cell}`);
  assert.ok(/me-fm-de-owned/.test(cell), 'as a derived one');
});

test('the DE cell renders a derived number distinctly from an owned one', () => {
  // Same digit, different meaning: one row owns the element, the other is part
  // of it. Rendering them identically would be worse than rendering nothing.
  const ctx = { ea: s => String(s), usesBitmapFields: true, foByField: new Map() };
  const owned   = meFmDeCellHtml({ id: 'ADDITIONA', de: 9, isGroup: true }, ctx);
  const derivedCell = meFmDeCellHtml({ id: 'ADDITIONA.FIELD-XX', de: null, ownerDE: 9,
                                       ownerId: 'ADDITIONA' }, ctx);
  assert.ok(/>DE 9</.test(derivedCell), 'shown as "DE 9", the same form an owned row uses');
  assert.ok(/me-fm-de-owned/.test(derivedCell), 'with the derived class');
  assert.ok(!/me-fm-de-owned/.test(owned), 'which the owning row does not carry');

  // The class has to keep DIMMING the text — that fade is the only thing telling
  // an inherited number apart from one the row owns, now that both read "DE n".
  const css = html;  // the fade is CSS, so `html` and not APP_SRC

  // The fade goes on the TEXT. `opacity` on the <td> fades everything the cell
  // paints, including the background the row set on it (selection, error, warn),
  // so an inherited row showed a washed-out patch where its row colour should be.
  assert.ok(/class="me-fm-de-inh"/.test(derivedCell),
    `the number is wrapped so only it fades, got: ${derivedCell}`);
  const inh = css.match(/\.me-fm-de-inh\{([^}]*)\}/);
  assert.ok(inh && /opacity\s*:/.test(inh[1]), `.me-fm-de-inh fades the text, got: ${inh && inh[1]}`);
  assert.ok(!/\.me-fm-de-owned[^{}]*\{[^}]*opacity\s*:/.test(css),
    'nothing puts opacity on the cell itself — that would fade the row background with it');

  // Whatever styles the cell must also WIN. `.me-fm-de{color:…}` sits ~70 lines
  // below `.me-fm-de-owned`; as a lone class the owned rule lost the cascade to
  // that later rule of equal weight and rendered nothing at all, so four rounds
  // of tuning its value changed the file and never the pixels.
  const ownedRule = css.match(/([^\s{}]*\.me-fm-de-owned)\{([^}]*)\}/);
  if (ownedRule && /color\s*:/.test(ownedRule[2])) {
    const baseIdx  = css.indexOf('.me-fm-de{');
    const classes  = (ownedRule[1].match(/\./g) || []).length;
    assert.ok(classes > 1 || css.indexOf(ownedRule[0]) > baseIdx,
      `.me-fm-de-owned sets a colour but neither out-specifies nor follows `
      + `.me-fm-de, so it never renders (selector "${ownedRule[1]}")`);
  }
  assert.ok(/Part of DE 9, owned by ADDITIONA/.test(derivedCell), 'and a tooltip saying whose it is');
});

test('the derived number is part of the DE cell signature', () => {
  // All these rows have de === null, so without the owner in the signature a
  // patch-only repaint would keep showing the previous group's number.
  const ctx = { ea: s => String(s), usesBitmapFields: true, foByField: new Map() };
  const a = meFmDeCellHtml({ id: 'X.A', de: null, ownerDE: 9,  ownerId: 'X' }, ctx);
  const b = meFmDeCellHtml({ id: 'X.A', de: null, ownerDE: 10, ownerId: 'X' }, ctx);
  const sig = h => (h.match(/data-sig="([^"]*)"/) || [])[1];
  assert.ok(sig(a) !== sig(b), `signatures must differ, got ${sig(a)} and ${sig(b)}`);
});

test('a DE number makes the field a data element, wherever it sits', () => {
  // Reported: FIELD-XX had a DE, anchoring it to 14 was accepted into the list,
  // and the table ignored it. You cannot number something that is not a data
  // element, so a number has to say that it IS one — the code treated it purely
  // as "renumber from here" and left eligibility to the default rule.
  eq(deAt(deselRows({ 'ADDITIONA.FIELD-XX': { de: 14 } }), 'ADDITIONA.FIELD-XX'), 14,
     'a nested field the default rule excludes');
  eq(deAt(deselRows({ 'ADDITIONA': { de: false }, 'ADDITIONA.FIELD-XX': { de: 14 } }), 'ADDITIONA.FIELD-XX'), 14,
     'even below a group that was excluded');
  const both = deselRows({ 'ADDITIONA': { de: 'children' }, 'ADDITIONA.FIELD-XX': { de: 14 } });
  eq(deAt(both, 'ADDITIONA.FIELD-XX'), 14, 'and it wins over the promoted number');
  eq(deAt(both, 'ADDITIONA.FIELD-YY'), 15, 'with the tail following from it');
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
  const missing = ['.me-tab-body', '.me-fm-table-wrap', '.me-fm-pane pre']
    .filter(sel => !/scrollbar-gutter:\s*stable/.test(rule(sel)));
  deepEq(missing, [], 'scrolling containers with no reserved gutter');
  // The overrides list is the deliberate exception: its rows have a background,
  // so a permanently reserved strip reads as a gap on every one of them.
  assert.ok(!/scrollbar-gutter/.test(rule('.me-ovl-list')),
    'the overrides list must NOT reserve a gutter');
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

test('a bytes value equal to the declared length stores no override', () => {
  // Reported: typing the length the field already has added an entry to the
  // overrides list while the table stayed identical — because there was nothing
  // to change. An entry that has no effect on the parse is a lie about it.
  const cfg = html.slice(html.indexOf('const _ME_FM_ED'), html.indexOf('let _meFmEdAct'));
  const bytes = cfg.slice(cfg.indexOf("'bytes':"), cfg.indexOf("'type':"));
  assert.ok(/noop:\s*\(row, v\) =>/.test(bytes), 'bytes declares a no-op test');
  assert.ok(/declaredLen\s*\?\?\s*row\?\.length/.test(bytes),
    'compared against the DECLARED length, not the effective one');
  assert.ok(/clear:\s*o\s*=>\s*\{\s*delete o\.bytes/.test(bytes),
    'and setting it back to declared removes an existing override');
  // The commit path has to consult it, per field — a multi-selection can hold
  // fields of different declared widths.
  const commit = psFnSource('_meFmEdCommit');
  assert.ok(/cfg\.noop\(rowsById\.get\(qn\), v\)/.test(commit),
    'the no-op test is applied per selected field');
  assert.ok(/_meFlash\(/.test(commit), 'and it says so rather than doing nothing silently');
});

test('the overrides list labels every de form, not just numbers', () => {
  // The de key carries four different things and only one is a number, so
  // string concatenation produced "DE-false" and "DE-children" in the list.
  deepEq(meOvlChips({ de: 7 }),          ['DE-7'],             'an anchor');
  deepEq(meOvlChips({ de: false }),      ['not a DE'],         'excluded');
  deepEq(meOvlChips({ de: true }),       ['is a DE'],          'forced in');
  deepEq(meOvlChips({ de: 'children' }), ['DEs on children'],  'yielded to children');
});

test('the overrides list distinguishes the two vlg readings', () => {
  // true on a leaf means "sizes the next field"; a string on a group names the
  // LEN sub-field. One chip for both said nothing about which.
  deepEq(meOvlChips({ vlg: true }),          ['length source'], 'a leaf length source');
  deepEq(meOvlChips({ vlg: 'EMV.LEN' }),     ['VLG → LEN'],     'a group naming its LEN');
});

test('the DE-clear button clears the list and the panes, not only the table', () => {
  // It refreshed the table alone, so the list went on showing DE chips for
  // overrides that no longer existed.
  const src = psFnSource('_meFmClearDEs');
  assert.ok(/_meFmAfterAct\(\)/.test(src), 'goes through the shared refresh funnel');
  assert.ok(!/_meFmPatchDECells\(\)/.test(src), 'not the table-only path');
  // And it counts what it will actually remove — every de form, not just anchors.
  assert.ok(/all\[id\]\.de !== undefined/.test(src),
    'the count covers the selection forms too, not only anchors');
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
    assert.ok(new RegExp(`'${act}':[\\s\\S]{0,500}?def: \\(\\) =>`).test(cfg),
      `${act} computes its default from the selection`);
});

test('typing the declared length back REMOVES the override, and does not warn', () => {
  // Reported: with bytes:2 stored, typing 4 was refused with "already declared
  // as 4". The clear did run, but the warning fired anyway, so removing an
  // override was indistinguishable from being told no. The no-op case has to be
  // "there was nothing here to undo", not "the number matches".
  const src = psFnSource('_meFmEdCommit');
  assert.ok(/cfg\.has\(all\[k\]\)/.test(src),
    'the commit asks whether an override was actually there');
  assert.ok(/cleared\+\+/.test(src) && /noops\+\+/.test(src),
    'and counts a removal separately from a no-op');
  // The two messages must not be the same one: removing an override is not a
  // refusal, so it cannot flash 'warn'.
  const removed = src.slice(src.indexOf('if (cleared)'), src.indexOf('if (noops)'));
  assert.ok(/'ok'/.test(removed), `a removal reports success, got: ${removed}`);
  assert.ok(!/no override stored/.test(removed), 'and does not claim nothing was stored');
  // An emptied entry is deleted rather than left as {} in the overrides list.
  assert.ok(/delete all\[k\]/.test(src), 'an entry with nothing left in it is removed');
});

test('the bytes editor opens on the number that was typed in, not the wire width', () => {
  // A hex-char field showing 2 wire bytes was written as 4 characters. Offering
  // 2 would ask the user to re-type a number in units they never used.
  const cfg = html.slice(html.indexOf("'bytes':"), html.indexOf("'type':"));
  assert.ok(/o\?\.bytes \?\? r\?\.declaredLen \?\? r\?\.length/.test(cfg),
    `the stored override wins, then the declared number, then the width: ${cfg}`);
});

test('a length override is labelled in bytes, whatever the type', () => {
  // Reported: SDLC-DEST PIC X(2) with hex-char and a 4 override showed a chip
  // reading "4 bytes" and a LEN column reading 2, so a working override looked
  // like it had done nothing. It was characters against bytes. There is one unit
  // now, so the chip and the column cannot disagree.
  for (const ov of [{ type: 'hex-char', bytes: 4 }, { bytes: 4 }, { type: 'ascii', bytes: 4 }])
    eq(meOvlChips(ov).find(c => /4/.test(c)), '4 bytes',
       `every type labels a width in bytes, failed on ${JSON.stringify(ov)}`);
});

test('a width override is visible in the LEN column', () => {
  // The original report: an override that looked like it had done nothing,
  // because 4 characters IS 2 wire bytes and the column compared bytes against
  // the DDL's number. Four bytes against a declared two now differ outright.
  S.ddlTree = { V: { S: { D: DDL_BYTES } } };
  const rowsFor = ov => meWalkDEFields(getDDLFromPath('V/S/D/REC').defs,
    { ddl_bindings: ['V/S/D/REC'], overrides: { TAIL: ov } }).find(r => r.id === 'TAIL');

  const hex = rowsFor({ type: 'hex-char', bytes: 4 });
  eq(hex.length, 4, 'four bytes were asked for and four are read');
  eq(hex.lenWritten, 4, 'the override is four');
  eq(hex.declaredLen, 2, 'against a declared two');
  const rowCtx = { ea: x => String(x), vlgMap: new Map(), foByField: new Map(),
                   usesBitmapFields: false, leavesByGroup: new Map() };
  const lenCell = (meFmRowHtml(hex, rowCtx, { n: 0 })
    .match(/<td class="me-fm-len"[^>]*>(.*?)<\/td>/) || [, ''])[1];
  assert.ok(/↩/.test(lenCell), `the LEN column annotates it, got: ${lenCell}`);
  assert.ok(/>2</.test(lenCell) && /4/.test(lenCell), 'declared 2 ↩ effective 4');

  // A type alone changes nothing, so there is nothing to annotate.
  const typeOnly = rowsFor({ type: 'hex-char' });
  eq(typeOnly.length, 2, 'the declared width is untouched by the type');
  eq(typeOnly.lenWritten, undefined, 'and no width was written');

  const plain = rowsFor({ bytes: 4 });
  eq(plain.lenWritten, 4, 'a plain bytes override is unchanged');
  eq(plain.length, 4, 'and its wire width IS the number written');
});

test('the Field Map puts Type/Len before Bytes, and the cells follow the header', () => {
  // A header order that does not match the cell order is the kind of thing that
  // looks fine until a column is hidden and everything shifts one to the left.
  const _h = APP_SRC.indexOf('me-fm-th-num');
  const head = APP_SRC.slice(_h, APP_SRC.indexOf('</thead>', _h));
  const order = [...head.matchAll(/data-col="(\w+)"/g)].map(m => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);   // each col appears twice: th + resizer
  eq(order.join(','), 'num,fld,off,dt,len,de,vlg', 'header order');
  const row = psFnSource('_meFmRowHtml');
  const cells = row.slice(row.lastIndexOf('return `<tr'));
  const cellOrder = [...cells.matchAll(/\$\{(\w+)Cell\}/g)].map(m => m[1]);
  eq(cellOrder.join(','), 'num,field,off,dt,len,de,vlg', 'cells match it');
});

test('the length columns are named for what they hold, in both tables', () => {
  // "Len" said nothing about which unit. The Field Map's number is the type's
  // own — characters for hex-char — and the byte column is wire bytes.
  assert.ok(/data-col="dt"[^>]*>Type-Len</.test(html), 'Field Map: Type-Len');
  assert.ok(/data-col="len"[^>]*>Bytes</.test(html),    'Field Map: Bytes');
  assert.ok(/class="th-len"[^>]*>Bytes</.test(html),    'Parse Results: Bytes');
  assert.ok(/class="th-desc"[^>]*>Type-Len \/ Description</.test(html),
    'Parse Results: Type-Len / Description');
  assert.ok(!/data-col="len"[^>]*>Len</.test(html) && !/class="th-len"[^>]*>Len</.test(html),
    'and nothing still says a bare "Len"');
  const menu = html.slice(html.indexOf("['num', '#']"), html.indexOf("['num', '#']") + 200);
  assert.ok(/'dt', 'Type-Len'/.test(menu) && /'len', 'Bytes'/.test(menu),
    `the column menu uses the same names: ${menu}`);
});

test('the row numbers are right-justified and the header is not', () => {
  // Two rules set text-align on the same cell — `td.me-fm-num{left}` beat
  // `.me-fm-num{right}` on specificity, so the column read left while the CSS
  // said right. Only one rule may own it.
  const aligns = [...html.matchAll(/([^{}\n]*\bme-fm-num\b[^{}\n]*)\{([^}]*)\}/g)]
    .filter(m => /text-align/.test(m[2]))
    .map(m => [m[1].trim(), (m[2].match(/text-align:\s*(\w+)/) || [])[1]]);
  eq(aligns.length, 1, `exactly one rule aligns the cell, got: ${JSON.stringify(aligns)}`);
  eq(aligns[0][1], 'right', 'and it right-justifies');
  // The header keeps the table's centred default — the ask was the text, not
  // the title.
  const th = html.match(/\.me-fm-th-num\{([^}]*)\}/);
  assert.ok(th && !/text-align/.test(th[1]), `the header sets no alignment: ${th && th[1]}`);
  assert.ok(/\.me-fm-table th\{[^}]*text-align:center/.test(html),
    'so it inherits the centred header rule');
});

test('both tables share ONE column-highlight implementation', () => {
  // Copying the Field Map's behaviour into Parse Results by duplicating it is
  // how the two would drift — which is the shape of most of what broke today.
  const src = psFnSource('_meInitColHighlight') + psFnSource('_meApplyColHighlight');
  assert.ok(/sel \+ ' thead'/.test(src), 'the implementation takes a table selector');
  assert.ok(/\.me-fm-resizer,\.th-resize/.test(src),
    "and opts out of BOTH tables' resize handles, so dragging is not selecting");
  assert.ok(/_meColHi\.set\(sel/.test(src) && /_meColHi\.get\(sel/.test(src),
    'each table remembers its own column');
  // Parse Results replaces its innerHTML every render, so the binding has to be
  // re-established there or the header goes dead after the first parse.
  assert.ok(/_meInitColHighlight\('#resContainer table'\)/.test(APP_SRC),
    'Parse Results re-binds after each render');
});

test('every _me* symbol the app references is actually declared', () => {
  // Deleting `_meFmColHi` while one line still read it left the Field Map's
  // column highlight dead, and the whole suite stayed green: the reference sits
  // inside a function the tests never call, so nothing threw. A ReferenceError
  // in a UI handler is invisible to a suite that tests logic.
  const declared = new Set();
  for (const m of APP_SRC.matchAll(/(?:function|class)\s+(_me[A-Za-z0-9_$]*)/g)) declared.add(m[1]);
  // const/let/var take a comma-separated LIST — `let a = 1, b = 2` declares both.
  for (const m of APP_SRC.matchAll(/(?:const|let|var)\s+([^;\n]+)/g))
    for (const n of m[1].matchAll(/(?<![.\w$])(_me[A-Za-z0-9_$]*)\s*(?:[=,]|$)/g)) declared.add(n[1]);
  for (const m of APP_SRC.matchAll(/(_me[A-Za-z0-9_$]*)\s*[:=]\s*(?:function|\()/g)) declared.add(m[1]);

  const used = new Set();
  for (const m of APP_SRC.matchAll(/(?<![.\w$])(_me[A-Za-z0-9_$]*)/g)) used.add(m[1]);
  const missing = [...used].filter(n => !declared.has(n)).sort();
  assert.deepStrictEqual(missing, [],
    `referenced but never declared — a rename or deletion left these behind: ${missing.join(', ')}`);
});

// ── The text export lines up ────────────────────────────────────────────────
// The old writer padded with `.slice(0, n).padEnd(n)`, so a value exactly as
// long as its column kept no trailing space and ran straight into the next one:
// "SDLC-ORIGISDLC-ORIGIN". Anything longer was cut. Widths now come from the
// content, capped, and what does not fit wraps instead of colliding or vanishing.

console.log('\nthe text export lines up');

const expMsg = fields => ({ msgType: { type: 'HPDH' }, ddlPath: 'HPDHDDLS/REQMSG',
                            bytes: { length: 64 }, fields });

test('a cell that fills its column still keeps the gutter', () => {
  const lines = expMsgLines(expMsg([
    { id: 'SDLC-ORIGIN', description: 'SDLC-ORIGIN', value: '51B8', rawHex: '51B8' },
    { id: 'A',           description: 'B',           value: 'C',    rawHex: 'D' },
  ]), 0);
  const row = lines.find(l => /^SDLC-ORIGIN/.test(l));
  assert.ok(/^SDLC-ORIGIN\s\s+SDLC-ORIGIN/.test(row),
    `the two columns are separated, got: ${JSON.stringify(row)}`);
});

test('nothing is silently truncated — long content wraps and is marked', () => {
  const long = '4500000001000000333435363738393131323334353637383931313233343536373839';
  const lines = expMsgLines(expMsg([{ id: 'PAN', description: 'PAN', value: long, rawHex: 'AA' }]), 0);
  const joined = lines.join('\n');
  // Every character survives, in order, once the wrap marks and padding are out.
  // Read the VALUE column out by its own boundaries — reassembling the whole
  // line would splice Raw Hex into the middle of it, which is exactly the
  // alignment this test is here to prove.
  const head  = lines.find(l => /^Field\s/.test(l));
  const from  = head.indexOf('Value');
  const to    = head.indexOf('Raw Hex');
  const body  = lines.slice(lines.findIndex(l => /^-+$/.test(l)) + 1);
  const back  = body.map(l => l.slice(from, to).replace(/\s*¬\s*$/, '').trim()).join('');
  eq(back, long, `the whole value survives the wrap, got:\n${joined}`);
  assert.ok(/¬/.test(joined), 'and a break is marked, never mistaken for the value');
});

test('a wrapped cell does not disturb the columns beside it', () => {
  const long = 'x'.repeat(120);
  const lines = expMsgLines(expMsg([
    { id: 'PAN', description: long, value: 'V', rawHex: 'H' },
    { id: 'NEXT', description: 'D', value: 'V2', rawHex: 'H2' },
  ]), 0);
  const body = lines.slice(lines.findIndex(l => /^-+$/.test(l)) + 1).filter(Boolean);
  const at = l => l.indexOf('V2');
  const nextRow = body.find(l => /^NEXT/.test(l));
  // Every line is at most one full table width — no line runs long.
  const rule = lines.find(l => /^=+$/.test(l)).length;
  for (const l of lines) assert.ok(l.length <= rule, `line within the rule: ${l.length} > ${rule}`);
  assert.ok(at(nextRow) > 0, 'the row after a wrapped one still has its columns');
});

test('the rule spans the whole table, not just the header', () => {
  const lines = expMsgLines(expMsg([
    { id: 'F'.repeat(40), description: 'D'.repeat(40), value: 'V'.repeat(40), rawHex: 'H'.repeat(40) },
  ]), 0);
  const rule = lines.find(l => /^=+$/.test(l));
  const widest = Math.max(...lines.map(l => l.length));
  eq(rule.length, widest, 'the ==== line is as wide as the widest content line');
  assert.ok(lines.some(l => /^-+$/.test(l) && l.length === rule.length),
    'and the ---- under the header matches it');
});

test('the columns the user turned off do not appear', () => {
  const f = [{ id: 'A', description: 'DESC', value: 'VAL', rawHex: 'BEEF' }];
  const on = expMsgLines(expMsg(f), 0).join('\n');
  assert.ok(/DESC/.test(on) && /BEEF/.test(on), 'both present by default');
  storage.setItem('up_msg_export_cols', JSON.stringify({ desc: true, hex: true }));
  try {
    const off = expMsgLines(expMsg(f), 0).join('\n');
    assert.ok(!/DESC/.test(off) && !/BEEF/.test(off), 'hidden columns are gone');
    assert.ok(/VAL/.test(off), 'and the remaining ones still print');
  } finally { storage.removeItem('up_msg_export_cols'); }
});

test('the export carries the Bytes column, counted like the LEN column', () => {
  // The chooser shipped with Field / Description / Value / Raw Hex and no width
  // at all, so the file could not answer "how many bytes was that" — the one
  // question the table beside it answers.
  const lines = expMsgLines(expMsg([
    { id: 'A',   description: 'D', valueLength: 4, value: 'ABCD', rawHex: '41424344' },
    // An LLVAR prefix belongs to its field, so it counts...
    { id: 'PAN', description: 'D', valueLength: 5, value: 'ABCDE', rawHex: 'AA', lenPrefix: '05' },
    // ...but a VLG group's LEN has its own row and must not be billed twice.
    { id: 'EMV.DATA', description: 'D', valueLength: 5, value: 'ABCDE', rawHex: 'AA',
      lenPrefix: '37', lenPrefixOwnRow: true },
  ]), 0);
  const head = lines.find(l => /^Field\s/.test(l));
  assert.ok(/Bytes/.test(head), `the column is there: ${head}`);
  const col = l => l.slice(head.indexOf('Bytes'), head.indexOf('Value')).trim();
  eq(col(lines.find(l => /^A\s/.test(l))),        '4', 'its own width');
  eq(col(lines.find(l => /^PAN\s/.test(l))),      '7', 'plus an LLVAR prefix that belongs to it');
  eq(col(lines.find(l => /^EMV.DATA/.test(l))),   '5', 'but not a LEN that has its own row');
});

test('the export column chooser is anchored to the viewport, not to the modal', () => {
  // CHANGED ON PURPOSE (v1.12.1.0). This asserted the chooser laid out as a
  // horizontal strip, which was a workaround, not a design: .ddl-doc-modal
  // clips (overflow:hidden) and is only as tall as its message list, so a
  // dropdown positioned against it was cut off whenever the list was short.
  // Flattening it survived the clip at the cost of looking like nothing else in
  // the app. Anchoring it to the cog removes the constraint instead — measured
  // on a live page, the viewport had 784px below the cog where the modal had
  // 198 and shrinking.
  assert.ok(/id="exp-cols-dlg" class="audit-cfg-dialog cfg-anchored"/.test(html),
    'the dialog is anchored, not absolutely positioned inside the modal');
  const rule = html.match(/\.audit-cfg-dialog\.cfg-anchored\s*\{([^}]*)\}/);
  assert.ok(rule && /position:\s*fixed/.test(rule[1]),
    `fixed is what escapes the clip: ${rule && rule[1]}`);
  // position:fixed only escapes if the base rule's offsets stop applying.
  assert.ok(/top:\s*auto/.test(rule[1]) && /right:\s*auto/.test(rule[1]),
    `the absolute offsets must be released: ${rule[1]}`);
  // No rule may lay it out as a row again.
  assert.ok(!/exp-cols-h/.test(html), 'the horizontal workaround is gone');
  // The cog sits between Download and ✕, so the chooser opens near the right edge.
  const _m = html.indexOf('id="msgExportOverlay"');
  const hdr = html.slice(_m, html.indexOf('id="exportBody"', _m));
  const order = [hdr.indexOf('doMsgExport()'), hdr.indexOf('_expToggleColsDlg()'),
                 hdr.lastIndexOf('closeMsgExportModal()')];
  assert.ok(_m > 0 && order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2],
    `Download, then the cog, then close — got offsets ${order}`);
});

test('the chooser is placed from the cog, and flips rather than leave the screen', () => {
  const fn = psFnSource('_expPlaceColsDlg');
  assert.ok(/getElementById\('exp-cols-btn'\)/.test(fn), 'it measures the cog');
  assert.ok(/getBoundingClientRect\(\)/.test(fn), 'and places against a real rect');
  assert.ok(/window\.innerHeight/.test(fn) && /window\.innerWidth/.test(fn),
    'bounded by the viewport in both axes');
  // The flip is the whole point: without it a cog near the bottom reproduces the
  // original bug against the screen edge instead of the modal edge.
  assert.ok(/a\.top\s*-\s*M\s*-\s*d\.height/.test(fn),
    `it flips above the cog when it will not fit below: ${fn}`);
  // Opening must place it; a stale left/top from a previous open is a popover
  // sitting somewhere the cog no longer is.
  assert.ok(/if \(open\) _expPlaceColsDlg\(\)/.test(psFnSource('_expToggleColsDlg')),
    'opening places it');
  // Toggling a column re-renders and changes nothing about size here, but the
  // header row means a re-render CAN change height — re-place after it.
  assert.ok(/_expPlaceColsDlg\(\)/.test(psFnSource('_expRenderColsDlg')),
    're-rendering re-places it');
});

test('the export chooser uses the same rows as every other column chooser', () => {
  // This is the actual complaint: checkboxes in a strip, where the rest of the
  // app uses a labelled row with a panel-toggle. Pin the shape against the two
  // choosers it must match.
  const render = psFnSource('_expRenderColsDlg');
  assert.ok(/audit-cfg-row/.test(render), 'labelled rows');
  assert.ok(/panel-toggle/.test(render), 'with a panel-toggle, not a checkbox');
  assert.ok(!/type="checkbox"/.test(render), `and no checkbox left behind: ${render}`);
  // is-collapsed is what the other two use to mean "this column is hidden".
  assert.ok(/is-collapsed/.test(render), 'hidden columns read as collapsed');
  // The same markup the Parse Results chooser ships inline.
  assert.ok(/<div class="audit-cfg-row"><label>Field<\/label><button class="panel-toggle"/.test(html),
    'the reference chooser still has that shape');
});

test('the cog becomes the close button while the chooser is open', () => {
  // With the cog doing the closing, the row needs no title bar and no ✕ of its
  // own — two controls one centimetre apart that did the same thing.
  const fn = psFnSource('_expToggleColsDlg');
  assert.ok(/classList\.toggle\('open'\)/.test(fn), 'it toggles the row');
  // CHANGED ON PURPOSE (v1.3.1.3). This asserted the glyph swapped to ✕, which
  // made the cog read as a second close button beside the modal's own. It stays
  // a cog and lights up instead, the way a toggle does.
  assert.ok(/classList\.toggle\('btn-on', open\)/.test(fn), 'and lights the button with it');
  assert.ok(/\.btn\.btn-on\s*\{[^}]*border-color:\s*var\(--accent\)/.test(html),
    'against a rule that actually marks it active');
  // The modal behind the row dims, the way the page dims behind the modal.
  assert.ok(/classList\.toggle\('cfg-dim', open\)/.test(fn), 'and dims the modal behind it');
  // CHANGED ON PURPOSE (v1.12.1.1). The scrim was written against
  // .ddl-doc-modal; it is written against .cfg-dim alone now, so the export
  // modal and the Parse Results panel dim from ONE definition. Two copies of
  // this is exactly how a fix lands on one surface and not the other.
  const dim = html.match(/(?:^|\n)\.cfg-dim::after\s*\{([^}]*)\}/);
  assert.ok(dim, 'there is a scrim rule');
  // A host that is not a positioning origin puts the scrim somewhere else
  // entirely — .panel is static until this class lands on it.
  assert.ok(/(?:^|\n)\.cfg-dim \{[^}]*position:\s*relative/.test(html),
    'and the class makes its host the origin');
  assert.ok(/position:absolute/.test(dim[1]) && /inset:0/.test(dim[1]), 'covering the modal');
  assert.ok(/pointer-events:none/.test(dim[1]), 'without swallowing clicks');
  // A scrim above the thing it is meant to sit behind would hide the row.
  const z = +(dim[1].match(/z-index:(\d+)/) || [])[1];
  const dz = +(html.match(/\.audit-cfg-dialog\s*\{[^}]*z-index:(\d+)/) || [])[1];
  assert.ok(z && dz && z < dz, `scrim ${z} must sit under the dialog ${dz}`);
  // ...and under the button that opened it. Dimming that one hides the way back
  // out, which is the only control still worth clicking while the row is up.
  const lift = html.match(/(?:^|\n)\.cfg-dim \.btn\.btn-on\s*\{([^}]*)\}/);
  assert.ok(lift, 'the active toggle is lifted out of the scrim');
  const lz = +(lift[1].match(/z-index:\s*(\d+)/) || [])[1];
  assert.ok(/position:\s*relative/.test(lift[1]), 'it is positioned, or z-index does nothing');
  assert.ok(lz > z, `the button (${lz}) sits above the scrim (${z})`);
  // ::after is positioned against the modal, so the modal has to be its origin.
  assert.ok(/\.ddl-doc-modal \{[^}]*position: relative/.test(html),
    'and the modal is the positioning origin');
  assert.ok(/exp-cols-btn/.test(fn) && /id="exp-cols-btn"/.test(html),
    'against a button it can actually find');
  // It sits beside the modal's own ✕ and turns INTO one, so it has to be the
  // same size: same classes, and no padding override narrowing it.
  const cog   = html.match(/<button[^>]*id="exp-cols-btn"[^>]*>/)[0];
  const close = html.match(/<button[^>]*onclick="closeMsgExportModal\(\)"[^>]*>/)[0];
  const cls = b => (b.match(/class="([^"]*)"/) || [, ''])[1];
  eq(cls(cog), cls(close).replace('btn-primary ', ''), 'the cog and the close button carry the same classes');
  assert.ok(!/style="[^"]*padding/.test(cog), `and no padding override: ${cog}`);
  // Equal padding is not equal width: ⚙ and ✕ are different sizes in the font,
  // so the button width has to be fixed rather than left to the glyph.
  assert.ok(/btn-ico/.test(cls(cog)) && /btn-ico/.test(cls(close)),
    'both are icon buttons');
  assert.ok(/\.btn\.btn-ico\s*\{[^}]*min-width/.test(html),
    'and that class fixes their width');
  // CHANGED ON PURPOSE (v1.12.1.0). This asserted the chooser carried NO header,
  // which was right while it was a one-line strip — a title bar and an ✕ on a
  // single row of checkboxes was chrome with nothing to title. Back in its
  // normal vertical form it takes the normal header, because that is what the
  // Parse Results and Field Map choosers have and consistency is the point.
  const render = psFnSource('_expRenderColsDlg');
  assert.ok(/audit-cfg-hdr/.test(render), `it carries the standard header: ${render}`);
  assert.ok(/<span>Columns<\/span>/.test(render), 'titled the same way as the others');
  assert.ok(/_expToggleColsDlg\(\)/.test(render), 'and its ✕ closes the same toggle the cog does');
});

// Every cog that opens a column chooser behaves identically. Reported twice, one
// surface at a time: the Parse Results cog opened with nothing dimmed while the
// export cog one panel away did dim, then the Data Editor cog turned out to have
// the same gap. A table, so the next chooser is added to a list that already
// fails when it does not conform.
const CHOOSERS = [
  { fn: '_expToggleColsDlg',  btn: 'exp-cols-btn',   host: '.ddl-doc-modal', where: 'the export modal' },
  { fn: 'toggleColCfgDialog', btn: 'colCfgBtn',      host: '.panel',         where: 'the Parse Results panel' },
  { fn: '_meFmToggleColsDlg', btn: 'me-fm-cols-btn', host: '.me-shell',      where: 'the Data Editor' },
  { fn: 'auditToggleCfgDialog', btn: 'auditCfgBtn',  host: '.panel',         where: 'the audit browser' },
];
for (const c of CHOOSERS) {
  test(`${c.where}: its cog lights, and what is behind the chooser dims`, () => {
    const fn = psFnSource(c.fn);
    assert.ok(/classList\.toggle\('open'\)/.test(fn), 'it opens the chooser');
    assert.ok(/classList\.toggle\('btn-on', open\)/.test(fn), 'lights the cog');
    assert.ok(/classList\.toggle\('cfg-dim', open\)/.test(fn), 'and dims what is behind it');
    assert.ok(fn.includes(`closest('${c.host}')`), `against ${c.host}`);
    // A cog it cannot find is a toggle that silently never lights.
    assert.ok(html.includes(`id="${c.btn}"`), `${c.btn} exists in the markup`);
  });
}

test('the two overrides clear each other, in BOTH directions', () => {
  // Reported: arming an entity override cleared the DDL one, but arming a DDL
  // override left the entity one live. Both could then be armed at once — two
  // answers to one question, with only one of them visible in the tree.
  const ent = psFnSource('toggleSpecOverride');
  const ddl = psFnSource('toggleParseOverride');
  assert.ok(/S\.parseOverride = null/.test(ent), 'arming an entity clears the DDL override');
  assert.ok(/S\.specOverride = null/.test(ddl), 'arming a DDL clears the entity override');
  // Silently dropping the other one is its own bug — say so.
  assert.ok(/was cleared/.test(ent) && /was cleared/.test(ddl), 'both say what they cleared');
  // And each has to repaint the surface the other one owns, or the stale
  // marker sits there claiming an override that is gone.
  assert.ok(/renderDDLTree/.test(ent), 'the entity toggle repaints the tree');
  assert.ok(/_meRenderSidebar/.test(ddl), 'the DDL toggle repaints the sidebar');
});

test('every destructive action asks the same way', () => {
  // The DDL tree asked for YES; the Data Editor asked for DELETE. Same gesture,
  // two words, and they differed on the verb (delete vs remove) and on whether
  // case mattered too. Worse, the DELETE ones matched exactly, so typing
  // "delete" did nothing at all — a silent no-op reads as a broken dialog.
  const src = fs.readFileSync('./source.html', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Type YES/.test(code), 'nothing asks for YES any more');
  // Exactly one place builds the sentence and checks the answer.
  const helper = psFnSource('confirmDelete');
  assert.ok(/Type \$\{DELETE_WORD\} to remove \$\{phrase\}/.test(helper),
    'one sentence, built once');
  assert.ok(/\.trim\(\)\.toUpperCase\(\) !== DELETE_WORD/.test(helper),
    'trimmed and case-insensitive, so "delete" is not a silent no-op');
  // And every destructive path goes through it rather than rolling its own.
  const callers = (code.match(/confirmDelete\(/g) || []).length;
  assert.ok(callers >= 4, `expected the helper plus its call sites, found ${callers}`);
  // Everywhere EXCEPT the helper itself, which is the one place allowed to.
  const outside = code.replace(helper, '');
  assert.ok(!/showPrompt\(`?['"]?Type /.test(outside),
    'no call site rolls its own typed confirmation');
  for (const fn of ['deleteScope', '_meDelRec', '_meDeleteItem'])
    assert.ok(/confirmDelete\(/.test(psFnSource(fn)), `${fn} uses the shared confirmation`);
});

test('the Delete button is red, and its fill is readable', () => {
  // Destructive is RED — #f85149, the red the app already uses for errors and
  // the bug-report button. It shipped as --accent2 orange, which is a warning
  // colour: it reads as "careful", not "this removes something". The old
  // btn-danger hover also tinted the background with the BLUE accent behind
  // orange text, which belonged to neither.
  const src = fs.readFileSync('./source.html', 'utf8');
  const decls = css => Object.fromEntries((css || '').split(';')
    .map(d => d.trim().replace(/\s*!important$/, ''))
    .filter(Boolean)
    .map(d => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));
  const mine = decls((src.match(/\.btn-danger:hover \{([^}]*)\}/) || [])[1]);
  const ref  = decls((src.match(/\.btn-feedback-bug:hover \{([^}]*)\}/) || [])[1]);
  assert.ok(Object.keys(mine).length && Object.keys(ref).length, 'both hover rules found');
  // Same treatment as Report a Bug, declaration for declaration. Pinned against
  // the reference rather than against literal colours, so restyling one moves
  // the other or fails.
  for (const k of ['color', 'background', 'border-color'])
    eq(mine[k], ref[k], `${k} matches the Report a Bug button`);
  // The token, not the literal it used to hold: --danger is the app red and
  // carries a different value per theme (light needs a darker one to stay
  // legible on white), which a hardcoded hex could not express.
  assert.ok(/var\(--danger\)/.test(mine.color), `and that colour is the app red, got: ${mine.color}`);
  // Red is on the LABEL only now — no tinted fill, no red outline — so the
  // colour reads as a property of the text rather than a filled alarm.
  assert.ok(!/rgba\(248,\s*81,\s*73/.test(mine.background || ''),
    `no red fill on hover, got: ${mine.background}`);
  // At rest it is a plain button, like its reference — a destructive control
  // that shouts before you go near it trains people to ignore it.
  assert.ok(!/\.btn-danger \{/.test(src), 'no resting override; plain until hovered');
  // The orange it shipped as, and the blue tint the old rule used, are both out.
  assert.ok(!/accent2|accent-rgb/.test(JSON.stringify(mine)),
    'neither the warning orange nor the blue accent');
});

test('deleting an entity is a labelled button, not a 10px × in every row', () => {
  // The per-row × sat immediately beside a gap badge and the row's own click
  // target, so the most destructive action in the list was the easiest to hit
  // by accident and the hardest to hit on purpose.
  const src = fs.readFileSync('./source.html', 'utf8');
  assert.ok(!/me-item-del/.test(src),
    'the per-row × is gone — markup, styling and the drag guard that existed only for it');
  assert.ok(/id="me-del-btn"[^>]*onclick="_meDeleteSelected\(\)"/.test(src),
    'a labelled Delete sits in the header');
  assert.ok(/>Delete</.test(src), 'and it says Delete, not a glyph');

  const fn = psFnSource('_meDeleteSelected');
  assert.ok(/_meDeleteItem\('msg', idx\)/.test(fn), 'it routes to the same delete');
  // Acting on nothing is the failure mode of a selection-driven button.
  assert.ok(/Select an entity in the list first/.test(fn),
    'with nothing selected it says so rather than doing nothing');
  // The confirmation is unchanged — this moved the control, not the safety.
  // Asserted against the helper, not the sentence: after the confirmations were
  // unified the literal only survived inside a COMMENT, and this check went on
  // passing against it.
  assert.ok(/confirmDelete\(/.test(psFnSource('_meDeleteItem')),
    'it still goes through the typed confirmation');
  // Disabled state has to track selection, or a live-looking button does nothing.
  const sync = psFnSource('_meSyncDelBtn');
  assert.ok(/b\.disabled = !s/.test(sync), 'the button disables when nothing is selected');
  assert.ok(/b\.title = s \?/.test(sync), 'and names what it would delete');
  assert.ok(/_meSyncDelBtn\(\);/.test(src.replace(/function _meSyncDelBtn[\s\S]*?\n\}/, '')),
    'and the sidebar render keeps it in sync');
});

test('the armed row wins over selection and hover, on specificity', () => {
  // Reported: an armed Message row did not turn orange, and hovering it made it
  // DARKER. Two specificity losses: `.me-item.active` (two classes) repainted
  // it accent-blue, and `.me-item:hover` — same weight, declared later —
  // replaced the brighter orange with a white wash. Source order was doing the
  // work, so moving these lines would have broken them again.
  const src = fs.readFileSync('./source.html', 'utf8');
  // Classes AND pseudo-classes both count toward specificity.
  const weight = sel => (sel.match(/[.:]/g) || []).length;
  const rules = {};
  for (const m of src.matchAll(/^(\.me-item[^\s{][^{]*)\{([^}]*)\}/gm)) rules[m[1].trim()] = m[2];
  const armed = Object.keys(rules).filter(k => /me-item-forced/.test(k));
  assert.ok(armed.length >= 4, `expected the armed rules, found ${armed.length}`);
  // Each competing pair, armed vs plain. Equal weight is a FAILURE here — that
  // is the state the bug was in, decided only by which line came last.
  for (const [a, b] of [['.me-item.me-item-forced.active', '.me-item.active'],
                        ['.me-item.me-item-forced:hover', '.me-item:hover']]) {
    assert.ok(rules[a], `${a} exists`);
    assert.ok(weight(a) > weight(b),
      `${a} (${weight(a)}) must out-weigh ${b} (${weight(b)}) — equal weight leaves it to source order`);
  }
  // Armed AND selected must still read as armed.
  assert.ok(rules['.me-item.me-item-forced.active'], 'the armed+selected case is handled');
  assert.ok(/rgba\(230,168,23,0\.16\)/.test(rules['.me-item.me-item-forced.active']),
    'and stays orange rather than reverting to accent');
  // Hover brightens; it must never be the darker of the two.
  const base  = /0\.16/.test(rules['.me-item.me-item-forced'] || '');
  const hover = /0\.24/.test(rules['.me-item.me-item-forced:hover'] || '');
  assert.ok(base && hover, 'hover is the brighter value, matching the tree');
});

test('both overrides look like the same feature', () => {
  // The first version marked an armed entity with a blue ⊙, which read as
  // "selected" and looked like a different feature from the tree's amber ▶.
  const src = fs.readFileSync('./source.html', 'utf8');
  const item = (src.match(/\.me-item-forced\{([^}]*)\}/) || [])[1] || '';
  const tree = (src.match(/\.tree-node\.tree-ovr \{([^}]*)\}/) || [])[1] || '';
  assert.ok(item && tree, 'both rules found');
  for (const [what, css] of [['entity', item], ['tree', tree]]) {
    assert.ok(/#e6a817/.test(css), `${what} uses the shared amber`);
    assert.ok(/rgba\(230,168,23/.test(css), `${what} tints the row the same way`);
  }
  assert.ok(!/⊙/.test(src), 'the odd-one-out dot is gone');
  // The marker sits beside the NAME on both, not at the end of the row.
  assert.ok(/\.me-item-forced \.me-item-name::after\{content:'▶'/.test(src),
    'entity: ▶ after the name');
  assert.ok(/\.tree-node\.tree-ovr \.tree-ddl-lbl::after,\s*\n\.tree-node\.tree-ovr \.tree-def-lbl::after \{ content: '▶'/.test(src),
    'tree: ▶ after the label, not on the row');
  assert.ok(!/\.tree-node\.tree-ovr::after/.test(src),
    'and the old row-level marker is removed, or both would render');
});

test('the entity override forces one spec and skips its recognizers', () => {
  // "Use this and this only". Distinct from the DDL-tree override, which yields
  // a natural walk: forcing an ENTITY brings its parse spec, its binding AND
  // its field overrides, which is the reason to want it. Recognizers are
  // skipped on purpose — the user has already decided, so a failing recognizer
  // must not veto them.
  const src = fs.readFileSync('./source.html', 'utf8');
  assert.ok(/specOverride: null/.test(src), 'the state exists');
  // Session-only: persisting it would leave the app forcing a spec after a
  // restart with nothing on screen explaining why.
  assert.ok(!/localStorage[^\n]*specOverride/.test(src), 'and is never persisted');
  // Both detection paths must honour it, or the progress panel and the parse
  // disagree about what matched.
  assert.ok(/function _fmtDetect\(bytes, ctx\) \{\s*\n\s*const forced = _specOverrideSpec\(\);/.test(src),
    '_fmtDetect short-circuits on it');
  assert.ok(/const _forced = _specOverrideSpec\(\);/.test(src), '_fmtDetectTrace too');
  assert.ok(/recognizers not evaluated/.test(src),
    'and the trace says so, rather than showing an empty evaluation');
  // Keyed by label, because name is not unique — Standard / BIC / Switch are all "ISO".
  assert.ok(/\(s\.label \|\| s\.name\) === o\.label/.test(src), 'resolved by label, not name');
  // A deleted or renamed entity must not leave the app forcing a ghost.
  assert.ok(/if \(!hit\) \{ S\.specOverride = null; return null; \}/.test(src),
    'a stale override clears itself');
  // Both winner shapes come from one place, so a forced spec cannot come back
  // subtly different from a detected one.
  assert.ok(/function _specWinner\(spec\)/.test(src), 'one winner shape');
  eq((src.match(/return _specWinner\(/g) || []).length >= 2, true, 'used by both paths');
  // Armed state has to be visible — an invisible override is the toast bug again.
  assert.ok(/me-item-forced/.test(src), 'the armed row is marked');
  assert.ok(/PARSING OVERRIDE/.test(src), 'and says what it does on hover');
});

test('"Other" entities are ranked after every message, so the sidebar cannot lie', () => {
  // A third sidebar group for structures that are neither a message nor a file
  // (a TDE, say). They are recognized from BYTES like a message, so they share
  // detection rank — and drawing them in a separate box while interleaving them
  // in that rank would hide which one wins. Tried after every message instead,
  // so the sidebar top-to-bottom IS the order detection uses.
  const order = sandbox._detectOrderIdxs || null;
  const specs = [{ name: 'A' }, { name: 'B', kind: 'other' }, { name: 'C' },
                 { name: 'D', kind: 'file' }, { name: 'E', kind: 'other' }];
  if (order) {
    deepEq(order(specs).map(i => specs[i].name), ['A','C','B','E','D'],
      'messages, then other, then files — each group in array order');
  }
  // Source-level, since the function is module-private in some builds.
  const src = fs.readFileSync('./source.html', 'utf8');
  const fn = (src.match(/function _detectOrderIdxs[\s\S]*?\n  \}/) || [''])[0];
  assert.ok(/const msgs = \[\], other = \[\], files = \[\]/.test(fn), 'three buckets');
  assert.ok(/return msgs\.concat\(other, files\)/.test(fn),
    `messages first, other next, files last: ${fn.slice(-120)}`);
});

test('the three sidebar lists exist and nothing still assumes two', () => {
  const src = fs.readFileSync('./source.html', 'utf8');
  for (const id of ['me-msg-list', 'me-other-list', 'me-file-list'])
    assert.ok(src.includes(`id="${id}"`), `${id} is in the markup`);
  // The Messages filter must exclude BOTH other kinds, or an Other entity
  // appears in two lists at once.
  assert.ok(/s => s\.kind !== 'file' && s\.kind !== 'other'/.test(src),
    'the Messages list excludes other and file');
  // Drag cleanup has to cover the new list or a half-dragged row keeps its class.
  assert.ok(/#me-msg-list \.me-item, #me-other-list \.me-item, #me-file-list \.me-item/.test(src),
    'drag-end clears all three lists');
  // A two-way flip cannot express three destinations.
  assert.ok(!/_meMoveKind/.test(src), 'the old two-way kind flip is gone');
  assert.ok(/Move to Messages/.test(src) && /Move to Other/.test(src) && /Move to Files/.test(src),
    'the menu names each destination');
  assert.ok(/kind: 'other'/.test(src), '_meAddOther creates the right kind');
});

test('greater-than and less-than read as opposites, and say which is which', () => {
  // Reported: greater-than 407 accepted a 470-byte message, which is correct —
  // but the description being read at the time was less-than's, because the
  // help panel did not follow the type being edited. Both entries now lead with
  // MINIMUM / MAXIMUM and point at each other, so landing on the wrong one is
  // self-correcting.
  const src = fs.readFileSync('./source.html', 'utf8');
  // _REC_HELP entries are structured objects (desc / useWhen / attrs / examples),
  // so the wording lives across several fields. Evaluate the literal and search
  // the whole entry rather than one template string.
  const helpObj = (() => {
    const m = src.match(/const _REC_HELP = \{[\s\S]*?\n\};/);
    if (!m) return null;
    const ctx = {}; vm.createContext(ctx);
    try { vm.runInContext(m[0] + ';out=_REC_HELP', ctx); return ctx.out; } catch (e) { return null; }
  })();
  assert.ok(helpObj, 'could not read _REC_HELP');
  const entry = t => JSON.stringify(helpObj[t] || '');
  const gt = entry('greater-than'), lt = entry('less-than');
  assert.ok(gt && lt, 'both help entries found');
  assert.ok(/MINIMUM/.test(gt), 'greater-than leads with MINIMUM');
  assert.ok(/MAXIMUM/.test(lt), 'less-than leads with MAXIMUM');
  assert.ok(/<b>longer<\/b>/.test(gt) && /<b>shorter<\/b>/.test(lt),
    'each says which direction it accepts');
  // Each must name the other, so picking the wrong one is recoverable in place.
  assert.ok(/less-than/.test(gt), 'greater-than points at less-than');
  assert.ok(/greater-than/.test(lt), 'less-than points at greater-than');
  // The off-by-one is the real trap: both are strict.
  assert.ok(/N = X − 1/.test(gt), 'greater-than gives the at-least conversion');
  assert.ok(/N = X \+ 1/.test(lt), 'less-than gives the up-to conversion');
  // And the evaluators must still be what the help claims.
  assert.ok(/_R\['greater-than'\][^\n]*bytes\.length >  \(/.test(src), 'greater-than is >');
  assert.ok(/_R\['less-than'\][^\n]*bytes\.length <  \(/.test(src), 'less-than is <');
});

test('the recognizer help follows the type being edited', () => {
  // The panel kept showing whatever was last clicked, so a greater-than rule
  // could be written while reading less-than's description — which says the
  // opposite thing about the same number. That is what happened.
  const fn = psFnSource('_meRecTypeChange');
  assert.ok(/_meRecHelpSelect\(newType\)/.test(fn), 'changing the type moves the help');
  assert.ok(/recHelpOpen/.test(fn), 'only when the help is actually open');
  // The selection must also survive a re-render, as the Field Map help does.
  const src = fs.readFileSync('./source.html', 'utf8');
  assert.ok(/recHelpSel: null/.test(src), 'the selection is real state');
  assert.ok(/_meState\.recHelpSel = type/.test(src), 'set when a row is clicked');
  assert.ok(/_meState\.recHelpOpen && _meState\.recHelpSel[\s\S]{0,180}_meRecHelpSelect\(_meState\.recHelpSel\)/.test(src),
    'and restored after the render that would otherwise blank it');
});

test('the toast sits above every overlay in the app', () => {
  // It was 20000 — below the Data Editor (21000), the export and DDL-doc modals
  // (25000), the context menu (26000) and Settings (30000). So a toast raised
  // from inside any of them rendered BEHIND it and was never seen. Twelve
  // showToast call sites were affected, not just the new one; the copy worked
  // and looked like it had not.
  //
  // Computed, not hardcoded: adding an overlay above the toast fails this.
  const src = fs.readFileSync('./source.html', 'utf8');
  const toastRule = (src.match(/#toast \{[\s\S]*?\}/) || [''])[0];
  assert.ok(toastRule, '#toast rule not found');
  const toastZ = +(toastRule.match(/z-index:\s*(\d+)/) || [])[1];
  assert.ok(toastZ, 'the toast declares a z-index');
  const others = [...src.replace(toastRule, '').matchAll(/z-?index\s*:\s*(\d+)/gi)].map(m => +m[1]);
  const max = Math.max(...others);
  assert.ok(toastZ > max,
    `the toast (${toastZ}) must outrank every other z-index (highest is ${max}) — `
    + 'a notice nobody can see is worse than none');
});

test('.nojekyll exists — markdown must not be run through Liquid', () => {
  // Six consecutive Pages deployments failed at "Build with Jekyll" because a
  // TODO entry contained a literal {{ inside backticks. Liquid runs BEFORE
  // markdown, so backticks protect nothing, and an unclosed {{ is a syntax
  // error that kills the build. The repo serves a static index.html and has no
  // Jekyll content, so .nojekyll removes the whole class of failure.
  assert.ok(fs.existsSync('./.nojekyll'),
    '.nojekyll is missing — Pages will run Liquid over every .md file again');
  // If it is ever removed, this is what would break. Named so the next person
  // sees the connection rather than rediscovering it from a red build.
  const liquid = ['TODO.md', 'README.md', 'SPEC-message-format-detector.md']
    .filter(f => fs.existsSync(f))
    .map(f => ({ f, n: (fs.readFileSync(f, 'utf8').match(/\{\{|\{%/g) || []).length }))
    .filter(x => x.n);
  if (liquid.length) {
    assert.ok(fs.existsSync('./.nojekyll'),
      `these files contain Liquid-hostile sequences and depend on .nojekyll: `
      + liquid.map(x => `${x.f} (${x.n})`).join(', '));
  }
});

test('double-clicking a Field Map row copies a name a parse spec can use', () => {
  // Requested so a field name can be pasted straight into a parse spec. The
  // subtlety is WHICH name: the table shows GROUP[01].AA, but a parse spec
  // references GROUP.AA — pasting the row label would fail in a way that looks
  // like the spec's fault rather than a bad paste.
  const src = fs.readFileSync('./source.html', 'utf8');
  assert.ok(/ondblclick="_meFmCopyFieldName\('\$\{id\}', event\)"/.test(src),
    'every row carries the handler');
  assert.ok(/title="Double-click to copy the field name"/.test(src),
    'and says so, since a double-click is not discoverable on its own');
  const fn = psFnSource('_meFmCopyFieldName');
  assert.ok(/_canonFieldId\(qn\)/.test(fn),
    `the CANONICAL id is copied, not the row label: ${fn.slice(0, 200)}`);
  assert.ok(/showToast\(/.test(fn), 'and the app toast confirms it');
  // The toast must name what actually landed on the clipboard — reporting the
  // row label while copying something else is worse than saying nothing.
  assert.ok(/copied to the clipboard/.test(fn) && /\$\{name\}/.test(fn),
    'naming the copied value, not the id it was derived from');
  // Failure has to be distinguishable; execCommand can return false.
  assert.ok(/copy failed/.test(fn), 'a failed copy does not claim success');
  // Selecting the row must not also happen twice and fight the copy.
  assert.ok(/stopPropagation\(\)/.test(fn), 'the dblclick does not re-enter the row click');
  // Called from an inline attribute, so it has to survive the build as a global.
  assert.ok(/renameGlobals:\s*false/.test(fs.readFileSync('./build.js', 'utf8')),
    'top-level names are preserved by the obfuscator');
});

test('each help example is a bounded, numbered card', () => {
  // Reported: "it seems one long example". read-fixed alone ships ten, and they
  // were a flat run of divs joined by a 10px spacer — a Payload/Spec/Result trio
  // ran straight into the next one with nothing marking the boundary.
  const fn = psFnSource('_mePsHelpExampleHtml');
  assert.ok(/class="me-ps-help-ex"/.test(fn), 'each example opens a card');
  assert.ok(/return out \+ `<\/div>`/.test(fn), 'and closes it — an unclosed card nests the rest inside it');
  assert.ok(/Example \$\{i \+ 1\}/.test(fn), 'numbered from the render index, not the data');
  // The number must come from the list, or every card reads "Example 1".
  const src = fs.readFileSync('./source.html', 'utf8');
  assert.ok(/shown\.map\(\(ex, i\) => _mePsHelpExampleHtml\(ex, i\)\)/.test(src),
    'the index is actually passed');
  assert.ok(!/join\('<div style="height:10px"><\/div>'\)/.test(src),
    'the spacer is gone — the card carries its own margin');
  // A border is what says where one ends; colour alone would not survive a theme.
  const card = src.match(/\.me-ps-help-ex\{([^}]*)\}/);
  assert.ok(card && /border:\s*var\(--bw\) solid/.test(card[1]), `the card is bounded: ${card && card[1]}`);
  const title = src.match(/\.me-ps-help-ex-title\{([^}]*)\}/);
  assert.ok(title && /border-bottom:\s*var\(--bw\) solid/.test(title[1]),
    'and the heading is separated from the body it introduces');
});

test('the dim hosts all clip, so a mispositioned scrim would vanish silently', () => {
  // .panel and .me-shell are static until .cfg-dim lands on them, and both hide
  // their overflow. A scrim that resolved against an ancestor further up would
  // be clipped away entirely rather than look wrong — which is why the class
  // carries position:relative rather than each host declaring it.
  for (const sel of ['.panel', '.me-shell']) {
    const rule = new RegExp(sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}');
    const m = html.match(rule);
    assert.ok(m, `${sel} rule not found`);
    assert.ok(/overflow\s*:\s*hidden/.test(m[1]), `${sel} clips: ${m[1].slice(0, 60)}`);
  }
});

test('no border declares a literal width — every one goes through --bw', () => {
  // Was: "no border is 1px — the project uses 2px everywhere". The 2px rule was
  // retired on 2026-08-09 when the theme overhaul adopted 1px hairlines, so
  // pinning the width here would now fight the design language. The rule the
  // original test was really protecting — borders are deliberate and uniform,
  // not chosen ad hoc per component — survives by pinning the TOKEN instead.
  // Change --bw once and every border follows; that is the property worth having.
  // A transparent border is layout padding (the scrollbar thumb insets its
  // track that way), not a visible rule — width there is geometry, not theme.
  const hits = [...html.matchAll(/border(?:-top|-right|-bottom|-left|-width)?\s*:\s*(?:[0-9.]+px|thin|medium|thick)(?![^;]*transparent)/g)]
    .map(m => {
      const line = html.slice(0, m.index).split('\n').length;
      return `line ${line}: ${html.slice(m.index, m.index + 48).split('\n')[0]}`;
    });
  assert.deepStrictEqual(hits, [], `borders with a literal width:\n${hits.join('\n')}`);
  // border-radius is a corner, not a border — it must NOT be caught by this.
  assert.ok(/border-radius/.test(html),
    'the guard leaves border-radius alone (there are still radii in the source)');
});

test('the Parse Results header matches the Field Map header', () => {
  const th = html.match(/\nthead th \{([^}]*)\}/);
  assert.ok(th, 'the rule exists');
  // Pinned against the Field Map header rather than a literal padding: the two
  // are meant to read as one thing, so what matters is that they move together.
  // A literal here meant density could not reach either without failing.
  const fm = html.match(/\n\.me-fm-table th\{([^}]*)\}/);
  assert.ok(fm, 'the Field Map header rule exists');
  const pad = r => (r.match(/padding:\s*([^;]+)/) || [])[1];
  eq(pad(th[1]), pad(fm[1]), 'same padding as the Field Map header');
  assert.ok(/var\(--row-py\)/.test(pad(th[1]) || ''), 'and it follows the density scale');
  assert.ok(/cursor:\s*pointer/.test(th[1]), 'and reads as clickable');
  // Project rule: borders go through --bw, never a literal width.
  assert.ok(/border-bottom:\s*var\(--bw\)/.test(th[1]), 'with a --bw rule, like every other border');
});

test('a hex-char field with no width override shows its declared number', () => {
  // Discriminating half: nothing overridden means nothing to annotate, so a bare
  // number here proves the ↩ above came from the override and not from the type.
  S.ddlTree = { V: { S: { D: DDL_BYTES } } };
  const row = meWalkDEFields(getDDLFromPath('V/S/D/REC').defs,
    { ddl_bindings: ['V/S/D/REC'], overrides: { MSGTYPE: { type: 'hex-char' } } })
    .find(r => r.id === 'MSGTYPE');
  eq(row.lenWritten, undefined, 'no width was written');
  eq(row.length, 4, 'and the declared four bytes stand — a type resizes nothing');
});

// ── A leaf length source and the field it sizes are ONE data element ────────
// Reported: PAN-LEN marked as a length source took DE 3 and PAN took DE 4, so
// the pair spent two numbers. A VLG GROUP has always been a single element
// holding LEN + payload; marking the same pair by hand does not make it two.

console.log('\na leaf VLG pair is one data element');

const VLGPAIR_DDL = `DEF R.
  02 A PIC X(2).
  02 PAN-LEN PIC X(1).
  02 PAN PIC X(8).
  02 TRACE PIC X(6).
END R.
`;
const vlgPairRows = overrides => {
  S.ddlTree = { V: { S: { D: VLGPAIR_DDL } } };
  return meWalkDEFields(getDDLFromPath('V/S/D/R').defs,
    { ddl_bindings: ['V/S/D/R'], overrides });
};
const at = (rows, id) => rows.find(r => r.id === id) || {};

test('the sized field derives the length source\'s DE instead of taking its own', () => {
  const rows = vlgPairRows({ 'PAN-LEN': { vlg: true } });
  eq(at(rows, 'PAN-LEN').de, 2, 'the length source owns the number');
  eq(at(rows, 'PAN').de, null, 'the field it sizes owns none');
  eq(at(rows, 'PAN').ownerDE, 2, 'and derives its owner\'s');
  eq(at(rows, 'PAN').ownerId, 'PAN-LEN', 'naming who it belongs to');
});

test('everything after the pair renumbers, because one number was freed', () => {
  eq(at(vlgPairRows({ 'PAN-LEN': { vlg: true } }), 'TRACE').de, 3, 'TRACE moves up');
  // Discriminating half: without the VLG the pair spends two numbers, so a
  // change that did nothing would leave TRACE at 4 in both.
  eq(at(vlgPairRows({}), 'TRACE').de, 4, 'and stays at 4 when nothing is paired');
  eq(at(vlgPairRows({}), 'PAN').de, 3, 'with PAN owning its own DE');
});

test('a length source that owns no DE cannot own a pair', () => {
  // Excluded from the numbering, so there is no number to share — PAN must go
  // back to owning its own rather than deriving a null.
  const rows = vlgPairRows({ 'PAN-LEN': { vlg: true, de: false } });
  eq(at(rows, 'PAN-LEN').de, null, 'the source is not a DE');
  eq(at(rows, 'PAN').ownerDE, undefined, 'so nothing is derived');
  eq(at(rows, 'PAN').de, 2, 'and PAN owns a number of its own');
});

test('the bit that selects the pair reads BOTH fields', () => {
  // The engine half. If the DE map carried only the LEN, the numbering would say
  // "one element" while the parse emitted only its length and dropped the
  // payload entirely.
  S.ddlTree = { V: { S: { D: `DEF M.
  02 BITMAP PIC X(8).
  02 PAN-LEN PIC X(1).
  02 PAN PIC X(8).
END M.
` } } };
  S.inputFormat = 'hex';
  const ctx = meExecParseSpec({ name: 'X', ddl_bindings: ['V/S/D/M'],
      overrides: { 'PAN-LEN': { vlg: true } },
      parse_spec_binary: [
        { 'read-bitmap': { field: 'BITMAP', length: 8 } },
        { 'read-bitmap-fields': 'BITMAP' },
      ] },
    Uint8Array.from([0x80, 0, 0, 0, 0, 0, 0, 0,        // bit 1 — PAN-LEN, the first
                                                       // element after the bitmap
                     0x35,                              // PAN-LEN = "5"
                     0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48]));
  const len = ctx.fields.find(f => f.id === 'PAN-LEN');
  const pan = ctx.fields.find(f => f.id === 'PAN');
  assert.ok(len, 'the length source is emitted');
  assert.ok(pan, 'and so is the field it sizes, on the same bit');
  eq(pan.valueLength, 5, 'sized by the length source, not by its declared 8');
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

// ── A group action lands on the leaves it contains ─────────────────────────
// Only leaves are compiled, so "ADDITIONA" exists as a prefix and nothing else.
// An override stored there is read by nothing: it shows in the list, changes no
// byte, and silently does nothing.

console.log('\ngroup actions expand to leaves');

const EXP_ROWS = [
  { id: 'MSGTYPE', isGroup: false },
  { id: 'ADDITIONA', isGroup: true },
  { id: 'ADDITIONA.FIELD-XX', isGroup: true },
  { id: 'ADDITIONA.FIELD-XX.DATA', isGroup: false },
  { id: 'ADDITIONA.FIELD-YY', isGroup: true },
  { id: 'ADDITIONA.FIELD-YY.DATA', isGroup: false },
  { id: 'ADDITIONA.OLD', isGroup: false, isRedef: true },
];

test('type and bytes on a group land on every leaf inside it', () => {
  setFmVirt({ all: EXP_ROWS });
  deepEq(meFmExpandTargets('ADDITIONA', 'type'),
    ['ADDITIONA.FIELD-XX.DATA', 'ADDITIONA.FIELD-YY.DATA'], 'both leaves');
  deepEq(meFmExpandTargets('ADDITIONA', 'bytes'),
    ['ADDITIONA.FIELD-XX.DATA', 'ADDITIONA.FIELD-YY.DATA'], 'and for bytes');
});

test('a REDEFINES leaf is never a target', () => {
  setFmVirt({ all: EXP_ROWS });
  assert.ok(!meFmExpandTargets('ADDITIONA', 'type').includes('ADDITIONA.OLD'),
    'an overlay re-views bytes another field already owns');
});

test('vlg on a group marks only the FIRST leaf', () => {
  // A length marks ONE field; what it sizes is whatever follows it. Marking
  // every leaf would make each one a length for the next.
  setFmVirt({ all: EXP_ROWS });
  deepEq(meFmExpandTargets('ADDITIONA', 'vlg'), ['ADDITIONA.FIELD-XX.DATA'], 'first leaf only');
  deepEq(meFmExpandTargets('ADDITIONA.FIELD-XX', 'vlg'), ['ADDITIONA.FIELD-XX.DATA'],
    'and a nested group resolves to its own first leaf');
});

test('DE forms stay on the group, where numbering actually lives', () => {
  setFmVirt({ all: EXP_ROWS });
  for (const act of ['de-off', 'de-on', 'de-kids', 'de-anchor'])
    deepEq(meFmExpandTargets('ADDITIONA', act), ['ADDITIONA'], act + ' is group-level');
});

test('a leaf is never expanded', () => {
  setFmVirt({ all: EXP_ROWS });
  deepEq(meFmExpandTargets('MSGTYPE', 'type'), ['MSGTYPE'], 'left alone');
});

test('the target expansion is what the actions actually use', () => {
  // The helper being right proves nothing if the action loops still walk the
  // raw selection — which is what they did before.
  for (const fn of ['_meFmAct', '_meFmEdCommit']) {
    const src = psFnSource(fn);
    assert.ok(/_meFmActionTargets\(/.test(src), fn + ' expands its targets');
    assert.ok(!/for \(const qn of _meFmMultiSel\)/.test(src),
      fn + ' must not loop the raw selection');
  }
});

test('the list header does not repeat the section title', () => {
  // The section is already called Overrides; the list inside it said so again.
  const html2 = ovPanelHtml();
  const hdr = (html2.match(/<div class="me-ovl-hdr">[\s\S]*?<\/div>/) || [''])[0];
  assert.ok(/id="me-ovl-count"/.test(hdr), 'the count is still there');
  assert.ok(!/>\s*Overrides\s*</.test(hdr) && !/Overrides\s+<span/.test(hdr),
    `the redundant label is gone, got: ${hdr}`);
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
  //
  // CHANGED ON PURPOSE (v1.6.2.0): this named the literal `space-between`. The
  // bar now also gives each GROUP an equal share, which spreads the buttons
  // themselves rather than only the gaps between them. Asserted as the intent so
  // the next layout change is judged on whether it still distributes.
  const grp = html.match(/\.me-fm-g\{[^}]*\}/)[0];
  const spreads = /justify-content:\s*space-(between|evenly|around)/.test(css)
               || /flex:\s*1 1 0/.test(grp);
  assert.ok(spreads,
    `the groups spread across the bar rather than bunching to the left: ${css} | ${grp}`);
});

test('the selection count lives on the reference pill, not a separate span', () => {
  // Asked for: fold the count into the READ-ONLY pill and give the width back to
  // the action groups. Two elements saying different halves of one fact, side by
  // side, with the bar short of room.
  assert.ok(/id="me-fm-cnt"[^>]*class="me-ovl-ro|class="me-ovl-ro[^"]*"[^>]*id="me-fm-cnt"/.test(html),
    'the pill IS the count element');
  assert.ok(!/class="me-fm-cnt/.test(html), 'and the old count span is gone');
  const fn = psFnSource('_meFmBarRefresh');
  assert.ok(/READ-ONLY/.test(fn), 'the refresher keeps the READ-ONLY wording');
  assert.ok(/selected/.test(fn) && /no selection/.test(fn), 'and states the count');
  // Blue while something is selected — the signal the count carried before.
  const pill = html.match(/\.me-ovl-ro\{[^}]*\}/)[0];
  const none = html.match(/\.me-ovl-ro\.none\{[^}]*\}/)[0];
  assert.ok(/color:var\(--accent\)/.test(pill), `selected state is accent: ${pill}`);
  assert.ok(/var\(--text-very-dim\)/.test(none), `and dim with nothing selected: ${none}`);
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

// ── Compact formatting: one line per block ─────────────────────────────────
// The expanded form puts every attribute on its own line, which is unreadable
// at fifteen blocks — the sequence disappears into punctuation.

console.log('\nparse-spec Format — compact mode');

const FMT_SRC = `[
  {
    "skip": { "length": 9 }
  },
  // a note above a block
  {
    "read": "SDLC-DEST"
  },
  {
    // a note INSIDE a block
    "read": "SDLC-ORIGIN"
  }
]`;

test('compact puts each block on one line', () => {
  const out = compactJsonc(formatJsonc(FMT_SRC));
  assert.ok(/^  \{ "skip": \{ "length": 9 \} \},$/m.test(out), `got:\n${out}`);
  assert.ok(/^  \{ "read": "SDLC-DEST" \},$/m.test(out), `got:\n${out}`);
});

test('a comment above a block survives', () => {
  assert.ok(/\/\/ a note above a block/.test(compactJsonc(formatJsonc(FMT_SRC))), 'kept');
});

test('a block containing a comment is left expanded', () => {
  // Collapsing it would pull the rest of the block onto a // line and swallow
  // it. A formatter that eats comments is worse than one that indents badly.
  const out = compactJsonc(formatJsonc(FMT_SRC));
  assert.ok(!/\/\/ a note INSIDE a block.*"read"/.test(out), 'not collapsed onto the comment line');
  assert.ok(/\/\/ a note INSIDE a block\n/.test(out), 'the comment still owns its line');
});

test('compacting never changes what the spec means', () => {
  const out = compactJsonc(formatJsonc(FMT_SRC));
  deepEq(JSON.parse(stripJsonc(out)), JSON.parse(stripJsonc(FMT_SRC)), 'same data');
});

test('expanded actually expands an already-compact spec', () => {
  // _formatJsonc only re-indents the lines it is GIVEN; it never splits one. So
  // without an expander, switching back to Expanded on a compact spec did
  // nothing at all — the button looked dead.
  const compactSrc = '[\n  { "skip": { "length": 9 } },\n  { "read": "A" }\n]';
  const out = expandJsonc(compactSrc);
  assert.ok(out.split('\n').length > compactSrc.split('\n').length,
    `expected more lines, got:\n${out}`);
  assert.ok(/^ *"length": 9,?$/m.test(out), 'each attribute on its own line');
});

test('the Format control expands before it decides, and the button is gone', () => {
  // _formatJsonc only re-indents the lines it is given, so formatting a spec
  // that is ALREADY compact must expand it first or "Expanded" does nothing.
  // Tested on the CALLER: the helper being right proved nothing here.
  const src = psFnSource('_mePsFmt');
  assert.ok(/_expandJsonc\(current/.test(src), '_mePsFmt normalises via _expandJsonc');
  assert.ok(/_compactJsonc\(expanded\)/.test(src), 'and compacts from that');
  // The pill applies the format, so a separate Format button is a second way to
  // do the same thing.
  assert.ok(!/aria-label="Format"/.test(html), 'the redundant Format button is gone');
  assert.ok(/_mePsSetFmtMode\('compact'\)/.test(html) && /_mePsSetFmtMode\('expanded'\)/.test(html),
    'both pill options are present');
});

test('expand and compact are inverses, and neither changes the data', () => {
  const compactSrc = '[\n  { "skip": { "length": 9 } },\n  { "read": "A" }\n]';
  const round = compactJsonc(expandJsonc(compactSrc));
  eq(round.trim(), compactSrc.trim(), 'compact(expand(x)) returns x');
  deepEq(JSON.parse(stripJsonc(round)), JSON.parse(stripJsonc(compactSrc)), 'same data');
});

test('expanding keeps a trailing comment with the element it annotates', () => {
  // Breaking after the comma before copying the comment would move the note
  // onto the NEXT block, silently reassigning what it describes.
  const src = '[\n  { "read": "A" }, // about A\n  { "read": "B" }\n]';
  const out = expandJsonc(src);
  const noteLine = out.split('\n').find(l => /about A/.test(l));
  assert.ok(noteLine, 'the comment survives');
  // It must still sit ON the line that closes A. Breaking after the comma first
  // would put it alone on the next line, which reads as a note about B.
  assert.ok(/\},\s*\/\/ about A/.test(noteLine),
    `the note must stay attached to A's closing line, got: ${JSON.stringify(noteLine)}`);
});

test('a brace inside a string does not fool the scanner', () => {
  const src = '[\n  {\n    "read-fixed": { "as": "A}B", "length": 2 }\n  }\n]';
  const out = compactJsonc(formatJsonc(src));
  deepEq(JSON.parse(stripJsonc(out)), JSON.parse(stripJsonc(src)), 'same data');
  assert.ok(/"as": "A\}B"/.test(out), 'the string is intact');
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
  // An inline override that behaved differently from a stored one would be the
  // same override meaning two things.
  const ctx = inlRun([{ 'read-ddl': { overrides: { MSGTYPE: { type: 'hex-char' } } } }]);
  eq(inlF(ctx, 'MSGTYPE').value, '31323030', 'the inline type override was applied to every declared byte');
  eq(inlF(ctx, 'MSGTYPE').typeOverride, 'hex-char', 'and recorded as an override');
  eq(inlF(ctx, 'TRACE').typeOverride, undefined, 'a field it does not mention gets no override');
  eq(inlF(ctx, 'TRACE').value, '000123', 'and does not move — a type resizes nothing');
});

test('an inline WIDTH override does re-lay out the fields after it', () => {
  // The discriminating half: a type moves nothing, but a width moves everything
  // after it. Without this pair, "nothing moved" could mean the inline override
  // was never applied at all.
  const ctx = inlRun([{ 'read-ddl': { overrides: { MSGTYPE: { bytes: 2 } } } }]);
  eq(inlF(ctx, 'MSGTYPE').rawHex.length / 2, 2, 'MSGTYPE gives back two bytes');
  eq(inlF(ctx, 'TRACE').value, '000001', 'so TRACE reads from where MSGTYPE now ends');
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
  // A type renders the bytes; it no longer decides how many there are.
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
  // Both spellings: a literal at the call site, and the `const X_KEY = 'up_…'`
  // form. The regex only saw the first, so a key held in a constant — which is
  // the tidier way to write it — escaped the guard entirely.
  const keys = [...new Set([
    ...[...html.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'/g)].map(m => m[1]),
    ...[...html.matchAll(/const\s+_[A-Z0-9_]*KEY\s*=\s*'(up_[^']+)'/g)].map(m => m[1]),
  ])];
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

// ── The diagnostic table colours the line, not the glyph ─────────────────────
// The ✓/✗/— was inside the coloured span and the sentence was outside it, so
// every line inherited the container's orange !important and the only coloured
// thing on screen was a tick a few pixels wide. A reader could not tell which
// steps had passed without reading each one.
console.log('\ndiagnostic table — status colours the whole line');

test('every diag row wraps its text in the status span, not just the marker', () => {
  const src = fs.readFileSync('./source.html', 'utf8');
  const defs = src.split('\n')
    .map((l, i) => ({ n: i + 1, l: l.trim() }))
    .filter(x => /^const (ok|fail|inf)\s*=\s*s =>/.test(x.l));
  assert.ok(defs.length >= 6, `expected the diag helpers, found ${defs.length}`);
  const stray = defs.filter(x => !/^const \w+\s*=\s*s => `<span class="diag-\w+">.+ \$\{s\}<\/span>`;$/.test(x.l))
                    .map(x => `line ${x.n}: ${x.l}`);
  deepEq(stray, [], 'the status span must close AFTER ${s}, so the sentence is coloured too');
});

test('the diag panels do not drift apart', () => {
  // Two panels define the same three helpers. They were identical when this was
  // written; if one is fixed and the other is not, the bug half-survives.
  const src = fs.readFileSync('./source.html', 'utf8');
  const byName = {};
  for (const l of src.split('\n').map(s => s.trim())) {
    const m = /^const (ok|fail|inf)\s*=\s*s =>(.*)$/.exec(l);
    if (m) (byName[m[1]] || (byName[m[1]] = new Set())).add(m[2]);
  }
  for (const [name, forms] of Object.entries(byName))
    eq(forms.size, 1, `${name}() is defined ${forms.size} different ways`);
});

test('success is the palette colour, not a hard-coded green', () => {
  // #4caf80 was picked for the dark theme and never revisited; the light palette
  // defines --success as a much darker green for a reason.
  const src = fs.readFileSync('./source.html', 'utf8');
  const rule = /\.diag-ok\s*\{([^}]*)\}/.exec(src);
  assert.ok(rule, '.diag-ok rule not found');
  assert.ok(/color:\s*var\(--success\)/.test(rule[1]),
    `.diag-ok must use var(--success), got: ${rule[1].trim()}`);
});

// ── The theme system: a theme must stay DATA, never a patch ─────────────────
// Dark used to live in :root and light re-patched it in 90 `body.light` rules.
// Two things went wrong with that, and each test below pins one of them.

console.log('\ntheme system — themes are data, not patches');

test('data-theme is on <html> in the markup, not applied by script', () => {
  // It selects the Layer 3 token block. If it is not present before scripts
  // run, the very first paint has no tokens at all and renders unstyled — and
  // if scripts never run, it stays that way.
  const src = fs.readFileSync('./source.html', 'utf8');
  assert.ok(/<html[^>]*\sdata-theme="(dark|light)"/.test(src),
    '<html> must carry a default data-theme attribute');
});

test('picking a volume never discards unsaved editor content', () => {
  // Reported: type a definition with nothing selected, get told to pick a
  // volume, pick one — and the definition is gone. The prompt was impossible to
  // satisfy. The container branch cleared unconditionally, and the DDL branch's
  // unsaved-changes guard only ran when a file had been opened, so content
  // typed from scratch was invisible to both.
  const src = fs.readFileSync('./source.html', 'utf8');
  const fn = /function selectScope\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(src);
  assert.ok(fn, 'selectScope not found');
  const body = fn[1];
  assert.ok(/if \(!S\.stagingActive && !_ddlEditorDirty\(\)\)/.test(body),
    'the vol/sv branch must not clear the editor while it holds unsaved work');
  assert.ok(!/S\.editorBaseline !== null\)\s*\{[\s\S]{0,200}isDifferentFile/.test(body),
    'the unsaved-changes guard must not require a previously opened file');

  // And the discard path must not re-enter. Setting the baseline to null used
  // to bypass the guard on the second call; once the guard also covers
  // typed-from-scratch content, null reads as "clean is empty", the editor
  // still looks dirty, and the confirm reopens forever.
  assert.ok(!/if \(ok\) \{ S\.editorBaseline = null; selectScope\(/.test(body),
    'discarding must not null the baseline — it re-triggers the same confirm');
  assert.ok(/S\.editorBaseline = document\.getElementById\('ddlEditor'\)\.value;/.test(body),
    'discarding marks the buffer clean so the retry gets through');
});

test('every settings section lives inside the settings body', () => {
  // Removing the easter-egg accent row took one </div> too many, which closed
  // .settings-body early. Seven sections became siblings of it instead of
  // children — the drawer rendered with a large blank gap and everything below
  // Appearance sat outside the scroll container. Nothing threw and every test
  // passed; only looking at it revealed the break. Div nesting is checked here
  // because a mismatched tag is invisible to a CSS or behaviour assertion.
  const src = fs.readFileSync('./source.html', 'utf8');
  const start = src.indexOf('<div class="settings-body">');
  assert.ok(start >= 0, '.settings-body not found');
  // Walk div open/close tags from the body's start until it closes.
  let depth = 0, end = -1;
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(src))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) { end = m.index; break; }
  }
  assert.ok(end > start, '.settings-body never closes');
  const inside = src.slice(start, end);
  const total  = (src.match(/<div class="settings-section"[^>]*>/g) || []).length;
  const within = (inside.match(/<div class="settings-section"[^>]*>/g) || []).length;
  assert.ok(total >= 6, `expected the settings sections, found ${total}`);
  eq(within, total, `${total - within} settings-section(s) fell outside .settings-body`);
});

test('there are no body.light rules at all', () => {
  // Started at 90. Each was a hand-written light-mode value for one component,
  // which is what made a third theme impractical: every new theme needed its
  // own 90. All are gone — each became a token both themes supply — and the
  // `light` class on <body> went with the last of them. A new one appearing
  // means someone patched a component instead of adding a token, and the theme
  // stops being data again.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'))
                 .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/body\.light[^{]*\{/g)].map(m => m[0].trim());
  eq(rules.length, 0, `body.light rules found: ${rules.join(' | ')}`);
  // and nothing sets the class either
  assert.ok(!/classList\.(toggle|add)\(\s*['"]light['"]/.test(src),
    'nothing should still be applying a `light` class');
});

test('every token used is defined in BOTH themes, or in neither', () => {
  // A token defined only in dark silently falls through to dark's value in
  // light — which looks like "light theme is broken" and is invisible in code
  // review. Light and dark are peers; neither is a base for the other.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const grab = sel => {
    const i = css.indexOf(sel);
    assert.ok(i >= 0, `${sel} block not found`);
    const body = css.slice(i + sel.length, css.indexOf('\n}', i));
    return new Set((body.match(/^\s*(--[a-z0-9-]+)\s*:/gim) || [])
      .map(d => d.trim().replace(/\s*:$/, '')));
  };
  const dark = grab('[data-theme="dark"] {');
  const light = grab('[data-theme="light"] {');
  const onlyDark = [...dark].filter(t => !light.has(t));
  const onlyLight = [...light].filter(t => !dark.has(t));
  eq(onlyDark.length, 0, `defined only in dark: ${onlyDark.join(', ')}`);
  eq(onlyLight.length, 0, `defined only in light: ${onlyLight.join(', ')}`);
});

test('no component rule paints a background with a hex literal', () => {
  // How the dark title bars survived into the light theme: `.panel-header` set
  // `background:#1c2128` with no body.light counterpart, so light inherited a
  // dark value. Nothing flagged it — a literal with no override is invisible
  // until someone looks at the running app in the other theme. A hex background
  // outside a theme block is that bug waiting to happen.
  const src = fs.readFileSync('./source.html', 'utf8');
  let css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'))
               .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const blk of ['[data-theme="dark"] {', '[data-theme="light"] {']) {
    const i = css.indexOf(blk);
    css = css.slice(0, i) + css.slice(css.indexOf('\n}', i));   // literals are legal in a theme
  }
  // The accent swatches deliberately paint the colour they represent.
  const ALLOW = /^#eggAccent/;
  const bad = [];
  for (const m of css.matchAll(/^([^{}\n][^{}]*)\{([^}]*)\}/gm)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (ALLOW.test(sel)) continue;
    if (/(^|[\s,])background(-color)?\s*:\s*[^;]*#[0-9a-fA-F]{3,6}/.test(m[2]))
      bad.push(sel.slice(0, 60));
  }
  eq(bad.length, 0, `hex background outside a theme block: ${bad.join(' | ')}`);
});

test('no two hue slots collide in either theme', () => {
  // The slots were seeded from whichever badge happened to define each colour
  // first, so one badge's quirk became the whole slot's. Two consequences shipped
  // before this caught them: gray inherited a near-white border from the EBCDIC
  // badge, and in LIGHT theme teal was byte-identical to green while violet
  // shared purple's background — which made every FUP badge indistinguishable
  // from its non-FUP counterpart. Colliding on bg AND fg means two different
  // message types render the same chip.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  for (const theme of ['dark', 'light']) {
    const i = css.indexOf(`[data-theme="${theme}"] {`);
    const body = css.slice(i, css.indexOf('\n}', i));
    const slots = {};
    for (const m of body.matchAll(/--h-([a-z]+)-(bg|fg|bd)\s*:\s*([^;]+);/g))
      (slots[m[1]] ||= {})[m[2]] = m[3].trim();
    const names = Object.keys(slots);
    assert.ok(names.length >= 10, `${theme}: expected the hue slots, got ${names.length}`);
    const seen = new Map();
    for (const n of names) {
      const key = `${slots[n].bg}|${slots[n].fg}`;
      assert.ok(!seen.has(key), `${theme}: slot "${n}" is identical to "${seen.get(key)}" (${key})`);
      seen.set(key, n);
    }
  }
});

test('the vertical panel title stays scoped to collapsed panels', () => {
  // An edit anchored on `.panel-title {` matched the tail of
  // `.panel.collapsed .panel-header .panel-title {` and split that selector,
  // leaving writing-mode:vertical-rl on a bare `.panel-title` rule — every
  // panel title rendered sideways while expanded. Nothing threw and no test
  // noticed; it was visible only on screen. `.panel-title` is a SUFFIX of the
  // collapsed selector, so any anchor on it is unsafe.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'))
                 .replace(/\/\*[\s\S]*?\*\//g, '');
  // Walk back from each declaration to its selector. An earlier version of this
  // test iterated whole rules with a regex that consumed the previous rule's
  // closing brace, so every second rule was skipped — including this one, and
  // it passed while the bug was present.
  let found = 0;
  for (const m of css.matchAll(/writing-mode\s*:\s*vertical/g)) {
    const before = css.slice(0, m.index);
    const open   = before.lastIndexOf('{');
    const prev   = Math.max(before.lastIndexOf('}', open), before.lastIndexOf('{', open - 1));
    const sel    = before.slice(prev + 1, open).trim().replace(/\s+/g, ' ');
    found++;
    assert.ok(/\.collapsed/.test(sel),
      `vertical writing-mode must be scoped to a collapsed panel, found on: "${sel}"`);
  }
  assert.ok(found > 0, 'the collapsed vertical-title rule still exists');
});

test('the audit record detail is a resizable pane, not a floating popup', () => {
  // It was position:absolute at a fixed 220px, pinned to the bottom of the
  // record list — so it covered the last rows and no drag could change it.
  // It is a sibling in the same flex column now, sized like #ddlTreePane: the
  // drag handler writes the element's own height, so the pane must not be
  // absolutely positioned and must not grow on its own.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'))
                 .replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /\.audit-popup\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, '.audit-popup rule is gone');
  assert.ok(!/position\s*:\s*absolute/.test(rule[1]), 'the pane must not float over the list');
  assert.ok(!/z-index/.test(rule[1]), 'an in-flow pane needs no stacking order');
  assert.ok(/flex\s*:\s*none/.test(rule[1]), 'the pane carries its own size, so it must not flex');
  assert.ok(/height\s*:\s*\d+px/.test(rule[1]), 'and it needs a default height to start from');
  // The list has to be able to give the space back. A flex item defaults to
  // min-height:auto, which floors it at its content height.
  const list = /\.audit-record-list\s*\{([^}]*)\}/.exec(css);
  assert.ok(list && /min-height\s*:\s*0/.test(list[1]),
    'the record list must be allowed to shrink, or the pane is pushed off the bottom');
  // Markup: the gutter sits between the list and the pane, in that order.
  const iList = src.indexOf('id="auditRecordList"');
  const iRez  = src.indexOf('id="auditDetailResizer"');
  const iPane = src.indexOf('id="auditPopup"');
  assert.ok(iRez > 0, 'no resizer between the list and the detail');
  assert.ok(iList < iRez && iRez < iPane, 'the resizer must sit between the two, in DOM order');
  assert.ok(/id="auditDetailResizer"[^>]*class="resizer-v"|class="resizer-v"[^>]*id="auditDetailResizer"/.test(src),
    'a stacked split takes the horizontal bar (.resizer-v), the one that drags on Y');
});

test('the audit detail pane and its resizer are opened and closed together', () => {
  // Five places read or wrote the pane's display directly. A handle left behind
  // by a closed pane is a gutter you can drag with nothing on the far side of
  // it — so both now go through one setter, and nothing else touches display.
  const src = fs.readFileSync('./source.html', 'utf8');
  const setter = psFnSource('_auditSetDetailOpen');
  // Looking an element up is not moving it — the first version of this test
  // asserted only that both ids appeared, and passed with the resizer's
  // assignment deleted and its lookup left behind.
  for (const [id, what] of [['auditPopup', 'pane'], ['auditDetailResizer', 'resizer']]) {
    const v = new RegExp(`const (\\w+)\\s*=\\s*document\\.getElementById\\('${id}'\\)`).exec(setter);
    assert.ok(v, `the setter does not look up the ${what}`);
    assert.ok(new RegExp(`\\b${v[1]}\\.style\\.display\\s*=`).test(setter),
      `the setter looks up the ${what} but never moves it`);
  }
  // No stragglers. Every lookup of the pane must live in a function that owns
  // it — the two display helpers, the drag, and the three layout functions that
  // read its height. Anywhere else is a place the resizer can drift out of sync.
  const OWNERS = ['_auditDetailOpen', '_auditSetDetailOpen', 'initAuditDetailResizer',
                  'saveLayout', 'loadLayout', 'resetLayout'];
  const count = s => [...s.matchAll(/getElementById\('auditPopup'\)/g)].length;
  const total   = count(src);
  const inOwner = OWNERS.reduce((n, f) => n + count(psFnSource(f)), 0);
  eq(inOwner, total, `every #auditPopup lookup must sit in one of: ${OWNERS.join(', ')}`);
  // And display is written in exactly one of them.
  const writers = OWNERS.filter(f => /style\.display\s*=/.test(psFnSource(f)));
  deepEq(writers, ['_auditSetDetailOpen'], 'only the setter may write the pane display');
  // And the close button still closes it, which is the one way this pane
  // differs from the tree pane it is modelled on.
  assert.ok(/onclick="auditClosePopup\(\)"/.test(src), 'the ✕ still closes the pane');
  assert.ok(/_auditSetDetailOpen\(false\)/.test(psFnSource('auditClosePopup')),
    'and closing goes through the setter, so the resizer goes with it');
});

test('the audit detail height survives a reload, and a layout reset', () => {
  // Same round trip the tree pane width takes, and through the same key — a
  // pane you can resize but that forgets on reload is worse than a fixed one.
  const src = fs.readFileSync('./source.html', 'utf8');
  assert.ok(/layout\.auditDetailHeight = auditPane\.style\.height/.test(psFnSource('saveLayout')),
    'saveLayout does not record the height');
  assert.ok(/auditPane\.style\.height = layout\.auditDetailHeight/.test(psFnSource('loadLayout')),
    'loadLayout does not restore it');
  assert.ok(/auditPane\.style\.height = ''/.test(psFnSource('resetLayout')),
    'resetLayout leaves the pane at whatever it was dragged to');
  // It rides in up_layout, so §13 gains no key it would have to document.
  assert.ok(!/up_audit[a-z_]*/.test(src), 'the height must not take a storage key of its own');
  // The drag must end in a save, or the height is only remembered until reload.
  const rez = psFnSource('initAuditDetailResizer');
  assert.ok(/saveLayout\(\)/.test(rez), 'the drag never persists what it changed');
  assert.ok(/startH - \(ev\.clientY - startY\)/.test(rez),
    'the pane grows UPWARD — dragging the gutter down must shrink it');
  assert.ok(/Math\.max\(_AUDIT_DETAIL_MIN, Math\.min\(maxH/.test(rez), 'the drag is unclamped');
});

test('every collapsed panel title starts at the TOP of its rail', () => {
  // Reported: minimising DDL Definition dropped its title to the bottom of the
  // rail while Parse Results kept its at the top. Same rule, different result —
  // because `transform: rotate(180deg)` rotates the flex axis along with the
  // box, so the shared `justify-content: flex-start` means the BOTTOM for a
  // rotated title. Parse Results only escaped it by accident: its title carries
  // an inline `flex: 0 1 auto` for the expanded header's ellipsis, and a
  // content-sized box has no free space to place at either end.
  //
  // So a rotated title has to say flex-END to sit at the top. Every panel is
  // checked, not just the one that was reported — the next panel added is the
  // one that would inherit this silently.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'))
                 .replace(/\/\*[\s\S]*?\*\//g, '');
  const panels = [...src.matchAll(/<div class="panel" id="(\w+)">/g)].map(m => m[1]);
  assert.ok(panels.length >= 4, `expected the four panels, found ${panels.length}`);

  // Every rule as (selector, body). The delimiter is never consumed — matching
  // on the previous rule's closing brace is what made the test above pass while
  // its bug was live, and it would have skipped every second rule here too.
  const RULES = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map(m => [m[1].trim().replace(/\s+/g, ' '), m[2]]);
  // Which titles the stylesheet un-rotates, and which it anchors at the far end.
  const declares = (id, prop, val) => RULES.some(([sel, body]) =>
    sel.includes(`#${id}.collapsed`) && sel.includes('.panel-title') &&
    new RegExp(`${prop}\\s*:\\s*${val}\\b`).test(body));
  const base = /\.panel\.collapsed \.panel-header \.panel-title \{([^}]*)\}/.exec(css);
  assert.ok(base, 'the collapsed title rule is gone');
  assert.ok(/transform\s*:\s*rotate\(180deg\)/.test(base[1]),
    'the base rule still rotates, which is what flips the axis');
  assert.ok(/justify-content\s*:\s*flex-start/.test(base[1]),
    'and still anchors at flex-start, which the rotation turns into the bottom');

  const bottomAnchored = panels.filter(id => {
    if (declares(id, 'transform', 'none')) return false;        // reads top-down: flex-start IS the top
    if (declares(id, 'justify-content', 'flex-end')) return false; // rotated, and says so
    // A content-sized title box cannot be pushed to either end.
    const tag = new RegExp(`id="${id}Title"[^>]*style="[^"]*flex\\s*:\\s*0 1 auto`).test(src);
    return !tag;
  });
  deepEq(bottomAnchored, [],
    'collapsed panels whose title is rotated but still anchored at flex-start, so it sits at the bottom');
});

// ── The compiled-DDL cache must outlive a release ───────────────────────────
console.log('\ncompiled-DDL cache — keyed on the compiler, not the app');

test('the compiled cache is keyed per FILE, and survives a release', () => {
  // Two separate regressions live here.
  //
  // 1) It used to be gated on APP_VERSION, so every release threw the whole
  //    cache away and the next parse recompiled every definition.
  // 2) It was stored and hashed per SUBVOLUME. BASE/DDL alone holds most of a
  //    300-definition tree, so editing one file recompiled every file beside
  //    it — even though the compiled entries were always per-file
  //    ({ path, defName, defs }); only the key and the hash were coarse.
  const src = fs.readFileSync('./source.html', 'utf8');

  assert.ok(/const DDL_COMPILER_VERSION\s*=\s*\d+/.test(src),
    'a compiler version must exist to key the cache on');
  assert.ok(/function _fileHash\(vol, sv, file\)/.test(src),
    'a per-file hash must exist — a subvolume hash cannot express one changed file');

  const put = /store\.put\(\{\s*fk[\s\S]{0,240}?\}\)/.exec(src);
  assert.ok(put, 'cache write not found, or no longer keyed by file');
  assert.ok(/compilerVersion:\s*DDL_COMPILER_VERSION/.test(put[0]),
    'the entry must record the compiler version');
  assert.ok(/hash:\s*_fileHash\(/.test(put[0]),
    'the entry must be hashed on the FILE, not the subvolume');

  const gate = /if \(stored\.hash !== _fileHash\([\s\S]{0,140}?\)\s*\{/.exec(src);
  assert.ok(gate, 'per-file restore gate not found');
  assert.ok(/stored\.compilerVersion !== DDL_COMPILER_VERSION/.test(gate[0]),
    'the restore gate must compare the COMPILER version');
  assert.ok(!/stored\.appVersion === APP_VERSION/.test(src),
    'keying on APP_VERSION makes every release a full recompile');

  // The coarse hash is gone entirely — leaving it invites a caller back.
  assert.ok(!/function _svHash\(/.test(src),
    '_svHash should be removed once nothing decides reuse per subvolume');
});

// ── Expand all / collapse all must not sweep in the inverted key ────────────
console.log('\ntree — expand all leaves the inverted key alone');

test('expand-all never touches the missing-refs key', () => {
  // S.treeExp holds node keys where PRESENT = expanded, plus one key,
  // '::missing-refs', where PRESENT = COLLAPSED. Sweeping every key in the Set
  // would collapse Missing refs on "expand all" and open it on "collapse all" —
  // backwards on both. _treeExpandableKeys builds its list from the DDL tree,
  // so the inverted key cannot get in by construction rather than by filtering.
  const fn = /function _treeExpandableKeys\(\)\s*\{([\s\S]*?)\n\}/.exec(APP_SRC);
  assert.ok(fn, '_treeExpandableKeys not found');
  assert.ok(!/_MISSREF_KEY/.test(fn[1]),
    'the key list must be built from the tree, never from the Set');
  assert.ok(/S\.ddlTree/.test(fn[1]), 'it is derived from the DDL tree');

  const toggle = /function toggleTreeExpandAll\(\)\s*\{([\s\S]*?)\n\}/.exec(APP_SRC);
  assert.ok(toggle, 'toggleTreeExpandAll not found');
  assert.ok(!/treeExp\.clear\(\)/.test(toggle[1]),
    'clearing the Set would take the inverted key with it — remove keys individually');
  assert.ok(/_treeExpandableKeys\(\)/.test(toggle[1]),
    'it must operate on the derived list');
});

// ── "Not found in bound DDLs" needs bound DDLs to be true ───────────────────
console.log('\nparse-spec lint — no bindings is one problem, not many');

test('field references are not reported missing when nothing is bound', () => {
  // With no binding, ddlIds is empty, so every reference "was not found" — and
  // the panel filled with red about fields that are probably fine, all caused by
  // the single fact the user already knows and that read-ddl states on its own
  // line. The sibling checks (read-bitmap.field, seg-map) always guarded on
  // bindingCount && ddlIds.size; checkRef did not.
  const lint = sandbox._t.mePsLintWarns;
  const spec = [{ read: { field: 'TYP' } },
                { 'read-ddl': { binding: 0, from: 'ISO_PFX', until: 'MTI' } }];

  const unbound = lint({ label: 'X', ddl_bindings: [], parse_spec_binary: spec }, spec);
  assert.ok(!unbound.some(w => /not found in bound DDLs/.test(w)),
    `nothing is bound, so nothing can be "not found" — got: ${JSON.stringify(unbound)}`);
  assert.ok(unbound.some(w => /no DDL bindings/.test(w)),
    'the one real problem must still be reported');
  assert.strictEqual(unbound.length, 1,
    `one cause should read as one warning — got: ${JSON.stringify(unbound)}`);
});

// ── An armed entity override has to be visible wherever it changes behaviour ─
console.log('\nentity override — the app must say when it is on');

test('the detection summary does not claim a forced run was evaluated', () => {
  // A forced trace carries ONE row and that row is `passed`, so the near-miss
  // loop dropped it and the summary printed "N evaluated — N matched". Nothing
  // was evaluated: _fmtDetect short-circuits to the forced spec before any
  // recognizer runs. The panel was describing work that did not happen.
  const details = sandbox._t.ppDetectDetails;
  const strip = rows => rows.map(d => String(d.html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim());
  const winner = { type: 'ISO', label: 'ISO 8583 BIC', color: '#e6a817' };

  const forced = strip(details([{ winner, forced: true, trace: [{ label: 'ISO 8583 BIC', passed: true, forced: true }] }], 'message'));
  assert.ok(/forced by entity override/i.test(forced[0]), `forced header, got: ${forced[0]}`);
  assert.ok(/not evaluated/i.test(forced[0]), 'the forced header must say recognizers did not run');
  assert.ok(!/evaluated —/.test(forced[0]), 'it must not read as a normal evaluation');
  assert.ok(/Forced as/.test(forced[1]), `forced verb, got: ${forced[1]}`);

  // The ordinary path is untouched — the wording only changes when forced.
  const normal = strip(details([{ winner, trace: [] }], 'message'));
  assert.ok(/evaluated/.test(normal[0]) && /matched/.test(normal[0]), `normal header, got: ${normal[0]}`);
  assert.ok(/Matched as/.test(normal[1]), `normal verb, got: ${normal[1]}`);
});

test('an armed entity override shows in Settings, not only in the editor', () => {
  // The Data Editor marked it (me-item-forced) and Settings → Data Detection
  // did not, so the same fact about the same entity was visible in one list and
  // invisible in the other. Both must read from isSpecOverride.
  const list = /function renderDetectSpecsList\(\)\s*\{([\s\S]*?)\n\}/.exec(APP_SRC);
  assert.ok(list, 'renderDetectSpecsList not found');
  assert.ok(/isSpecOverride\(/.test(list[1]),
    'the Settings list must consult isSpecOverride, or an armed override is invisible there');
  const css = fs.readFileSync('./source.html', 'utf8');
  assert.ok(/\.dr-spec-item\.dr-spec-forced\s*\{/.test(css),
    'the armed row needs its own treatment');
  const toggle = /function toggleSpecOverride\(idx\)\s*\{([\s\S]*?)\n\}/.exec(APP_SRC);
  assert.ok(toggle, 'toggleSpecOverride not found');
  assert.ok(/renderDetectSpecsList\(\)/.test(toggle[1]),
    'toggling the override must refresh the Settings list, as it already refreshes the tree');
});

test('the parse overlay announces an armed entity override', () => {
  // The DDL override prints an amber "Manual override mode" step. The entity
  // override printed nothing and the run looked like a normal detection.
  assert.ok(/Entity override — \$\{_armedSpec\}/.test(APP_SRC),
    'the parse flow must emit an override step when S.specOverride is armed');
  // Wording matters: the DDL override also skips the parse-spec, this one does
  // not — the forced entity's parse-spec and bindings still run. A notice that
  // overstates what was skipped is its own bug.
  const step = /Entity override — \$\{_armedSpec\}`,\s*'([^']*)'/.exec(APP_SRC);
  assert.ok(step, 'override step sub-label not found');
  assert.ok(!/Parse-specs/i.test(step[1]),
    `an entity override does not skip parse-specs — got: ${step[1]}`);
  assert.ok(/Recognizers/i.test(step[1]), `it does skip recognizers — got: ${step[1]}`);
});

// ── Import identity: the bug that ate two messages out of three ─────────────
console.log('\nimport — a bundle must arrive intact');

test('spec identity is the type code AND the label together', () => {
  // Neither field identifies an entity on its own. `name` is the badge's type
  // code and is shared — the shipped defaults carry three called ISO and three
  // called B24 — so keying on it collapsed three incoming ISO messages onto one
  // slot. The label alone was the first fix; the rule is the PAIR, so changing
  // either field makes it a different entity.
  const specKey = sandbox._t.specKey;
  const std = { name: 'ISO', label: 'ISO 8583 Standard' };
  const bic = { name: 'ISO', label: 'ISO 8583 BIC' };
  assert.notStrictEqual(specKey(std), specKey(bic),
    'same type code, different label — different entities');
  assert.notStrictEqual(specKey({ name: 'ISO', label: 'X' }), specKey({ name: 'I2', label: 'X' }),
    'same label, different type code — different entities');
  assert.strictEqual(specKey({ name: 'ISO', label: 'X' }), specKey({ name: 'ISO', label: 'X' }),
    'same pair — one entity');

  // Case and padding are noise: a near-miss that imports as "new" leaves the
  // user reconciling a duplicate by hand, which is the other half of the bug.
  assert.strictEqual(specKey({ name: 'iso', label: '  iso 8583 bic ' }), specKey(bic));

  // The separator must not be forgeable out of the fields themselves, or
  // "AB" + "C" and "A" + "BC" would key alike.
  assert.notStrictEqual(specKey({ name: 'AB', label: 'C' }), specKey({ name: 'A', label: 'BC' }));

  // No label falls back to the type, so an unlabelled spec still keys by
  // something rather than by the separator alone.
  assert.strictEqual(specKey({ name: 'MYMSG' }), specKey({ name: 'MYMSG', label: 'MYMSG' }));
});

test('adding entities never seeds a duplicate identity', () => {
  // + New seeded every message as NEW / "New Message", so pressing it twice
  // produced two entities the app cannot tell apart. _meUniqueLabel walks the
  // label until the type+label pair is free.
  const src = fs.readFileSync('./source.html', 'utf8');
  for (const fn of ['_meAddMsg', '_meAddOther', '_meAddFile']) {
    const m = new RegExp('function ' + fn + '\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}').exec(src);
    assert.ok(m, fn + ' not found');
    assert.ok(/_meUniqueLabel\(/.test(m[1]),
      fn + ' must seed a label that is not already taken');
  }
});

test('the default specs really do collide on name but not on label', () => {
  // The premise of the test above, checked against the shipped data rather than
  // assumed — if the defaults ever stopped colliding, the test would go quietly
  // vacuous and stop guarding anything.
  const specKey = sandbox._t.specKey;
  const defaults = sandbox._t.fmtDefaultSpecs();
  assert.ok(Array.isArray(defaults) && defaults.length, 'defaults load');
  const names  = defaults.map(s => String(s.name || '').toUpperCase());
  const labels = defaults.map(specKey);
  assert.ok(names.length !== new Set(names).size,
    'the defaults are expected to share type codes — that is why name cannot be the key');
  assert.strictEqual(labels.length, new Set(labels).size,
    'labels must stay unique across the defaults, or import has no safe key at all');
});

test('import merges on identity, and rebuilds the token map', () => {
  // Both halves of the reported bug, pinned at the source. confirmImport must
  // not key a Map on `name`, and it must re-run buildTokenMap: token IDs are
  // derived from the imported DDL text, so badges stay missing until it does.
  const fn = /function confirmImport\(\)\s*\{([\s\S]*?)\n\}/.exec(APP_SRC);
  assert.ok(fn, 'confirmImport not found');
  const body = fn[1];
  assert.ok(!/new Map\(currentSpecs\.map\(\(s, i\) => \[\(s\.name/.test(body),
    'confirmImport must not key specs by name — that collapses ISO/B24 onto one slot');
  assert.ok(/_specKey\(/.test(body),
    'confirmImport must merge on _specKey');
  assert.ok(/buildTokenMap\(\)/.test(body),
    'confirmImport must rebuild the token map, or imported token DDLs show no badge');
});

test('the tutorial card measures in whole pixels', () => {
  // Its width, padding and gap are integers, but the HEIGHT is text-derived, so
  // a unitless line-height leaks a fraction into it: 1.6 on a 12px font is
  // 19.2px, and rules with no line-height fall back to fractional font metrics.
  // The card measured 307.875 tall — three edges clean, the bottom on a half
  // pixel — and it was the last element still looking wrong after the app moved
  // to 1px. --sz-mono is always whole (10/12/14), so calc() off it stays whole.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'))
                 .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of ['.tut-progress', '.tut-title', '.tut-body', '.tut-skip']) {
    const m = new RegExp(sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}').exec(css);
    assert.ok(m, `${sel} rule found`);
    const lh = /line-height:\s*([^;]+)/.exec(m[1]);
    assert.ok(lh, `${sel} must declare a line-height, or it inherits a fractional font metric`);
    assert.ok(!/^\s*[\d.]+\s*$/.test(lh[1]),
      `${sel} must not use a unitless multiplier — got line-height: ${lh[1].trim()}`);
  }
});

test('a dialog outranks every surface that can raise one', () => {
  // .modal-overlay carries the prompt/confirm box, the export and DDL-doc
  // modals and the parse-progress box. At 25000 it sat UNDER .settings-overlay
  // (30000), so "Erase All Data" — a prompt raised from Settings — appeared over
  // the dimmed main page, read as disabled, and could not be clicked at all.
  // Neither the export nor the import opener closes Settings first, so the same
  // trap was waiting for them. A dialog has to outrank anything that opens it.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'))
                 .replace(/\/\*[\s\S]*?\*\//g, '');
  const zOf = sel => {
    const m = new RegExp(sel.replace(/[.#]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css);
    const z = m && /z-index:\s*(\d+)/.exec(m[1]);
    return z ? +z[1] : null;
  };
  const modal = zOf('.modal-overlay');
  const settings = zOf('.settings-overlay');
  const editor = zOf('.me-overlay');
  const toast = zOf('#toast');
  assert.ok(modal && settings && editor && toast, 'all four layers declare a z-index');
  assert.ok(modal > settings,
    `a dialog must sit above the settings drawer — modal ${modal} vs settings ${settings}`);
  assert.ok(modal > editor,
    `a dialog must sit above the Data Editor — modal ${modal} vs editor ${editor}`);
  assert.ok(toast > modal,
    `the toast must clear the dialog it reports on — toast ${toast} vs modal ${modal}`);
});

test('the amber collapsed ring stays on panel headers', () => {
  // .panel-toggle.is-collapsed:hover paints an inset amber ring, which reads as
  // "this panel is collapsed". The same button markup is reused in the config
  // dialogs, where is-collapsed means "this column is on" — and there the ring
  // is just a yellow outline nobody asked for.
  //
  // Every one of these selectors weighs three class-level components, so the
  // later rule wins only the properties it NAMES. .settings-row already reset
  // box-shadow for this reason; .audit-cfg-row did not, so the ring leaked into
  // the columns editor. Any future context that restyles the toggle must reset
  // it too, so the requirement is checked for all of them rather than by name.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'))
                 .replace(/\/\*[\s\S]*?\*\//g, '');
  const base = /(^|\n)\.panel-toggle\.is-collapsed:hover\s*\{([^}]*)\}/.exec(css);
  assert.ok(base && /box-shadow:\s*inset/.test(base[2]),
    'the panel header still needs its amber ring — that is the intended signal');

  const missing = [];
  for (const m of css.matchAll(/(^|\n)([^{}\n]*\s\.panel-toggle:hover)\s*\{([^}]*)\}/g)) {
    if (!/box-shadow:\s*none/.test(m[3])) missing.push(m[2].trim());
  }
  deepEq(missing, [],
    'a scoped .panel-toggle:hover must reset box-shadow or the amber ring leaks through');
});

test('an icon button centres its glyph inside its fixed width', () => {
  // .btn.btn-ico pins the width at 30px and zeroes the horizontal padding so ⚙
  // and ✕ — different advance widths — come out the same size. That only works
  // if the flex box also centres: without justify-content the glyph sits at
  // flex-start, measured 2px from the left edge and 22px from the right, about
  // 10px off centre in a box built to look square.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const m = /(^|\n)\.btn-ico\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, '.btn-ico rule not found');
  const decls = m[2];
  assert.ok(/display:\s*inline-flex/.test(decls), '.btn-ico must be a flex box');
  assert.ok(/justify-content:\s*center/.test(decls),
    '.btn-ico fixes its width and drops its padding, so it must centre its glyph — ' +
    `got: ${decls.trim().slice(0, 120)}`);
});

test('controls border with --bw-ctl, containers with --bw', () => {
  // Two width tokens on purpose. The split used to be defensive — --bw-ctl was
  // 2px to hide a two-tone edge on 1px coloured borders — and that turned out
  // not to be a CSS problem at all: the machine seeing it drove a TV over HDMI
  // with a subsampled chroma format, which averages colour across neighbouring
  // pixels and erases a 1px coloured line while leaving luminance-only greys
  // intact. Proven by elimination on one button (border, box-shadow and outline
  // all wrong at 1px on a whole-pixel box at dpr 1) and fixed by a display
  // setting, not a stylesheet.
  //
  // So the split is now structural: containers vs controls, same value today.
  // The widths are deliberately NOT pinned to specific pixel counts here —
  // pinning 2px is what this test used to do, and it would have to be edited
  // every time the design moves. What must not rot is that every control goes
  // through one token and every container through the other.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'))
                 .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/--bw:\s*\d+px/.test(css), '--bw is declared');
  assert.ok(/--bw-ctl:\s*\d+px/.test(css), '--bw-ctl is declared');
  const rule = sel => {
    const m = new RegExp('(?:^|\\n)' + sel.replace(/[.#]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css);
    return m && m[1];
  };
  const btn = rule('.btn');
  assert.ok(btn, '.btn rule found');
  assert.ok(/border:\s*var\(--bw-ctl\)/.test(btn), `.btn must use --bw-ctl, got: ${btn.trim().slice(0, 90)}`);
  const panel = rule('.panel');
  assert.ok(panel, '.panel rule found');
  assert.ok(/border:\s*var\(--bw\)/.test(panel), `.panel must use --bw, got: ${panel.trim().slice(0, 90)}`);

  // Badges take --bw-ctl too. They were tried at the hairline on the theory that
  // a pill's curved ends hide the split — the user checked every font size and
  // every one looked wrong, so the theory was dropped. In this layout 21 of 24
  // badge tops land on fractional pixels; in the prototype, whose 1px badges do
  // look right, 19 of 27 land on whole ones. Same border, different layout.
  // .badge itself carries no border — the colour variants do.
  const badge = rule('.badge-hex');
  assert.ok(badge, '.badge-hex rule found');
  assert.ok(/border:\s*var\(--bw-ctl\)\s/.test(badge),
    `.badge-hex must use --bw-ctl, got: ${badge.trim().slice(0, 90)}`);

  // Text inputs are controls too, and they were the gap: the export modal's
  // filter box and the Field Map filter both shipped at --bw while every button
  // beside them sat at --bw-ctl, so they drew the two-tone edge the token exists
  // to prevent. Checking .btn and .badge alone did not catch it, so every rule
  // that borders a visible input is swept here rather than named one by one.
  // Anything sized by its own text: controls, and the pill-shaped notices that
  // behave like them. #toast was the one that got away — a text-sized pill
  // centred with translateX(-50%), which puts its edges on half pixels whenever
  // the content width is odd, so it drew the two-tone edge more reliably than
  // any button. #tutorialCard was left on --bw at first on the grounds that a
  // fixed 300px box lands on whole pixels — the user overruled it: a card that
  // reads as a dialog should carry the same edge as one, and the rule is
  // "controls and anything that looks like one", not a pixel-geometry argument.
  //
  // Identified by BEHAVIOUR as well as by name. Name-matching alone missed
  // .me-sel, .me-rb, .me-vlg-len, .audit-sd-op and .audit-dt-copy button — all
  // real controls whose class names abbreviate past the words being looked for
  // ("sel" is not "select"). A rule that sets cursor:pointer or appearance:none
  // is a control whatever it happens to be called.
  const CONTROLish = /input|textarea|select|filter|search|toast|pill|chip/i;
  const behavesLikeControl = d => /cursor:\s*pointer/.test(d) || /appearance:\s*none/.test(d);
  const offenders = [];
  for (const m of css.matchAll(/(^|\n)([^{}\n]+)\{([^}]*)\}/g)) {
    const [, , selector, decls] = m;
    if (!CONTROLish.test(selector) && !behavesLikeControl(decls)) continue;
    // A transparent border paints nothing, so the artifact cannot appear there;
    // #fmtForceSelect uses one purely to reserve layout space.
    if (/border:\s*var\(--bw\)\s+solid\s+(?!transparent)/.test(decls)) {
      offenders.push(selector.trim());
    }
  }
  deepEq(offenders, [],
    'these controls border at the container hairline — text-sized boxes need --bw-ctl');
});

test('the density block is declared after both theme blocks', () => {
  // [data-theme] and [data-density] are both attribute selectors on <html>, so
  // they carry equal specificity and SOURCE ORDER breaks the tie. Declared
  // before the themes, `--shadow-card:none` in compact silently lost to the
  // theme's own value and compact kept its drop shadows — nothing errors, the
  // rule just never applies. Order is load-bearing, so it is pinned here.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const dark    = css.indexOf('[data-theme="dark"] {');
  const light   = css.indexOf('[data-theme="light"] {');
  const density = css.indexOf('[data-density="compact"] {');
  assert.ok(dark >= 0 && light >= 0 && density >= 0, 'all three blocks exist');
  assert.ok(density > dark && density > light,
    'the density block must come after both theme blocks, or its shape tokens lose the tie');
});

test('a font change places the ruler after CodeMirror re-measures, not before', () => {
  // The Line Width ruler is positioned from view.defaultCharacterWidth, which
  // CodeMirror caches and only refreshes during its own measure cycle. applyPrefs
  // changed --sz-mono and then called _lwUpdateDisplay() on the same tick, so the
  // marker was placed with the OLD font's character width: on a 75-column NETARD
  // log, medium -> large put it 90px (about 11 columns) short of the last column.
  //
  // The +/- stepper hid this for months — 1px per click kept the marker roughly
  // one small step behind — and the three-way toggle exposed it by jumping up to
  // 4px at once. The fix is ordering, not arithmetic, so it is pinned here.
  const src = fs.readFileSync('./source.html', 'utf8');
  const fn = /function applyPrefs\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(src);
  assert.ok(fn, 'applyPrefs not found');
  const body = fn[1];
  const calls = [...body.matchAll(/_lwUpdateDisplay\(\)/g)].map(m => m.index);
  assert.ok(calls.length > 0, 'applyPrefs must still place the ruler');
  for (const at of calls) {
    // Every placement must sit inside a requestMeasure callback, or fall on the
    // no-editor branch where there is no cached width to be stale.
    const before = body.slice(0, at);
    const guarded = /requestMeasure\(\{[^}]*write:\s*\(\)\s*=>\s*$/.test(before.trimEnd() + ' ')
      || /requestMeasure\(\{[\s\S]{0,120}$/.test(before);
    const elseBranch = /\}\s*else\s*\{\s*$/.test(before);
    assert.ok(guarded || elseBranch,
      'applyPrefs must not call _lwUpdateDisplay() synchronously — CodeMirror still ' +
      'reports the previous font\'s character width, so the ruler lands short');
  }
  assert.ok(/_msgInputCM\.requestMeasure\(/.test(body),
    'applyPrefs must defer the ruler through _msgInputCM.requestMeasure');
});

test('density moves shape and spacing only, never colour', () => {
  // A density that also shifted colours would be a second theme wearing another
  // name, and the two would drift: switching to compact would silently restyle
  // the palette. Keeping it to geometry is what lets theme × density compose.
  const src = fs.readFileSync('./source.html', 'utf8');
  const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
  const i = css.indexOf('[data-density="compact"] {');
  const body = css.slice(i, css.indexOf('\n}', i));
  // Fails closed: an unrecognised token counts as a colour until it is listed
  // here, so adding a colour to the density block cannot slip through by
  // simply not matching the pattern.
  const SHAPE = /^--(r-|sp-|row-|gap|bw|shadow-)|^--[a-z-]+-[hw]$/;
  const bad = (body.match(/^\s*--[a-z0-9-]+/gim) || [])
    .map(t => t.trim()).filter(t => !SHAPE.test(t.replace(/^--/, '--')));
  eq(bad.length, 0, `density must not set colour tokens: ${bad.join(', ')}`);
});

test('the accent is written to one element, not two', () => {
  // The double-write was a symptom, not a fix. Once no theme block redefines
  // --accent on a descendant, one write to <html> reaches everything. If this
  // regrows a loop over [documentElement, body], the specificity bug is back.
  const src = fs.readFileSync('./source.html', 'utf8');
  // Renamed from _eggSetAccent when the accent stopped being an easter egg and
  // became a setting; the invariant it guards is unchanged.
  const fn = /function _applyAccent\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(src);
  assert.ok(fn, '_applyAccent not found');
  assert.ok(!/document\.body/.test(fn[1]),
    '_applyAccent must not touch document.body — write only to <html>');
});

// ── A help panel nothing can open is a help panel that does not exist ────────
// _meFmToggleHelp was defined, correct, and referenced by nothing: the "?" button
// in the Overrides toolbar had been lost, so the column reference was
// unreachable. The function stayed green in every test because tests call
// functions directly — nothing checked that a user can.
console.log('\nhelp panels — every toggle has a control that calls it');

test('every help toggle is wired to a button in the markup', () => {
  const toggles = [...APP_SRC.matchAll(/^function (_me\w*Toggle\w*Help|_me\w*Help\w*Toggle)\s*\(/gm)]
    .map(m => m[1]);
  assert.ok(toggles.length >= 3, `expected the help toggles, found ${toggles.length}: ${toggles}`);
  const orphans = toggles.filter(fn => !new RegExp(`onclick="${fn}\\(`).test(html));
  deepEq(orphans, [],
    'defined but nothing calls them — the control that opened the panel is gone');
});

test('help section toggles are buttons, not clickable divs', () => {
  // They were <div onclick>, which no keyboard can reach — the help sections
  // were mouse-only. As <button> they are focusable and activate on Enter or
  // Space for free. This also puts them inside the control border rule, which
  // is how the 1px indicator was spotted in the first place.
  const divToggles = [...html.matchAll(/<div[^>]*class="[^"]*h-sub-toggle[^"]*"/g)];
  eq(divToggles.length, 0, `${divToggles.length} help toggles are still <div onclick>`);
  const btnToggles = [...html.matchAll(/<button[^>]*class="[^"]*h-sub-toggle[^"]*"/g)];
  assert.ok(btnToggles.length >= 10,
    `expected the help toggles as buttons, found ${btnToggles.length}`);
  // A button inside a form-less page defaults to type=submit; without this they
  // would be fine here but wrong the moment one ends up inside a <form>.
  for (const m of btnToggles)
    assert.ok(/type="button"/.test(m[0]), `missing type="button": ${m[0].slice(0, 70)}`);
});

test('the Overrides column reference has its "?" button', () => {
  // Named specifically, because this is the one that went missing and the
  // generic check above would pass again the moment someone deletes the
  // function along with the button.
  assert.ok(/id="me-fm-help-btn"[^>]*onclick="_meFmToggleHelp\(\)"/.test(html),
    'the ? button is in the Overrides toolbar');
  assert.ok(/function _meFmToggleHelp\s*\(/.test(APP_SRC), 'and the function it calls exists');
  // It sits with the other toolbar buttons, matching the two ? buttons elsewhere.
  const tb = html.slice(html.indexOf('<div class="me-fm-toolbar">'),
                        html.indexOf('</div>', html.indexOf('me-fm-cols-dlg')));
  assert.ok(/me-fm-help-btn/.test(tb), 'inside the Field Map toolbar');
  assert.ok(/class="btn"[^>]*id="me-fm-help-btn"/.test(html),
    'and carries the same classes as its siblings');
});

// ── The licence notice has to survive the build ──────────────────────────────
// The obfuscator runs with compact:true and strips every comment in the script
// block, so a banner written in the JS would vanish from the file people
// actually receive — and AGPL §13 is only satisfied by what the served app says.
console.log('\nlicensing — the notice reaches the built file');

test('the copyright banner is in the built index.html, not just the source', () => {
  const built = fs.readFileSync('./index.html', 'utf8');
  for (const needle of ['Copyright (C) 2026 Gatunox',
                        'GNU Affero General Public License',
                        'https://github.com/Gatunox/ddl-parser']) {
    assert.ok(built.includes(needle), `missing from index.html: ${needle}`);
    assert.ok(html.includes(needle),  `missing from source.html: ${needle}`);
  }
});

test('the banner sits outside the script block, where comments survive', () => {
  // If it ever moves inside, it still passes a naive "is it in source.html"
  // check and silently disappears from the build.
  const i = html.indexOf('Copyright (C) 2026 Gatunox');
  const scriptAt = html.indexOf('<script id="app">');
  assert.ok(i >= 0 && scriptAt >= 0, 'both markers found');
  assert.ok(i < scriptAt, 'the notice precedes the script the obfuscator rewrites');
  assert.ok(!APP_SRC.includes('Copyright (C) 2026 Gatunox'),
    'and it is not inside the script, where compact:true would strip it');
});

test('AGPL §13: the running app offers its users the source', () => {
  // The clause that makes AGPL work for something served over a network. The
  // FSF's own guidance is a source link in the interface; this is that link.
  const built = fs.readFileSync('./index.html', 'utf8');
  assert.ok(/href="https:\/\/github\.com\/Gatunox\/ddl-parser"/.test(built),
    'a source link is present in the served UI');
  assert.ok(/agpl-3\.0\.html/.test(built), 'and it names the licence it is under');
});

test('links in the settings drawer are styled, not left to the browser', () => {
  // The licence section introduced the drawer's first <a> elements. Unstyled,
  // they came out as the browser default #0000EE — measured 1.84:1 against the
  // panel, which is unreadable, and a blue this app uses nowhere else.
  const rule = html.match(/\.settings-drawer a\s*\{([^}]*)\}/);
  assert.ok(rule, 'the drawer styles its links');
  assert.ok(/color:\s*var\(--accent\)/.test(rule[1]),
    `and uses the palette, so both themes follow: ${rule[1].trim()}`);
  // Colour alone should not be the only affordance.
  assert.ok(/text-decoration:\s*underline/.test(rule[1]), 'and underlines them');
});

test('LICENSE is the verbatim AGPL-3.0, and package.json agrees', () => {
  const lic = fs.readFileSync('./LICENSE', 'utf8');
  assert.ok(/GNU AFFERO GENERAL PUBLIC LICENSE/.test(lic), 'LICENSE is the AGPL');
  assert.ok(/Version 3, 19 November 2007/.test(lic), 'version 3');
  // §13 is the difference between AGPL and GPL — if LICENSE were swapped for
  // the plain GPL, everything above still passes and the network clause is gone.
  assert.ok(/13\. Remote Network Interaction/.test(lic),
    'and it carries the remote-network-interaction clause, which plain GPL does not');
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  eq(pkg.license, 'AGPL-3.0-or-later', 'package.json declares the same licence');
  eq(pkg.author, 'Gatunox', 'and the same holder');
});

// ── APP_VERSION keeps up with the commits ────────────────────────────────────
// Three commits in a row (v1.11.0.0, v1.11.0.1, v1.12.0.0) shipped with
// APP_VERSION still reading 1.10.1.0, so the running app under-reported itself
// and the user could not tell whether their copy had the fix. Nothing in the
// suite noticed, because the version is a string no test read. Now the last
// commit's own subject line is the witness: whatever version it claims, the
// source must carry at least that.
console.log('\nrelease — APP_VERSION matches what the last commit claimed');

test('APP_VERSION is not behind the version in HEAD\'s subject line', () => {
  const src = fs.readFileSync('./source.html', 'utf8');
  const m   = src.match(/const APP_VERSION\s*=\s*'([0-9.]+)'/);
  assert.ok(m, 'APP_VERSION not found in source.html');

  let subject;
  try {
    subject = require('child_process')
      .execSync('git log -1 --format=%s', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return; }                       // no git here — nothing to check against

  const claimed = subject.match(/\(v([0-9]+(?:\.[0-9]+){3})\)/);
  if (!claimed) return;                     // a commit that names no version makes no claim

  const num = v => v.split('.').map(Number);
  const [a, b] = [num(m[1]), num(claimed[1])];
  const cmp = a.reduce((r, n, i) => r !== 0 ? r : n - b[i], 0);
  assert.ok(cmp >= 0,
    `APP_VERSION is ${m[1]} but the last commit shipped as ${claimed[1]} — bump it in source.html and rebuild`);
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  process.exit(1);
}
