/** Components&states.pdf p.4. Art and actions are supplied by consumers, not fabricated here. */
export const emptyStateCopy = {
  workspaces: {
    context: 'Home · no workspaces',
    title: 'Start your first research workspace.',
    description:
      'A workspace holds your sources, documents and analyses — and the people you work with.',
  },
  documents: {
    context: 'Documents · empty',
    title: 'Nothing written yet',
    description: 'Start a report or notes. Sources you add can be cited as you write.',
  },
  sources: {
    context: 'Sources · empty',
    title: 'Bring in your research material',
    description:
      'PDF, DOCX, XLSX, CSV and TXT. We read them so answers can point back to a page.',
  },
  analyses: {
    context: 'Analyses · empty',
    title: 'No analyses yet',
    description:
      'Open a spreadsheet and describe what to calculate. Code and results stay together.',
  },
  evidence: {
    context: 'AI · no evidence',
    title: 'No evidence found',
    description:
      'None of the selected sources mention this claim. You can keep it as an open question.',
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
    context: 'Search · no results',
    title: `Nothing matches “${query}”`,
    description: `Try fewer words, or limit the search to sources. Searching ${counts.sources} sources, ${counts.documents} documents, ${counts.analyses} analyses.`,
  };
}
