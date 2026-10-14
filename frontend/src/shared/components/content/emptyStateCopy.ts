import { t as uiText } from '../../i18n';
/** Components&states.pdf p.4. Art and actions are supplied by consumers, not fabricated here. */
export const emptyStateCopy = {
  workspaces: {
    get context() {
      return uiText('ui.emptyStateCopy.message001');
    },
    get title() {
      return uiText('ui.Sections.message016');
    },
    get description() {
      return uiText('ui.emptyStateCopy.message002');
    },
  },
  documents: {
    get context() {
      return uiText('ui.emptyStateCopy.message003');
    },
    get title() {
      return uiText('ui.DocumentList.message007');
    },
    get description() {
      return uiText('ui.emptyStateCopy.message004');
    },
  },
  sources: {
    get context() {
      return uiText('ui.SourceList.message007');
    },
    get title() {
      return uiText('ui.SourceList.message009');
    },
    get description() {
      return uiText('ui.emptyStateCopy.message005');
    },
  },
  analyses: {
    get context() {
      return uiText('ui.AnalysisList.message005');
    },
    get title() {
      return uiText('ui.AnalysisList.message006');
    },
    get description() {
      return uiText('ui.emptyStateCopy.message006');
    },
  },
  evidence: {
    get context() {
      return uiText('ui.emptyStateCopy.message007');
    },
    get title() {
      return uiText('ui.emptyStateCopy.message008');
    },
    get description() {
      return uiText('ui.emptyStateCopy.message009');
    },
  },
} as const;

export function searchEmptyStateCopy(
  query: string,
  counts: {
    readonly sources: number;
    readonly documents: number;
    readonly analyses: number;
  },
) {
  return {
    get context() {
      return uiText('ui.SourceSearchDialog.message013');
    },
    title: `Nothing matches “${query}”`,
    description: `Try fewer words, or limit the search to sources. Searching ${counts.sources} sources, ${counts.documents} documents, ${counts.analyses} analyses.`,
  };
}
