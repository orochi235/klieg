import { javascript } from '@codemirror/lang-javascript';
import { type Diagnostic, lintGutter, setDiagnostics } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef, useState } from 'react';
import type { EffectLayer } from './composition.js';
import { type DraftFaults, draftErrorLine, loadDraft } from './draft.js';

export interface DraftPaneProps {
  layer: EffectLayer;
  /** Called once the source has compiled, so a layer never holds source the cache has not seen. */
  onSource: (source: string) => void;
  faults: DraftFaults;
}

/** Dark enough for the rest of the lab, and nothing more — a theme package for one pane is a lot. */
const THEME = EditorView.theme(
  {
    '&': { color: '#d7dce4', backgroundColor: '#11141a', fontSize: '12px' },
    '.cm-content': { fontFamily: 'ui-monospace, Menlo, monospace', caretColor: '#ffb347' },
    '.cm-gutters': { backgroundColor: '#171a1f', color: '#7e8896', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(90,169,230,0.06)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#ffb347' },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: true },
);

/** The line a compile error sits on, as CodeMirror's character offsets. */
function diagnosticsFor(state: EditorState, message: string, line: number | null): Diagnostic[] {
  const at = state.doc.line(Math.min(Math.max(1, line ?? 1), state.doc.lines));
  return [{ from: at.from, to: at.to, severity: 'error', message }];
}

/**
 * The body of a factory returning `{ duration, at }`. Compiling is a module — every compile makes
 * and imports a blob URL — so it happens on the keystroke and the blur, never per character.
 */
export function DraftPane({ layer, onSource, faults }: DraftPaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compiled, setCompiled] = useState(false);

  // `onSource` is a fresh closure every render and the editor is built once, so the keymap reads
  // the latest one through a ref rather than rebuilding the editor to capture it.
  const commit = useRef<() => void>(() => {});
  commit.current = () => {
    const editor = view.current;
    if (!editor) return;
    const source = editor.state.doc.toString();
    void loadDraft(source).then((result) => {
      setError(result.error);
      setCompiled(result.error === null);
      editor.dispatch(
        setDiagnostics(
          editor.state,
          result.error === null
            ? []
            : diagnosticsFor(editor.state, result.error, draftErrorLine(source)),
        ),
      );
      onSource(source);
    });
  };

  // The editor owns the document once it exists, so this depends on the layer's identity and
  // deliberately not on its source: rebuilding whenever a commit writes the source back would take
  // the cursor with it on every compile.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the editor owns the document
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: layer.source ?? '',
        extensions: [
          basicSetup,
          javascript(),
          lintGutter(),
          THEME,
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                commit.current();
                return true;
              },
            },
          ]),
          EditorView.domEventHandlers({
            blur: () => {
              commit.current();
              return false;
            },
          }),
        ],
      }),
    });
    view.current = editor;
    // Source restored from a previous session is in the layer but not in the compile cache.
    commit.current();
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [layer.id]);

  return (
    <div className="cl-panel cl-draft">
      <h2>
        draft · {layer.id}
        {compiled && !error ? <span className="cl-ok"> compiled</span> : null}
      </h2>
      <div ref={host} className="cl-editor" />
      <div className="cl-row">
        <button type="button" onClick={() => commit.current()}>
          compile ⌘↵
        </button>
        {error ? <span className="cl-warn">{error}</span> : null}
      </div>
      {faults.throws > 0 ? (
        <p className="cl-warn">
          {faults.throws} throws in the sampled pass — first: {faults.message}
        </p>
      ) : null}
      <p className="cl-note">
        Return <code>{'{ duration, at }'}</code>. A throw inside <code>at</code> rests that call and
        is counted here rather than killing the frame.
      </p>
    </div>
  );
}
