import { useState, type ReactElement } from 'react';
import type { Editor } from '@tiptap/core';
import { mathValue, parseMath } from '../api/mathAst';
export function MathAuthoring({ editor }: { readonly editor: Editor }): ReactElement {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [block, setBlock] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <button type="button" aria-label="Insert formula" onClick={() => setOpen(!open)}>
        ∑
      </button>
      {open && (
        <div role="group" aria-label="Formula editor">
          <label>
            Formula
            <input
              aria-label="Formula"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={block}
              onChange={(e) => setBlock(e.target.checked)}
            />
            Display equation
          </label>
          <span>Use + − * / ^ =, sqrt, sin, cos. Angles use radians.</span>
          <button
            type="button"
            onClick={() => {
              try {
                const math = mathValue(parseMath(text));
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: block ? 'blockMath' : 'inlineMath',
                    attrs: { math, ...(block ? { blockId: crypto.randomUUID() } : {}) },
                  })
                  .run();
                setOpen(false);
                setText('');
                setError('');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Invalid formula');
              }
            }}
          >
            Insert
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          {error && <span role="alert">{error}</span>}
        </div>
      )}
    </>
  );
}
