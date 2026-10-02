import type { ReactElement } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';

import { RequireAuthenticatedUser } from '../features/auth/components/RequireAuthenticatedUser';
import { AppLayoutPage } from '../pages/AppLayoutPage';
import { DocumentDetailPage } from '../pages/DocumentDetailPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { RegisterPage } from '../pages/RegisterPage';
import { SourceRoutePage } from '../pages/SourceRoutePage';
import { WorkspaceDetailPage } from '../pages/WorkspaceDetailPage';
import { WorkspaceListPage } from '../pages/WorkspaceListPage';

export const appRoutes: RouteObject[] = [
  // Public: reaching these is how someone becomes authenticated, so they must not be behind the guard.
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    path: '/app',
    // The guard is the outermost element under /app, so every nested route — including a deep workspace
    // or document URL opened directly or refreshed — waits for the session check before anything renders.
    element: <RequireAuthenticatedUser />,
    children: [
      {
        // A pathless layout route: the shell renders inside the guard rather than beside it, so the
        // header and its outlet appear only once a user is known.
        element: <AppLayoutPage />,
        children: [
          { index: true, element: <WorkspaceListPage /> },
          { path: 'workspaces', element: <WorkspaceListPage /> },
          { path: 'workspaces/:workspaceId', element: <WorkspaceDetailPage /> },
          ...(['documents', 'sources', 'ask', 'members', 'settings'] as const).map(
            (section) => ({
              path: `workspaces/:workspaceId/${section}`,
              element: <WorkspaceDetailPage section={section} />,
            }),
          ),
          {
            path: 'workspaces/:workspaceId/sources/:sourceId',
            element: <SourceRoutePage />,
          },
          {
            path: 'workspaces/:workspaceId/documents/:documentId',
            element: <DocumentDetailPage />,
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

// One browser history subscription, including React StrictMode development mounts.
const router = createBrowserRouter(appRoutes);

export function AppRouter(): ReactElement {
  return <RouterProvider router={router} />;
}
