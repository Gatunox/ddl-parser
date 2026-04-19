// CodeMirror 6 bundle entry — exports minimal API to window.CM
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';

window.CM = {
  EditorView,
  EditorState,
  Compartment,
  keymap,
  placeholder,
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
};
