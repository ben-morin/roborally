Meteor.subscribe('onlineUsers');

Meteor.startup(function () {
  document.title = 'RoboRally online!';
});

FlowRouter.route('/', {
  name: 'gamelist.page',
  subscriptions: function () {
    this.register('games', Meteor.subscribe('games'));
    this.register('chat', Meteor.subscribe('chat', 'global'));
  },
  action: function () {
    this.render('applicationLayout', 'gameList', {
      rightPanel: 'gameItemPostForm',
      rightPanel2: 'chat',
    });
  },
});

FlowRouter.route('/ranking', {
  name: 'ranking.page',
  subscriptions: function () {
    this.register('highscores', Meteor.subscribe('highscores'));
    this.register('chat', Meteor.subscribe('chat', 'global'));
  },
  action: function () {
    this.render('applicationLayout', 'ranking', {
      rightPanel: 'chat',
    });
  },
});

FlowRouter.route('/select/:_id', {
  name: 'boardselect.page',
  waitOn: function (params) {
    return [Meteor.subscribe('games'), Meteor.subscribe('players', params._id)];
  },
  whileWaiting: function () {
    this.render('applicationLayout', 'loading');
  },
  action: function (params) {
    const game = Games.findOne(params._id);
    if (game === undefined) {
      FlowRouter.go('/');
      return;
    }
    if (game.started) {
      FlowRouter.withReplaceState(function () {
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
  waitOn: function (params) {
    return [
      Meteor.subscribe('games'),
      Meteor.subscribe('players', params._id),
      Meteor.subscribe('chat', params._id),
    ];
  },
  whileWaiting: function () {
    this.render('applicationLayout', 'loading');
  },
  action: function (params) {
    const game = Games.findOne(params._id);
    if (game === undefined) {
      FlowRouter.go('/');
      return;
    }
    if (game.started) {
      FlowRouter.withReplaceState(function () {
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
  subscriptions: function (params) {
    this.register('games', Meteor.subscribe('games'));
    this.register('players', Meteor.subscribe('players', params._id));
    this.register('chat', Meteor.subscribe('chat', params._id));
    this.register('cards', Meteor.subscribe('cards', params._id));
  },
  action: function (params) {
    this.render('applicationLayout', 'board', {
      rightPanel: 'cards',
      rightPanel2: 'chat',
    });
  },
});
