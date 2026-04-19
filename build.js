#!/usr/bin/env node
/**
 * build.js — produces dist/index.html with obfuscated JS.
 * Run: npm run build
 */

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ── paths ──────────────────────────────────────────────────────────────────
const SRC    = path.join(__dirname, 'source.html');         // development source — gitignored
const OUT    = path.join(__dirname, 'index.html');           // obfuscated output — committed to repo
const MAP    = path.join(__dirname, 'index.js.map');         // source map — gitignored, never deploy
const CM_SRC = path.join(__dirname, 'codemirror-entry.js');
const CM_OUT = path.join(__dirname, 'codemirror.bundle.js');

// ── global names called from onclick / onchange / etc. ────────────────────
// These are referenced as bare identifiers in HTML attributes and must not
// be renamed by the obfuscator.
const RESERVED = [
  '_eggSetAccent', '_tipHide', '_tipShow', '_vbarClose', '_vbarCopyMsg',
  '_vbarNext', '_vbarPrev', 'adjustFontSize', 'adjustLineWidth', 'clearAll',
  'clearDDLEditor', 'clearHover', 'closeDDLDoc', 'closeExportModal',
  'closeImportModal', 'closeMsgExportModal', 'closeSettings', 'confirmImport',
  'copyDDLDoc', 'copyFieldToClipboard', 'copyMsgToClipboard',
  'createMissingRefStub', 'ddlSearchClear', 'ddlSearchNext', 'ddlSearchPrev',
  'ddlSearchUpdate', 'doExport', 'doMsgExport', 'doParseMessages',
  'expRowChange', 'expToggleAll', 'exportPickAll', 'filterDDLDoc',
  'filterDDLTree', 'filterExpTable', 'filterParsePanel', 'flash', 'hoverField',
  'jumpTo', 'loadStagedDef', 'lwCancel', 'lwCommit', 'lwStartEdit', 'lwStep',
  'nextMsg', 'onColPickerChange', 'onFmtForceChange', 'onMsgChange',
  'openFeedbackMail', 'openMsgExportModal', 'openSettings', 'prevMsg',
  'resetLayout', 'saveDDL', 'selectDDLMM', 'selectField', 'selectScope',
  'setPanelDefaultToggle', 'setRawHexTruncate', 'setTheme', 'showDDLDoc',
  'toggleHelpSub', 'toggleHideRedefines', 'togglePanel',
  'toggleSettingsSection', 'toggleTokenArea', 'toggleTrack', 'toggleTrackMode',
  'toggleTreeExp', 'updateDDLEditorState', 'updateDDLHighlight',
  'updateDDLValidationBar',
];

// ── bundle CodeMirror ──────────────────────────────────────────────────────
console.log('Bundling CodeMirror 6…');
execSync(
  `npx esbuild ${CM_SRC} --bundle --format=iife --outfile=${CM_OUT} --minify`,
  { stdio: 'inherit' }
);
const cmBundle = fs.readFileSync(CM_OUT, 'utf8');

// ── read source ────────────────────────────────────────────────────────────
let html = fs.readFileSync(SRC, 'utf8');

// Inline the CM bundle: replace the <script src="codemirror.bundle.js"> tag
html = html.replace(
  /<script src="codemirror\.bundle\.js"><\/script>/,
  `<script>\n${cmBundle}\n</script>`
);

// Extract the app <script id="app"> block for obfuscation
const scriptRE = /(<script id="app">)([\s\S]*?)(<\/script>)/;
const match = html.match(scriptRE);
if (!match) { console.error('ERROR: <script> block not found'); process.exit(1); }

const [fullMatch, openTag, jsSource, closeTag] = match;

// ── obfuscate ──────────────────────────────────────────────────────────────
console.log('Obfuscating JS…');
const result = JavaScriptObfuscator.obfuscate(jsSource, {
  // Strength: medium — good balance between protection and file size
  compact:                          true,
  controlFlowFlattening:            false,  // set true for stronger (2–3× slower)
  deadCodeInjection:                false,
  debugProtection:                  false,
  disableConsoleOutput:             false,
  identifierNamesGenerator:         'hexadecimal',
  renameGlobals:                    false,  // keeps top-level names safe
  reservedNames:                    RESERVED,
  rotateStringArray:                true,
  selfDefending:                    false,
  shuffleStringArray:               true,
  simplify:                         true,
  splitStrings:                     false,
  stringArray:                      true,
  stringArrayCallsTransform:        true,
  stringArrayEncoding:              ['base64'],
  stringArrayIndexShift:            true,
  stringArrayWrappersCount:         2,
  stringArrayWrappersType:          'function',
  stringArrayThreshold:             0.75,
  transformObjectKeys:              false,
  unicodeEscapeSequence:            false,
  // Source map — kept private, strip the reference comment from the output
  sourceMap:                        true,
  sourceMapMode:                    'separate',
  sourceMapFileName:                'index.js.map',
});

const obfuscatedCode = result.getObfuscatedCode()
  // Strip the sourceMappingURL comment so the browser can't find the map
  .replace(/\n?\/\/# sourceMappingURL=.*$/m, '');

const sourceMap = result.getSourceMap();

// ── write output ───────────────────────────────────────────────────────────
// Use a function replacement to prevent $ signs in obfuscated code being
// interpreted as special replacement patterns (e.g. $& would re-insert the
// original match, which contains </script>, breaking the HTML structure).
const outHtml = html.replace(fullMatch, () => `<script>\n${obfuscatedCode}\n</script>`);
fs.writeFileSync(OUT,  outHtml,   'utf8');
fs.writeFileSync(MAP,  sourceMap, 'utf8');

const srcKB  = Math.round(fs.statSync(SRC).size / 1024);
const outKB  = Math.round(fs.statSync(OUT).size / 1024);
const mapKB  = Math.round(fs.statSync(MAP).size / 1024);

console.log(`\nDone!`);
console.log(`  Source : source.html    ${srcKB} KB  (gitignored)`);
console.log(`  Output : index.html     ${outKB} KB  (commit this)`);
console.log(`  Map    : index.js.map   ${mapKB} KB  (gitignored — keep private)`);
