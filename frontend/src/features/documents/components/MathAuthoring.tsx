import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import { useState, type ReactElement } from 'react';
import type { Editor } from '@tiptap/core';
import { mathValue, parseMath } from '../api/mathAst';
export function MathAuthoring({ editor }: { readonly editor: Editor }): ReactElement {
  useUiLocale();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [block, setBlock] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={uiText('ui.MathAuthoring.message001')}
        onClick={() => setOpen(!open)}
      >
        ∑
      </button>
      {open && (
        <div role="group" aria-label={uiText('ui.MathAuthoring.message002')}>
          <label>
            {uiText('ui.ProblemForm.message009')}
            <input
              aria-label={uiText('ui.ProblemForm.message009')}
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
            {uiText('ui.MathAuthoring.message003')}
          </label>
          <span>{uiText('ui.MathAuthoring.message004')}</span>
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
                setError(false);
              } catch (e) {
                setError(true);
              }
            }}
          >
            {uiText('ui.InsertAnalysisResult.message020')}
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            {uiText('ui.InsertAnalysisResult.message019')}
          </button>
          {error && <span role="alert">{uiText('editor.mathError')}</span>}
        </div>
      )}
    </>
  );
}
