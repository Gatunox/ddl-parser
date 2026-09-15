// CodeMirror 6 bundle entry — exports minimal API to window.CM
import { EditorView, keymap, placeholder, ViewPlugin, Decoration, lineNumbers, highlightActiveLine, highlightActiveLineGutter, gutterLineClass, GutterMarker } from '@codemirror/view';
import { RangeSetBuilder, RangeSet } from '@codemirror/state';
import { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';

window.CM = {
  EditorView,
  EditorState,
  Compartment,
  StateEffect,
  StateField,
  keymap,
  placeholder,
  ViewPlugin,
  Decoration,
  RangeSetBuilder,
  // The line-number column itself, so a lint mark can be painted IN the gutter
  // rather than only on the line beside it. Added 2026-09-15.
  RangeSet,
  gutterLineClass,
  GutterMarker,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  history,
  defaultKeymap,
  historyKeymap,
  // Exported so a toolbar can drive the same history the keymap does — ⌘Z has
  // always worked in these editors, it simply had nothing on screen saying so.
  undo,
  redo,
  undoDepth,
  redoDepth,
};
