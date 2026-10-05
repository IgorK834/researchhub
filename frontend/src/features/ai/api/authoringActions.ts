import type { AuthoringSelection } from '../../documents/components/DocumentBodyEditor';
import type { AuthoringCommand, AuthoringKind, RewriteAction } from './authoringApi';

export type SelectionAction = RewriteAction | 'FIND_EVIDENCE';
export interface SelectionAuthoringRequest {
  readonly id: number;
  readonly action: SelectionAction;
  readonly selection: AuthoringSelection;
  readonly revision: number;
}

export const REWRITE_ACTIONS: readonly (readonly [RewriteAction, string])[] = [
  ['IMPROVE_ACADEMIC_STYLE', 'Improve writing'],
  ['SHORTEN', 'Shorten'],
  ['EXPAND', 'Expand'],
  ['CLARIFY', 'Clarify'],
  ['FIX_GRAMMAR', 'Fix grammar'],
  ['EXPLAIN', 'Explain'],
];
export const SELECTION_ACTIONS: readonly (readonly [SelectionAction, string])[] = [
  ...REWRITE_ACTIONS.filter(
    ([action]) => action !== 'CLARIFY' && action !== 'FIX_GRAMMAR',
  ),
  ['FIND_EVIDENCE', 'Find evidence'],
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
