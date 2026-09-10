// The one place a component reads the router. It used to wrap FlowRouter's reactive
// `getParam`; now it is React Router's `useParams`, and the ten call sites that read
// `_id` did not have to change.
import { matchPath, useLocation, useParams } from 'react-router';
import { ROUTE_PATTERNS } from './routes.ts';
import type { RouteName } from './routes.ts';

export function useRouteParam(name: string): string | undefined {
  return useParams()[name];
}

// Same deal for the name of the matched route: the chat panel shows a different button on
// the board than it does anywhere else.
export function useRouteName(): RouteName | undefined {
  const { pathname } = useLocation();
  return (Object.keys(ROUTE_PATTERNS) as RouteName[]).find(
    (name) => matchPath(ROUTE_PATTERNS[name], pathname) !== null
  );
}
