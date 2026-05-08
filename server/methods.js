Meteor.methods({

  createGame: async function(postAttributes) {
    var user = await Meteor.userAsync();

    // ensure the user is logged in
    if (!user)
      throw new Meteor.Error(401, "You need to login to create a game");
    if (!postAttributes.name || postAttributes.name === '') {
      throw new Meteor.Error(303, 'Name cannot be empty.');
    }
    var author = getUsername(user);

    var game = {
      name: postAttributes.name,
      userId: user._id,
      author: author,
      submitted: new Date().getTime(),
      started: false,
      gamePhase: GameState.PHASE.IDLE,
      playPhase: GameState.PLAY_PHASE.IDLE,
      respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION,
      playPhaseCount: 0,
      boardId: 0,
      waitingForRespawn: [],
      announce: false,
      cardsToPlay: []
    };
    var board_id = BoardBox.getBoardId(game.name);
    if (board_id >= 0)
      game.boardId = board_id;

    game.min_player = BoardBox.getBoard(board_id).min_player;
    game.max_player = BoardBox.getBoard(board_id).max_player;
    var gameId = await Games.insertAsync(game);

    await Chat.insertAsync({
      gameId: gameId,
      message: 'Game created',
      submitted: new Date().getTime()
    });
    await Meteor.callAsync('joinGame', gameId);

    return gameId;
  },
  
  joinGame: async function(gameId) {
    var user = await Meteor.userAsync();

    if (!user)
      throw new Meteor.Error(401, "You need to login to join a game");
    var game = await Games.findOneAsync(gameId);
    if (!game)
      throw new Meteor.Error(401, "Game id not found!");

    var author = getUsername(user);
    var playerId;
    if (!await Players.findOneAsync({gameId: gameId, userId: user._id})) {
      playerId = await Players.insertAsync({
        gameId: gameId,
        userId: user._id,
        name: author,
        lives: 3,
        damage: 0,
        visited_checkpoints: 0,
        needsRespawn: false,
        powerState: GameLogic.ON,
        optionalInstantPowerDown: false,
        position: {x: -1, y: -1},
        chosenCardsCnt: 0,
        optionCards: {},
        cards: Array.apply(null, new Array(GameLogic.CARD_SLOTS)).map(function (x, i) { return CardLogic.EMPTY; })
      });
      await Cards.insertAsync({
        gameId: gameId,
        playerId: playerId,
        userId: user._id,
        chosenCards: Array.apply(null, new Array(GameLogic.CARD_SLOTS)).map(function (x, i) { return CardLogic.EMPTY; }),
        handCards: []
      });
    }
    await game.chatAsync(author + ' joined the game', gameId);
    return true;
  },

  leaveGame: async function(gameId) {
    var user = await Meteor.userAsync();
    if (!user)
      throw new Meteor.Error(401, "You need to login to leave a game");
    var game = await Games.findOneAsync(gameId);
    if (!game)
      throw new Meteor.Error(401, "Game id not found!");

    if (game.started && game.gamePhase !== GameState.PHASE.ENDED && game.gamePhase !== GameState.PHASE.PROGRAM) {
      var stillPlaying = await Players.findOneAsync({gameId: game._id, userId: user._id});
      if (stillPlaying) {
        throw new Meteor.Error(403, "You can only leave during the program phase");
      }
    }

    var author = getUsername(user);
    console.log('User ' + author + ' leaving game ' + gameId);

    // Return any held cards to the deck before removing
    if (game.started) {
      var playerCards = await Cards.findOneAsync({gameId: game._id, userId: user._id});
      if (playerCards) {
        var deck = await Deck.findOneAsync({gameId: game._id});
        if (deck) {
          for (var c of playerCards.handCards) {
            if (c >= 0) deck.cards.push(c);
          }
          for (var c of playerCards.chosenCards) {
            if (c >= 0) deck.cards.push(c);
          }
          await Deck.updateAsync(deck._id, deck);
        }
      }
    }
    await Cards.removeAsync({gameId: game._id, userId: user._id});
    await Players.removeAsync({gameId: game._id, userId: user._id});
    if (game.started) {
      var players = await Players.find({gameId: game._id}).fetchAsync();
      if (players.length === 1) {
        await Games.updateAsync(game._id, {$set: {gamePhase: GameState.PHASE.ENDED, winner: players[0].name, stopped: new Date().getTime()}});
        await buildHighscores();
      } else if (players.length === 0) {
        console.log("Nobody left in the game.");
        await Games.updateAsync(game._id, {$set: {gamePhase: GameState.PHASE.ENDED, winner: "Nobody", stopped: new Date().getTime()}});
      }
    }
    await game.chatAsync(author + ' left the game');
  },

  selectBoard: async function(boardName, gameId) {
    var user = await Meteor.userAsync();
    var game = await Games.findOneAsync(gameId);
    if (!game)
      throw new Meteor.Error(401, "Game id not found!");

    var board_id = BoardBox.getBoardId(boardName);
    if (board_id < 0)
      throw new Meteor.Error(401, "Board " + boardName + " not found!");

    var min = BoardBox.getBoard(board_id).min_player;
    var max = BoardBox.getBoard(board_id).max_player;
    await Games.updateAsync(game._id, {$set: {boardId: board_id, min_player: min, max_player: max}});

    var author = getUsername(user);
    await game.chatAsync(author + ' selected board ' + boardName, 'for game' + gameId);
  },

  startGame: async function(gameId) {
    var players = await Players.find({gameId: gameId}).fetchAsync();
    var game = await Games.findOneAsync(gameId);
    if (players.length > game.max_player) {
      throw new Meteor.Error(401, "Too many players.");
    }

    for (var i in players) {
      var start = game.board().startpoints[i];
      var player = players[i];
      player.position.x = start.x;
      player.position.y = start.y;
      player.direction = start.direction;
      player.robotId = i;
      player.start = start;
      await Players.updateAsync(player._id, player);
    }
    await game.chatAsync('Game started');
    await GameState.nextGamePhaseAsync(gameId);
  },

  playCards: async function(gameId) {
    var player = await Players.findOneAsync({gameId: gameId, userId: Meteor.userId()});
    if (!player)
      throw new Meteor.Error(401, 'Game/Player not found! ' + gameId);

    if (!player.submitted) {
      await player.chatAsync('submitted cards');
      await CardLogic.submitCardsAsync(player);
    } else {
      console.warn("Player already submitted his cards.");
    }
  },

  selectRespawnPosition: async function(gameId, x, y) {
    var game = await Games.findOneAsync(gameId);
    var player = await Players.findOneAsync({gameId: gameId, userId: Meteor.userId()});
    await GameLogic.respawnPlayerAtPosAsync(player, Number(x), Number(y));
    await player.chatAsync('chose position', '(' + x + ',' + y + ')');
    await game.nextRespawnPhaseAsync(GameState.RESPAWN_PHASE.CHOOSE_DIRECTION);
  },
  
  selectRespawnDirection: async function(gameId, direction) {
    var game = await Games.findOneAsync(gameId);
    var player = await Players.findOneAsync({gameId: gameId, userId: Meteor.userId()});
    await GameLogic.respawnPlayerWithDirAsync(player, Number(direction));
    await player.chatAsync('reentered the race', direction);
    await GameState.nextGamePhaseAsync(game._id);
  },
  
  togglePowerDown: async function(gameId) {
    var player = await Players.findOneAsync({gameId: gameId, userId: Meteor.userId()});
    return await player.togglePowerDownAsync();
  },
  
  addMessage: async function(postAttributes) {
    var user = await Meteor.userAsync();

    // ensure the user is logged in
    if (!user)
      throw new Meteor.Error(401, "You need to login to post messages");

    var author = getUsername(user);
    var message = {
      message: postAttributes.message,
      gameId: postAttributes.gameId,
      userId: user._id,
      author: author,
      submitted: new Date().getTime()
    };
    await Chat.insertAsync(message);
  },
  
  isEmailAvailable: function() {
    return !!process.env.EMAIL_URL || Meteor.isDevelopment;
  },

  resendVerificationEmail: async function(email) {
    const user = await Meteor.users.findOneAsync({ 'emails.address': email });
    if (!user) {
      throw new Meteor.Error('user-not-found', 'No account found with that email address.');
    }
    if (user.emails.some(e => e.verified)) {
      throw new Meteor.Error('already-verified', 'Email is already verified.');
    }
    Accounts.sendVerificationEmail(user._id);
  },
});
