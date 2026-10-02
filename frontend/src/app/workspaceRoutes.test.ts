import { legacyWorkspaceSection, workspaceSectionPath } from './workspaceRoutes';

it('encodes ids and keeps the overview at its existing base URL', () => {
  expect(workspaceSectionPath('team / 4', 'overview')).toBe(
    '/app/workspaces/team%20%2F%204',
  );
  expect(workspaceSectionPath('w1', 'documents')).toBe('/app/workspaces/w1/documents');
});
it.each([
  ['', '', 'overview'],
  [
    '?analyzeSource=s1&analyzeVersion=v2&analyzeSheet=Sheet+1',
    '#workspace-sources-heading',
    'ask',
  ],
  ['', '#workspace-documents-heading', 'documents'],
  ['', '#create-document-heading', 'documents'],
  ['', '#upload-source-heading', 'sources'],
  ['', '#workspace-questions-heading', 'ask'],
  ['', '#source-comparison-heading', 'ask'],
  ['', '#comparison-heading', 'ask'],
  ['', '#add-member-heading', 'members'],
  ['', '#edit-workspace-heading', 'settings'],
  ['', '#archive-workspace-heading', 'settings'],
  ['', '#unrecognized', 'overview'],
])('maps legacy search %s and fragment %s to %s', (search, hash, section) => {
  expect(legacyWorkspaceSection(search, hash)).toBe(section);
});
