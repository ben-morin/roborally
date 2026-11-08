// The route table: one layout, five game pages and the admin screens. Replaces the
// FlowRouter table that was client/main.js. `routes` is exported on its own so a test can
// mount it in a memory router; the browser router is built once, for the entry point.
import { createBrowserRouter, Navigate } from 'react-router';
import type { RouteObject } from 'react-router';
import { AppLayout } from './layout/AppLayout.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { AdminUsersPage } from './pages/AdminUsersPage.tsx';
import { BoardPage } from './pages/BoardPage.tsx';
import { BoardSelectPage } from './pages/BoardSelectPage.tsx';
import { GameListPage } from './pages/GameListPage.tsx';
import { LobbyPage } from './pages/LobbyPage.tsx';
import { RankingPage } from './pages/RankingPage.tsx';
import { paths, ROUTE_PATTERNS } from './routes.ts';

export const routes: RouteObject[] = [
  {
    path: ROUTE_PATTERNS['gamelist.page'],
    Component: AppLayout,
    children: [
      { index: true, Component: GameListPage },
      { path: ROUTE_PATTERNS['ranking.page'], Component: RankingPage },
      { path: ROUTE_PATTERNS['game.page'], Component: LobbyPage },
      { path: ROUTE_PATTERNS['boardselect.page'], Component: BoardSelectPage },
      { path: ROUTE_PATTERNS['board.page'], Component: BoardPage },
      {
        path: ROUTE_PATTERNS['admin.page'],
        Component: AdminPage,
        children: [
          // Users is the only screen so far, so it is where `/admin` lands.
          { index: true, element: <Navigate to={paths.adminUsers()} replace /> },
          { path: ROUTE_PATTERNS['adminusers.page'], Component: AdminUsersPage },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
