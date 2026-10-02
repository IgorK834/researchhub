import { workspaceCapabilities, workspaceRoleLabel } from './workspaceCapabilities';

it.each([
  ['OWNER', true, true, true],
  ['EDITOR', true, true, false],
  ['VIEWER', true, false, false],
  ['REVIEWER', true, false, false],
  ['owner', true, false, false],
  ['', false, false, false],
  [undefined, false, false, false],
] as const)(
  'maps %s to UI affordances, keeping archived workspaces read-only',
  (role, canRead, canEditContent, canManage) => {
    expect(workspaceCapabilities(role, false)).toEqual({
      canRead,
      canEditContent,
      canManage,
    });
    expect(workspaceCapabilities(role, true)).toEqual({
      canRead,
      canEditContent: false,
      canManage: false,
    });
  },
);

it.each([
  ['OWNER', 'Owner'],
  ['EDITOR', 'Editor'],
  ['VIEWER', 'Viewer'],
  ['REVIEWER', 'REVIEWER'],
  ['constructor', 'constructor'],
  ['', 'Unknown role'],
  [' ', 'Unknown role'],
])('labels %s without assuming all server roles are known', (role, label) => {
  expect(workspaceRoleLabel(role)).toBe(label);
});
