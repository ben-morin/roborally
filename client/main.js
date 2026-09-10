// This file is the client entry point (`meteor.mainModule`): the side-effect imports that
// have to run first, the stylesheets in cascade order, and the one React root.

// First, so the production `console.log` no-op is installed before anything else runs.
import '../both/logging.ts';

// Before anything that reaches a collection: a schema is attached in the collection's
// module body, and it reads this configuration as it goes. See both/easySchemaConfig.ts.
import '../both/easySchemaConfig.ts';

// Same rule, for the same reason: jam:method reads this configuration when a method module
// runs `createMethod`. See both/methods/config.ts.
import '../both/methods/config.ts';

// Stylesheets. tailwind.css goes first, and the order is load-bearing: a cascade layer is
// placed the first time any stylesheet names it, and the two game stylesheets open with
// `@layer components`. Met before Tailwind's own `@layer theme, base, components,
// utilities;` they would put `components` ahead of `base`, and Preflight's element resets
// would beat the board and the cards.
import './stylesheets/tailwind.css';
import './stylesheets/gamecard.css';
import './stylesheets/game.css';

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { createAppRouter } from './views/router.tsx';

// The one file nothing else imports: `collections/users.ts` exists only for its
// load-time observe.
import '../collections/users.ts';

Meteor.subscribe('onlineUsers');

// React owns the page from here: the router renders the layout, the layout renders the
// routed page. `#react-root` is the one element client/main.html puts in the body.
Meteor.startup(() => {
  document.title = 'RoboRally online!';
  createRoot(document.getElementById('react-root')).render(
    createElement(RouterProvider, { router: createAppRouter() })
  );
});
