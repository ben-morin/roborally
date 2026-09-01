// This file is the client entry point (`meteor.mainModule`). The routes below name their
// templates as strings, which Blaze resolves against the global `Template` namespace at
// render time, so every view module has to be imported here for its template to exist.
// Each of those modules imports its own `.html` and its own dependencies.

// First, so the production `console.log` no-op is installed before anything else runs.
import '../both/logging.js';

// Before anything that reaches a collection: a schema is attached in the collection's
// module body, and it reads this configuration as it goes. See both/easySchemaConfig.js.
import '../both/easySchemaConfig.js';

// Bootstrap's JS. Imported for its side effects: each component registers a delegated
// `data-bs-*` handler on `document` at module load, which is what drives the markup-only
// widgets (the navbar `collapse`, the board-select `pill` tabs, `data-bs-dismiss` in the
// modal). Importing the package index rather than individual `bootstrap/js/dist/*`
// modules keeps every component available to future markup; bootstrap declares no
// `sideEffects: false`, so nothing here gets tree-shaken away. Code that needs a
// component's API imports it by name instead — see `helper/modalDialogs.js`.
import 'bootstrap';

// Stylesheets. `fourseven:scss` used to compile these eagerly and Meteor's own
// file-ordering rules decided the cascade; under Rspack they are modules, and
// this import order IS the cascade order. It reproduces what the pre-Rspack
// build emitted, measured from the merged stylesheet rather than assumed:
// lib/ and modules/ (subdirectories) came before the top-level files, which
// came in alphabetical order. Bootstrap therefore stays first so that the app's
// own rules keep winning — notably `base.scss`'s `body{font-size:14px}` and
// `a{text-decoration:none}`, both of which override Bootstrap's `_reboot`.
// `_variables.scss` is a partial imported by the others and is never compiled
// on its own.
import './stylesheets/lib/bootstrap.scss';
import './stylesheets/modules/gamecard.scss';
import './stylesheets/base.scss';
import './stylesheets/components.scss';
import './stylesheets/game.scss';
import './stylesheets/layout.scss';

import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { Games } from '../collections/games.js';

import './helper/datehelper.js';
import './views/board/board.js';
import './views/cards/cards.js';
import './views/chat/chat.js';
import './views/game/board_select.js';
import './views/game/game_list.js';
import './views/game/game_page.js';
import './views/layout/applicationLayout.js';
import './views/ranking/ranking.js';

// Files nothing else imports: `cardMethods.js` registers method stubs for the
// client-side simulation, and `collections/users.js` exists only for its load-time
// observe.
import '../both/cardMethods.js';
import '../collections/users.js';

Meteor.subscribe('onlineUsers');

Meteor.startup(() => {
  document.title = 'RoboRally online!';
});

FlowRouter.route('/', {
  name: 'gamelist.page',
  subscriptions() {
    this.register('games', Meteor.subscribe('games'));
    this.register('chat', Meteor.subscribe('chat', 'global'));
  },
  action() {
    this.render('applicationLayout', 'gameList', {
      rightPanel: 'gameItemPostForm',
      rightPanel2: 'chat',
    });
  },
});

FlowRouter.route('/ranking', {
  name: 'ranking.page',
  subscriptions() {
    this.register('highscores', Meteor.subscribe('highscores'));
    this.register('chat', Meteor.subscribe('chat', 'global'));
  },
  action() {
    this.render('applicationLayout', 'ranking', {
      rightPanel: 'chat',
    });
  },
});

FlowRouter.route('/select/:_id', {
  name: 'boardselect.page',
  waitOn(params) {
    return [Meteor.subscribe('games'), Meteor.subscribe('players', params._id)];
  },
  whileWaiting() {
    this.render('applicationLayout', 'loading');
  },
  action(params) {
    const game = Games.findOne(params._id);
    if (game === undefined) {
      FlowRouter.go('/');
      return;
    }
    if (game.started) {
      FlowRouter.withReplaceState(() => {
        FlowRouter.go(FlowRouter.path('board.page', { _id: params._id }));
      });
      return;
    }
    this.render('applicationLayout', 'boardselect', {
      rightPanel: 'gamePageActions',
      rightPanel2: 'players',
    });
  },
});

FlowRouter.route('/games/:_id', {
  name: 'game.page',
  waitOn(params) {
    return [
      Meteor.subscribe('games'),
      Meteor.subscribe('players', params._id),
      Meteor.subscribe('chat', params._id),
    ];
  },
  whileWaiting() {
    this.render('applicationLayout', 'loading');
  },
  action(params) {
    const game = Games.findOne(params._id);
    if (game === undefined) {
      FlowRouter.go('/');
      return;
    }
    if (game.started) {
      FlowRouter.withReplaceState(() => {
        FlowRouter.go(FlowRouter.path('board.page', { _id: params._id }));
      });
      return;
    }
    this.render('applicationLayout', 'chat', {
      rightPanel: 'gamePageActions',
      rightPanel2: 'players',
      rightPanel3: 'selectedBoard',
    });
  },
});

FlowRouter.route('/board/:_id', {
  name: 'board.page',
  subscriptions(params) {
    this.register('games', Meteor.subscribe('games'));
    this.register('players', Meteor.subscribe('players', params._id));
    this.register('chat', Meteor.subscribe('chat', params._id));
    this.register('cards', Meteor.subscribe('cards', params._id));
  },
  action(_params) {
    this.render('applicationLayout', 'board', {
      rightPanel: 'cards',
      rightPanel2: 'chat',
    });
  },
});
