// CodeMirror 6 bundle entry — exports minimal API to window.CM
import { EditorView, keymap, placeholder, ViewPlugin, Decoration, lineNumbers } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { EditorState, Compartment } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';

window.CM = {
  EditorView,
  EditorState,
  Compartment,
  keymap,
  placeholder,
  ViewPlugin,
  Decoration,
  RangeSetBuilder,
  lineNumbers,
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
};
