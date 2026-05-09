Template.chat.helpers({
  messages: function () {
    return Chat.find();
  },
  gameId: function () {
    return FlowRouter.getParam('_id') || 'global';
  },
  inGame: function () {
    var gameId = FlowRouter.getParam('_id') || 'global';
    return Players.findOne({ gameId: gameId, userId: Meteor.userId(), robotId: { $ne: null } });
  },
  viewingGame: function () {
    return FlowRouter.getRouteName() === 'board.page';
  },
  gameEnded: function () {
    var gameId = FlowRouter.getParam('_id');
    if (!gameId) return false;
    var game = Games.findOne(gameId);
    return game && game.gamePhase === GameState.PHASE.ENDED;
  },
  leaveDisabledClass: function () {
    return canLeaveActiveGame() ? '' : 'disabled';
  },
  leaveDisabledTitle: function () {
    return canLeaveActiveGame() ? '' : 'You can only leave during the program phase';
  },

  timeToStr: function (time) {
    return moment(new Date(time)).format('L LT');
  },
});

function canLeaveActiveGame() {
  var gameId = FlowRouter.getParam('_id');
  if (!gameId) return true;
  var game = Games.findOne(gameId);
  if (!game) return true;
  if (!game.started) return true;
  if (game.gamePhase === GameState.PHASE.ENDED) return true;
  return game.gamePhase === GameState.PHASE.PROGRAM;
}

Template.chat.events({
  'submit form': function (event) {
    event.preventDefault();
    var message = {
      gameId: $(event.target).find('[name=gameId]').val(),
      message: $(event.target).find('[name=message]').val(),
    };

    if (message.message.length > 0) {
      Meteor.callAsync('addMessage', message).then(
        function () {
          $(event.target).find('[name=message]').val('');
        },
        function (error) {
          modalAlert(error.reason);
        }
      );
    }
  },
  'click .cancel': async function (e) {
    if ($(e.currentTarget).hasClass('disabled')) return;
    var gameId = FlowRouter.getParam('_id') || 'global';
    var game = Games.findOne(gameId);
    var inGame = Players.findOne({
      gameId: gameId,
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
          function () {
            FlowRouter.go(FlowRouter.path('gamelist.page'));
          },
          function (error) {
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
    added: function () {
      var $chat = $('.chat'),
        $printer = $('.messages', $chat),
        printerH = $printer.innerHeight();
      if ($printer && $printer[0]) {
        $printer.stop().animate({ scrollTop: $printer[0].scrollHeight - printerH }, 100);
      }
    },
  });
});
