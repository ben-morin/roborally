// The router for component tests. Every component reads its game id from the route and
// navigates through React Router, so a test mounts it under a memory router set to the
// page it is testing. `setRoute` picks the URL, `renderAt` renders under it, and
// `navigations_` lists the paths the component navigated to since the last reset — the
// shape the old FlowRouter stub had, so the tests read the same way.
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { ROUTE_PATTERNS } from '../../client/views/routes.ts';

let route = '/';
let navigations: string[] = [];
// A path the test itself just set, which the spy below must not record as the component's.
let requested: string | null = null;

export function setRoute(path: string) {
  route = path;
}

export function resetRouter() {
  route = '/';
  navigations = [];
  requested = null;
}

/** Paths the component navigated to since the last reset, oldest first. */
export function navigations_() {
  return [...navigations];
}

// A `setRoute` after mount — a test re-pointing a rendered component at another game —
// moves the mounted router there, replacing the entry, on the next render.
function RouteSync() {
  const navigate = useNavigate();
  const synced = useRef(route);
  useEffect(() => {
    if (synced.current === route) return;
    synced.current = route;
    requested = route;
    navigate(route, { replace: true });
  });
  return null;
}

function Spy() {
  const location = useLocation();
  const initial = useRef(true);
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (requested === location.pathname) {
      requested = null;
      return;
    }
    navigations.push(location.pathname);
  }, [location]);
  return null;
}

// Every pattern renders the same children, so a component that navigates re-renders under
// the new URL rather than falling off the router.
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={[route]}>
      <RouteSync />
      <Spy />
      <Routes>
        {Object.values(ROUTE_PATTERNS).map((pattern) => (
          <Route key={pattern} path={pattern} element={children} />
        ))}
        <Route path="*" element={children} />
      </Routes>
    </MemoryRouter>
  );
}

export function renderAt(ui: ReactElement) {
  return render(ui, { wrapper: Wrapper });
}
