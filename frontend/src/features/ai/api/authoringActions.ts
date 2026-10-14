import { t as uiText, type MessageKey } from '../../../shared/i18n';
import type { AuthoringSelection } from '../../documents/components/DocumentBodyEditor';
import type { AuthoringCommand, AuthoringKind, RewriteAction } from './authoringApi';

export type SelectionAction = RewriteAction | 'FIND_EVIDENCE';
export interface SelectionAuthoringRequest {
  readonly id: number;
  readonly action: SelectionAction;
  readonly selection: AuthoringSelection;
  readonly revision: number;
}

function actionLabel<K extends SelectionAction>(
  action: K,
  key: MessageKey,
): readonly [K, string] {
  const entry: [K, string] = [action, ''];
  Object.defineProperty(entry, '1', { get: () => uiText(key) });
  return Object.freeze(entry);
}
export const REWRITE_ACTIONS: readonly (readonly [RewriteAction, string])[] = [
  actionLabel('IMPROVE_ACADEMIC_STYLE', 'editor.improve'),
  actionLabel('SHORTEN', 'editor.shorten'),
  actionLabel('EXPAND', 'editor.expand'),
  actionLabel('CLARIFY', 'editor.clarify'),
  actionLabel('FIX_GRAMMAR', 'editor.grammar'),
  actionLabel('EXPLAIN', 'editor.explain'),
];
export const SELECTION_ACTIONS: readonly (readonly [SelectionAction, string])[] = [
  ...REWRITE_ACTIONS.filter(
    ([action]) => action !== 'CLARIFY' && action !== 'FIX_GRAMMAR',
  ),
  actionLabel('FIND_EVIDENCE', 'ui.AuthoringPanel.message029'),
];

/** One public command builder for the panel and selection toolbar. */
export function authoringCommand(input: {
  readonly kind: AuthoringKind;
  readonly action: RewriteAction;
  readonly revision: number;
  readonly selection: AuthoringSelection;
  readonly placement: string;
  readonly instruction: string;
  readonly selected: readonly string[];
  readonly all: boolean;
  readonly length: number;
  readonly style: string;
  readonly required: boolean;
}): AuthoringCommand {
  const {
    kind,
    action,
    revision,
    selection,
    placement,
    instruction,
    selected,
    all,
    length,
    style,
    required,
  } = input;
  return {
    kind,
    expectedRevision: revision,
    placementBlock:
      kind === 'DRAFT'
        ? placement === 'selection'
          ? selection.placementBlock
          : Number(placement)
        : null,
    from: kind === 'DRAFT' ? null : selection.from,
    to: kind === 'DRAFT' ? null : selection.to,
    action: kind === 'REWRITE' ? action : null,
    instruction:
      instruction.trim() ||
      (kind === 'EVIDENCE'
        ? 'Find evidence for this claim.'
        : 'Rewrite the selected fragment.'),
    selectedSourceIds:
      kind === 'EVIDENCE' && all
        ? null
        : kind === 'REWRITE' && action !== 'EXPAND'
          ? []
          : selected,
    lengthTarget: length,
    stylePreset: style,
    citationRequired:
      kind === 'DRAFT' ||
      (kind === 'REWRITE' && action === 'EXPAND' && selected.length > 0 && required),
  };
}
