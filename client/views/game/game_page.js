function getGame() {
  const id = FlowRouter.getParam('_id');
  if (id) {
    return Games.findOne(id);
  }
}

Template.gamePageActions.onCreated(function () {
  let gameLoaded = false;
  this.autorun(function (computation) {
    const id = FlowRouter.getParam('_id');
    if (id) {
      const game = Games.findOne(id);
      if (game) {
        gameLoaded = true;
      }
      if (!game && gameLoaded) {
        computation.stop();
        FlowRouter.go(FlowRouter.path('gamelist.page'));
        modalAlert('The game was canceled.');
      } else if (game && game.started) {
        computation.stop();
        FlowRouter.go(FlowRouter.path('board.page', { _id: id }));
      }
    }
  });
});

Template.gamePageActions.helpers({
  game: function () {
    return getGame();
  },
  ownGame: function () {
    return this.userId === Meteor.userId();
  },
  inGame: function () {
    return Players.findOne({ gameId: this._id, userId: Meteor.userId() });
  },
  gameReady: function () {
    return Players.find().fetch().length >= 1;
  },
  gameFull: function () {
    return Players.find().fetch().length >= 8;
  },
});

Template.gamePageActions.events({
  'click .delete': async function (e) {
    e.preventDefault();
    if (await modalConfirm('Remove this game?')) {
      Games.remove(this._id);
      FlowRouter.go(FlowRouter.path('gamelist.page'));
    }
  },
  'click .join': function (e) {
    e.preventDefault();

    Meteor.callAsync('joinGame', this._id).catch(function (error) {
      modalAlert(error.reason);
    });
  },
  'click .leave': function (e) {
    e.preventDefault();

    Meteor.callAsync('leaveGame', this._id).catch(function (error) {
      modalAlert(error.reason);
    });
  },

  'click .start': function (e) {
    e.preventDefault();
    const gameId = this._id;

    Meteor.callAsync('startGame', gameId).catch(function (error) {
      modalAlert(error.reason);
    });
  },
});

Template.players.helpers({
  players: function () {
    return Players.find();
  },
  minPlayer: function () {
    const game = getGame();
    if (game && game.min_player > 1) {
      return '' + game.min_player + ' players';
    } else {
      return 'One player';
    }
  },
});

Template.selectedBoard.helpers({
  boardData: function () {
    const game = getGame();
    if (!game) return {};
    const board = game.board();
    return {
      width: board.width * 24,
      height: board.height * 24,
      extra_class: '',
      game: game,
      board: board,
    };
  },
  ownGame: function () {
    const game = getGame();
    return game && game.userId == Meteor.userId();
  },
});

Template.selectedBoard.events({
  'click .select': function (e) {
    e.preventDefault();
    const game = getGame();
    if (game) {
      FlowRouter.go(FlowRouter.path('boardselect.page', { _id: game._id }));
    }
  },
});
