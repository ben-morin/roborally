import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { Games } from '../../../collections/games.js';
import { modalAlert } from '../../helper/modalDialogs.js';
import './game_list.html';

Template.gameList.helpers({
  openGames() {
    return Games.find({ winner: null, started: false }, { sort: { submitted: -1 } });
  },
  activeGames() {
    return Games.find({ winner: null, started: true }, { sort: { submitted: -1 } });
  },
  endedGames() {
    return Games.find({ winner: { $exists: true } }, { sort: { stopped: -1 } });
  },
});

Template.gameItemPostForm.helpers({
  gameCreated() {
    return Games.findOne({ userId: Meteor.userId(), winner: null });
  },
});

Template.gameItemPostForm.events({
  'submit form'(event) {
    event.preventDefault();
    const game = {
      name: event.target.elements.name.value,
    };

    Meteor.callAsync('createGame', game).then(
      (id) => FlowRouter.go(FlowRouter.path('game.page', { _id: id })),
      (error) => modalAlert(error.reason)
    );
  },
});
