import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { GameState } from '../../../both/gamestate.js';
import { Chat } from '../../../collections/chat.js';
import { Games } from '../../../collections/games.js';
import { Players } from '../../../collections/players.js';
import { modalAlert, modalConfirm } from '../../helper/modalDialogs.js';
import './chat.html';

Template.chat.helpers({
  messages() {
    return Chat.find();
  },
  gameId() {
    return FlowRouter.getParam('_id') || 'global';
  },
  inGame() {
    const gameId = FlowRouter.getParam('_id') || 'global';
    return Players.findOne({ gameId, userId: Meteor.userId(), robotId: { $ne: null } });
  },
  viewingGame() {
    return FlowRouter.getRouteName() === 'board.page';
  },
  gameEnded() {
    const gameId = FlowRouter.getParam('_id');
    if (!gameId) return false;
    const game = Games.findOne(gameId);
    return game && game.gamePhase === GameState.PHASE.ENDED;
  },
  leaveDisabledClass() {
    return canLeaveActiveGame() ? '' : 'disabled';
  },
  leaveDisabledTitle() {
    return canLeaveActiveGame() ? '' : 'You can only leave during the program phase';
  },

  timeToStr(time) {
    const d = new Date(time);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  },
});

function canLeaveActiveGame() {
  const gameId = FlowRouter.getParam('_id');
  if (!gameId) return true;
  const game = Games.findOne(gameId);
  if (!game) return true;
  if (!game.started) return true;
  if (game.gamePhase === GameState.PHASE.ENDED) return true;
  return game.gamePhase === GameState.PHASE.PROGRAM;
}

Template.chat.events({
  'submit form'(event) {
    event.preventDefault();
    const message = {
      gameId: event.target.elements.gameId.value,
      message: event.target.elements.message.value,
    };

    if (message.message.length > 0) {
      Meteor.callAsync('addMessage', message).then(
        () => {
          event.target.elements.message.value = '';
        },
        (error) => modalAlert(error.reason)
      );
    }
  },
  async 'click .cancel'(e) {
    if (e.currentTarget.classList.contains('disabled')) return;
    const gameId = FlowRouter.getParam('_id') || 'global';
    const game = Games.findOne(gameId);
    const inGame = Players.findOne({
      gameId,
      userId: Meteor.userId(),
      robotId: { $ne: null },
    });
    if (inGame && game.gamePhase !== GameState.PHASE.ENDED) {
      if (
        await modalConfirm(
          'If you leave, you will forfeit the game, are you sure you want to give up?'
        )
      ) {
        Meteor.callAsync('leaveGame', game._id).then(
          () => FlowRouter.go(FlowRouter.path('gamelist.page')),
          (error) => {
            modalAlert(error.reason);
            FlowRouter.go(FlowRouter.path('gamelist.page'));
          }
        );
      }
    } else {
      FlowRouter.go(FlowRouter.path('gamelist.page'));
    }
  },
});

Template.chat.onRendered(function () {
  Chat.find().observe({
    added() {
      const printer = document.querySelector('.chat .messages');
      if (printer) {
        printer.scrollTo({ top: printer.scrollHeight, behavior: 'smooth' });
      }
    },
  });
});
