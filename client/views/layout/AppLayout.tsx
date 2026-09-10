// The page: navbar, the routed content (or the landing card for a visitor), the footer and
// the one dialog. Replaces the `applicationLayout` template, and with it the last Blaze
// root: the accounts menu is an ordinary child here, where the layout used to mount it by
// hand into an empty <li>.
import { NavLink, Outlet } from 'react-router';
import { useTracker } from 'meteor/react-meteor-data';
import { AccountsMenu } from '../accounts/AccountsMenu.tsx';
import { paths } from '../routes.ts';
import { Play } from '../icons/Play.tsx';
import { UsersPill } from '../users/UsersPill.tsx';
import { Modal } from './Modal.tsx';

const NAV_LINK =
  'inline-flex h-10 items-center rounded-control px-3 font-display text-sm font-bold tracking-[.08em] uppercase no-underline hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const NAV_IDLE = 'text-white/55';
const NAV_CURRENT = 'text-teal';
const BTN_LG =
  'inline-flex h-12 items-center justify-center rounded-control px-6 text-base font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const PRIMARY = `${BTN_LG} bg-brand text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] hover:text-white`;
const GHOST = `${BTN_LG} border border-white/22 text-white hover:border-white/40 hover:bg-raised`;
const STAR = 'star-well mt-3 mb-7';

function navClass({ isActive }: { isActive: boolean }) {
  return `${NAV_LINK} ${isActive ? NAV_CURRENT : NAV_IDLE}`;
}

function Navbar({ signedIn }: { signedIn: boolean }) {
  return (
    <nav className="absolute top-0 right-0 left-0 z-10 h-16 bg-navy shadow-[0_4px_6px_-1px_rgba(0,0,0,.1)]">
      <div className="mx-auto flex h-full max-w-[1248px] items-center justify-between px-6">
        <NavLink
          to={paths.gameList()}
          className="font-display text-xl font-bold tracking-[.02em] text-white uppercase no-underline hover:text-white"
        >
          RoboRally
        </NavLink>
        <ul className="m-0 flex list-none items-center gap-1 p-0 font-display font-bold tracking-[.08em] uppercase">
          {signedIn && (
            <>
              <li>
                <NavLink to={paths.gameList()} className={navClass} end>
                  Games
                </NavLink>
              </li>
              <li>
                <NavLink to={paths.ranking()} className={navClass}>
                  Ranking
                </NavLink>
              </li>
            </>
          )}
          {/* `login-buttons` is contract: the browser journey keys on it. Relative, so the
              accounts panel hangs off this item's right edge. */}
          <li id="login-buttons" className="relative">
            <AccountsMenu />
          </li>
        </ul>
      </div>
    </nav>
  );
}

/** The visitor's page: what the game is, the running version, and where the code lives. */
function Landing() {
  const version = Meteor.settings.public?.appVersion || 'development';
  // Stamped by the build when it knows the commit; nothing to show otherwise.
  const hash = Meteor.gitCommitHash ?? '';

  return (
    <main className="page">
      <section className="panel text-center">
        {/* An h2 reading "roborally": the browser journey's first assertion. */}
        <h2 className="mt-0 mb-0 text-5xl">roborally</h2>
        <hr className={STAR} />
        <p className="mx-auto mt-0 mb-0 max-w-[640px] text-xl leading-normal">
          A chaotic, competitive board game designed by Richard Garfield where players secretly
          program a sequence of movement cards to race their malfunctioning robots through a
          hazardous, obstacle-filled factory floor.
        </p>
        <h3 className="mt-14 mb-0 text-2xl">Version</h3>
        <hr className={STAR} />
        <p className="mt-0 mb-0 text-base">{version}</p>
        {hash && <p className="mt-1 mb-0 font-mono text-[13px] text-muted">{hash}</p>}
        <h3 className="mt-14 mb-0 text-2xl">Source</h3>
        <hr className={STAR} />
        <p className="mt-0 mb-5 text-base">
          Based on original <a href="https://github.com/marcelpanse/roborally">work</a> by Marcel
          Panse and the <a href="https://github.com/blinkingnoise/roborally">fork</a> by Tom Hlina.
        </p>
        <div className="flex justify-center gap-3">
          <a href="https://github.com/ben-morin/roborally" className={PRIMARY}>
            GitHub
          </a>
          <a
            href="https://github.com/ben-morin/roborally/commits/main"
            target="_blank"
            rel="noreferrer"
            className={GHOST}
          >
            Change log
          </a>
        </div>
      </section>
    </main>
  );
}

function Footer() {
  return (
    <footer className="mt-16 bg-navy-deep px-6 py-5">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <UsersPill />
        </div>
        <span className="tutorial inline-flex items-center gap-2 text-sm font-semibold">
          <Play className="text-teal" />
          <a href="https://youtu.be/0l8Y-L5IZLE" target="_blank" rel="noreferrer">
            tutorial video
          </a>
        </span>
      </div>
    </footer>
  );
}

export function AppLayout() {
  // As the template's `loggingIn` helper had it: the user document, not the id, so a
  // visitor whose document has not arrived yet sees the landing card for that moment.
  const signedIn = useTracker(() => Meteor.user() != null);

  return (
    // The page is laid out for 768px and up, as the viewport meta in client/main.html says.
    <div className="w-full min-w-[768px]">
      <Navbar signedIn={signedIn} />
      {signedIn ? (
        <main className="page">
          <Outlet />
        </main>
      ) : (
        <Landing />
      )}
      <Footer />
      <Modal />
    </div>
  );
}
