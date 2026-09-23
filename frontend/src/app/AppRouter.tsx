import type { ReactElement } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { AppLayoutPage } from '../pages/AppLayoutPage';
import { DocumentDetailPage } from '../pages/DocumentDetailPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { RegisterPage } from '../pages/RegisterPage';
import { WorkspaceDetailPage } from '../pages/WorkspaceDetailPage';
import { WorkspaceListPage } from '../pages/WorkspaceListPage';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    path: '/app',
    element: <AppLayoutPage />,
    children: [
      { index: true, element: <WorkspaceListPage /> },
      { path: 'workspaces', element: <WorkspaceListPage /> },
      { path: 'workspaces/:workspaceId', element: <WorkspaceDetailPage /> },
      {
        path: 'workspaces/:workspaceId/documents/:documentId',
        element: <DocumentDetailPage />,
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

export function AppRouter(): ReactElement {
  return <RouterProvider router={router} />;
}
