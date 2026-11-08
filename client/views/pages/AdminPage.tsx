// `/admin`: the shell every admin screen sits in — a row of links to the screens, then the
// screen. Anybody but an admin is sent to the game list; the server refuses them anyway.
import { Navigate, NavLink, Outlet } from 'react-router';
import { useIsAdmin } from '../admin/useIsAdmin.ts';
import { Loading } from '../layout/Loading.tsx';
import { paths } from '../routes.ts';

// A navy strip, so the header reads like every other surface rather than floating on the
// teal page. The links are the board-select tabs' look, as links: each is a page.
const STRIP =
  'mb-6 flex items-center gap-5 rounded-panel bg-navy px-6 py-3 shadow-panel [&_h2]:text-white';
const TRACK = 'inline-flex gap-1 rounded-full bg-raised p-1';
const LINK =
  'inline-flex h-9 items-center rounded-full px-[18px] text-sm font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const LINK_ACTIVE = `${LINK} bg-teal text-navy hover:text-navy`;
const LINK_IDLE = `${LINK} bg-transparent text-white/70 hover:bg-raised-hover hover:text-white`;

const SCREENS = [{ to: paths.adminUsers(), label: 'Users' }];

export function AdminPage() {
  const admin = useIsAdmin();

  if (admin === undefined) return <Loading />;
  if (!admin) return <Navigate to={paths.gameList()} replace />;

  return (
    <>
      <nav aria-label="Admin screens" className={STRIP}>
        <h2 className="m-0 text-2xl">Admin</h2>
        <div className={TRACK}>
          {SCREENS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => (isActive ? LINK_ACTIVE : LINK_IDLE)}
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Outlet />
    </>
  );
}
