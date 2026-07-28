import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { Games } from '../../../collections/games.js';
import { Players } from '../../../collections/players.js';
import { modalAlert, modalConfirm } from '../../helper/modalDialogs.js';
// game_page.html includes {{> thumbnail}}.
import '../board/thumbnail.js';
import './game_page.html';

function getGame() {
  const id = FlowRouter.getParam('_id');
  if (id) {
    return Games.findOne(id);
  }
}

Template.gamePageActions.onCreated(function () {
  let gameLoaded = false;
  this.autorun((computation) => {
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
  game() {
    return getGame();
  },
  ownGame() {
    return this.userId === Meteor.userId();
  },
  inGame() {
    return Players.findOne({ gameId: this._id, userId: Meteor.userId() });
  },
  gameReady() {
    return Players.find().fetch().length >= 1;
  },
  gameFull() {
    return Players.find().fetch().length >= 8;
  },
});

Template.gamePageActions.events({
  async 'click .delete'(e) {
    e.preventDefault();
    if (await modalConfirm('Remove this game?')) {
      Games.remove(this._id);
      FlowRouter.go(FlowRouter.path('gamelist.page'));
    }
  },
  'click .join'(e) {
    e.preventDefault();

    Meteor.callAsync('joinGame', this._id).catch((error) => modalAlert(error.reason));
  },
  'click .leave'(e) {
    e.preventDefault();

    Meteor.callAsync('leaveGame', this._id).catch((error) => modalAlert(error.reason));
  },

  'click .start'(e) {
    e.preventDefault();
    const gameId = this._id;

    Meteor.callAsync('startGame', gameId).catch((error) => modalAlert(error.reason));
  },
});

Template.players.helpers({
  players() {
    return Players.find();
  },
  minPlayer() {
    const game = getGame();
    if (game && game.min_player > 1) {
      return `${game.min_player} players`;
    } else {
      return 'One player';
    }
  },
});

Template.selectedBoard.helpers({
  boardData() {
    const game = getGame();
    if (!game) return {};
    const board = game.board();
    return {
      width: board.width * 24,
      height: board.height * 24,
      extra_class: '',
      game,
      board,
    };
  },
  ownGame() {
    const game = getGame();
    return game && game.userId === Meteor.userId();
  },
});

Template.selectedBoard.events({
  'click .select'(e) {
    e.preventDefault();
    const game = getGame();
    if (game) {
      FlowRouter.go(FlowRouter.path('boardselect.page', { _id: game._id }));
    }
  },
});
