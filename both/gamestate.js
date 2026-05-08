GameState = {
  PHASE: {
    IDLE: "waiting",
    DEAL: "deal",
    PROGRAM: "program",
    PLAY: "play",
    RESPAWN: "respawn",
    ENDED: "game ended"
  },
  PLAY_PHASE: {
    IDLE: "waiting",
    REVEAL_CARDS: "reveal",
    MOVE_BOTS: "move bots",
    MOVE_BOARD: "move board",
    LASERS: "lasers",
    LASER_OPTIONS: "laser options",
    CHECKPOINTS: "checkpoints",
    REPAIRS: "repairs"
  },
  RESPAWN_PHASE: {
    CHOOSE_POSITION: "choose position",
    CHOOSE_DIRECTION: "choose direction"
  }
};

(function (scope) {
  var _NEXT_PHASE_DELAY = 250;
  var _ANNOUNCE_NEXT_PHASE = 1000;
  var _ANNOUNCE_CARD_TIME = 1750; // match to .fadeInAndOut duration in game.scss
  var _EXECUTE_CARD_TIME = 1000;

  // game phases:

  scope.nextGamePhaseAsync = async function (gameId) {
    var game = await Games.findOneAsync(gameId);
    await new Promise(resolve => Meteor.setTimeout(resolve, _NEXT_PHASE_DELAY));
    switch (game.gamePhase) {
      case GameState.PHASE.IDLE:
        await Games.updateAsync(game._id, {$set: {started: true, gamePhase: GameState.PHASE.DEAL}});
        await playDealPhase(game);
        break;
      case GameState.PHASE.DEAL:
        await game.stopAnnounceAsync();
        await playDealPhase(game);
        break;
      case GameState.PHASE.PROGRAM:
        await game.startAnnounceAsync();
        await playProgramCardsSubmitted(game);
        break;
      case GameState.PHASE.PLAY:
        if (game.waitingForRespawn.length > 0) {
          await Games.updateAsync(game._id, {
            $set: {
              waitingForRespawn: game.waitingForRespawn.reverse(),
              gamePhase: GameState.PHASE.RESPAWN
            }
          });
          await game.nextGamePhaseAsync();
        } else {
          await game.nextGamePhaseAsync(GameState.PHASE.DEAL);
        }
        break;
      case GameState.PHASE.RESPAWN:
        await playNextRespawn(game);
        break;
    }
  };

  async function playDealPhase(game) {
    var players = await game.playersAsync();
    var playersToDeal = [];

    // Phase 1: Update player states and return all cards to deck
    for (var player of players) {
      var dealCards = player.lives > 0;
      player.playedCardsCnt = 0;
      player.submitted = false;
      if (player.hasOptionCard('circuit_breaker') && player.damage >= 3) {
        player.powerState = GameLogic.DOWN;
        await player.discardOptionCardAsync('circuit_breaker');
      }

      if (player.powerState === GameLogic.OFF) {
        // player was powered down last turn
        // -> can choose to stay powered down this turn
        player.optionalInstantPowerDown = true;
      } else if (player.powerState === GameLogic.DOWN) {
        // player announced power down last turn
        player.powerState = GameLogic.OFF;
        if (!player.optionalInstantPowerDown) {
          player.submitted = true;
          player.damage = 0;
          dealCards = false;
        }
      }

      await Players.updateAsync(player._id, player);
      await CardLogic.discardCardsAsync(game, player);
      if (dealCards) {
        playersToDeal.push(player);
      }
    }

    // Phase 2: Shuffle the deck once after all cards are returned
    var deck = await game.getDeckAsync();
    console.log("Shuffling deck with " + deck.cards.length + " cards");
    deck.cards = shuffle(deck.cards);
    await Deck.upsertAsync({gameId: game._id}, deck);

    // Phase 3: Deal cards to all eligible players (randomized order)
    playersToDeal = shuffle(playersToDeal);
    for (var player of playersToDeal) {
      await CardLogic.dealCardsAsync(game, player);
    }

    await game.setGamePhaseAsync(GameState.PHASE.PROGRAM);
    var notPoweredDownCnt = await Players.find({gameId: game._id, submitted: false}).countAsync();
    if (notPoweredDownCnt === 0) {
      await game.nextGamePhaseAsync();
    }
  }

  async function playProgramCardsSubmitted(game) {
    await Games.updateAsync(game._id, {
      $set: {
        gamePhase: GameState.PHASE.PLAY,
        playPhase: GameState.PLAY_PHASE.IDLE,
        playPhaseCount: 1
      }
    });
    await game.nextPlayPhaseAsync();
  }

  async function playNextRespawn(game) {
    if (game.waitingForRespawn.length > 0) {
      var player = await Players.findOneAsync(game.waitingForRespawn.pop());
      var nextPhase;
      var x = player.start.x;
      var y = player.start.y;
      if (await game.isPlayerOnTileAsync(x, y)) {
        nextPhase = GameState.RESPAWN_PHASE.CHOOSE_POSITION;
      } else {
        await GameLogic.respawnPlayerAtPosAsync(player, x, y);
        nextPhase = GameState.RESPAWN_PHASE.CHOOSE_DIRECTION;
      }
      await Games.updateAsync(game._id, {
        $set: {
          respawnPhase: nextPhase,
          respawnPlayerId: player._id,
          waitingForRespawn: game.waitingForRespawn
        }
      });
      await game.nextRespawnPhaseAsync();
    } else {
      await Games.updateAsync(game._id, {
        $set: {
          gamePhase: GameState.PHASE.DEAL,
          respawnUserId: null,
          respawnPlayerId: null,
          selectOptions: null
        }
      });
      await game.nextGamePhaseAsync();
    }
  }

  // play phases:

  scope.nextPlayPhaseAsync = async function (gameId) {
    var game = await Games.findOneAsync(gameId);
    await new Promise(resolve => Meteor.setTimeout(resolve, _NEXT_PHASE_DELAY));
    switch (game.playPhase) {
      case GameState.PLAY_PHASE.IDLE:
        await game.nextPlayPhaseAsync(GameState.PLAY_PHASE.REVEAL_CARDS);
        break;
      case GameState.PLAY_PHASE.REVEAL_CARDS:
        await playRevealCards(game);
        break;
      case GameState.PLAY_PHASE.MOVE_BOTS:
        await playMoveBots(game);
        break;
      case GameState.PLAY_PHASE.MOVE_BOARD:
        await announceAsync(game, playMoveBoard);
        break;
      case GameState.PLAY_PHASE.LASERS:
        await announceAsync(game, playLasers);
        break;
      case GameState.PLAY_PHASE.CHECKPOINTS:
        await playCheckpoints(game);
        break;
      case GameState.PLAY_PHASE.REPAIRS:
        await announceAsync(game, playRepairs);
        break;
    }
  };

  async function announceAsync(game, fn) {
    await new Promise(resolve => Meteor.setTimeout(resolve, _ANNOUNCE_NEXT_PHASE));
    await fn(game);
  }

  async function playRevealCards(game) {
    await Games.updateAsync(game._id, {$set: {playPhase: GameState.PLAY_PHASE.MOVE_BOTS}});

    var players = await game.livingPlayersAsync();
    for (var player of players) {
      if (player.isActive()) {
        var cards = player.cards;
        var cardIndex = player.playedCardsCnt;
        var chosenCards = await player.getChosenCardsAsync();
        console.log("reveal", cardIndex, chosenCards[cardIndex]);
        cards[cardIndex] = chosenCards[cardIndex];
        await Players.updateAsync(player._id, {$set: {cards: cards}});
      }
    }
    await GameState.nextPlayPhaseAsync(game._id);
  }

  async function playMoveBots(game) {
    var players = await game.activePlayersAsync();
    // play 1 card per player
    game.cardsToPlay = [];

    for (var player of players) {
      var chosenCards = await player.getChosenCardsAsync();
      var card = {
        cardId: chosenCards[player.playedCardsCnt]
      };
      await Players.updateAsync(player._id, {$inc: {playedCardsCnt: 1}});
      if (card.cardId >= 0) {
        card.playerId = player._id;
        game.cardsToPlay.push(card);
      }
    }
    game.cardsToPlay.sort(function (a, b) { return b.cardId - a.cardId; });  // cardId has same order as card priority
    await Games.updateAsync(game._id, {
      $set: {
        cardsToPlay: game.cardsToPlay
      }
    });
    if (game.cardsToPlay.length > 0) {
      await playMoveBot(game);
    } else {
      await game.nextPlayPhaseAsync(GameState.PLAY_PHASE.MOVE_BOARD);
    }
  }

  async function playMoveBot(game) {
    var card = game.cardsToPlay.shift();
    await Games.updateAsync(game._id, {
      $set: {
        announceCard: card,
        cardsToPlay: game.cardsToPlay
      }
    });
    var player = await Players.findOneAsync(card.playerId);
    await new Promise(resolve => Meteor.setTimeout(resolve, _ANNOUNCE_CARD_TIME));
    await Games.updateAsync(game._id, {
      $set: {
        announceCard: null,
      }
    });
    await GameLogic.playCard(player, card.cardId);
    if (game.cardsToPlay.length > 0) {
      await new Promise(resolve => Meteor.setTimeout(resolve, _EXECUTE_CARD_TIME));
      await playMoveBot(game);
    } else {
      await new Promise(resolve => Meteor.setTimeout(resolve, _EXECUTE_CARD_TIME));
      await Games.updateAsync(game._id, {
        $set: {
          announceCard: null,
        }
      });
      await game.nextPlayPhaseAsync(GameState.PLAY_PHASE.MOVE_BOARD);
    }
  }

  async function playMoveBoard(game) {
    var players = await game.playersOnBoardAsync();
    await GameLogic.executeRollers(players);
    await GameLogic.executeExpressRollers(players);
    await GameLogic.executeGears(players);
    await GameLogic.executePushers(players);

    await game.nextPlayPhaseAsync(GameState.PLAY_PHASE.LASERS);
  }

  async function playLasers(game) {
    var players = await game.playersOnBoardAsync();
    await game.setPlayPhaseAsync(GameState.PLAY_PHASE.CHECKPOINTS);
    await GameLogic.executeLasers(players);
    await game.nextPlayPhaseAsync();
  }

  async function playCheckpoints(game) {
    if (!await checkIfWeHaveAWinner(game)) {
      if (game.playPhaseCount < 5) {
        await Games.updateAsync(game._id,
            {$set: {playPhase: GameState.PLAY_PHASE.REVEAL_CARDS}, $inc: {playPhaseCount: 1}}
        );
        await game.nextPlayPhaseAsync();
      } else {
        await game.nextPlayPhaseAsync(GameState.PLAY_PHASE.REPAIRS);
      }
    }
  }

  async function playRepairs(game) {
    var players = await game.playersOnBoardAsync();
    await GameLogic.executeRepairs(players);
    await game.nextGamePhaseAsync();
  }

  async function checkCheckpoints(player) {
    var tile = await player.tileAsync();

    if (tile.checkpoint || tile.repair) {
      player.updateStartPosition();
      if (tile.checkpoint && tile.checkpoint === player.visited_checkpoints + 1) {
        player.visited_checkpoints++;
      }
      await Players.updateAsync(player._id, player);
    }
  }

  async function checkIfWeHaveAWinner(game) {
    var players = await Players.find({gameId: game._id}).fetchAsync();
    var board = game.board();
    var ended = false;
    var lastManStanding = false;
    var livingPlayers = 0;
    var messages = [];

    for (var i in players) {
      var player = players[i];
      await checkCheckpoints(player);
      if (player.lives > 0) {
        livingPlayers++;
        lastManStanding = player;
      } else {
        messages.push('Player ' + player.name + ' ran out of lives');
        console.log("Player ran out of lives: " + player.name);
      }

      if (player.visited_checkpoints === board.checkpoints.length) {
        await Games.updateAsync(game._id, {
          $set: {
            gamePhase: GameState.PHASE.ENDED,
            winner: player.name,
            stopped: new Date().getTime()
          }
        });
        messages.push("Player " + player.name + " won the game!!");
        console.log("Player won: " + player.name);
        await buildHighscores();
        console.log("after build highscores");
        ended = true;
        break;
      }
    }

    if (livingPlayers === 0) {
      messages.push("All robots are dead");
      await Games.updateAsync(game._id, {
        $set: {
          gamePhase: GameState.PHASE.ENDED,
          winner: "Nobody",
          stopped: new Date().getTime()
        }
      });
      ended = true;
    } else if (livingPlayers === 1 && players.length > 1) {
      messages.push("Player " + lastManStanding.name + " won the game!!");
      console.log("Last player standing: " + lastManStanding.name);
      await Games.updateAsync(game._id, {
        $set: {
          gamePhase: GameState.PHASE.ENDED,
          winner: lastManStanding.name,
          stopped: new Date().getTime()
        }
      });
      await buildHighscores();
      ended = true;
    }
    for (var msg of messages) {
      await game.chatAsync(msg);
    }
    return ended;
  }

  // respawn phases
  scope.nextRespawnPhaseAsync = async function (gameId) {
    var game = await Games.findOneAsync(gameId);
    await new Promise(resolve => Meteor.setTimeout(resolve, _NEXT_PHASE_DELAY));
    switch (game.respawnPhase) {
      case GameState.RESPAWN_PHASE.CHOOSE_POSITION:
        await prepareChooseRespawnPosition(game);
        break;
      case GameState.RESPAWN_PHASE.CHOOSE_DIRECTION:
        await prepareChooseRespawnDirection(game);
        break;
    }
  };

  async function prepareChooseRespawnPosition(game) {
    var player = await Players.findOneAsync(game.respawnPlayerId);
    var selectOptions = [];
    var x = player.start.x;
    var y = player.start.y;
    var board = game.board();
    // House rule: the base game says "adjacent space" (radius 1). If every
    // adjacent square is a pit, off-board, or occupied, expand outward ring
    // by ring until at least one valid square is found, capped at the board's
    // longer dimension so the loop always terminates.
    var maxR = Math.max(board.width, board.height);
    for (var r = 1; r <= maxR && selectOptions.length === 0; ++r) {
      for (var dx = -r; dx <= r; ++dx) {
        for (var dy = -r; dy <= r; ++dy) {
          // For r > 1, only consider the new ring (skip inner squares
          // already evaluated at smaller radii).
          if (r > 1 && Math.max(Math.abs(dx), Math.abs(dy)) < r) continue;
          if (board.onBoard(x + dx, y + dy) &&
              !await game.isPlayerOnTileAsync(x + dx, y + dy) &&
              board.getTile(x + dx, y + dy).type !== Tile.VOID) {
            selectOptions.push({x: x + dx, y: y + dy});
          }
        }
      }
    }
    await Games.updateAsync(game._id, {
      $set: {
        selectOptions: selectOptions,
        respawnUserId: player.userId
      }
    });
  }

  async function prepareChooseRespawnDirection(game) {
    var player = await Players.findOneAsync(game.respawnPlayerId);
    var selectOptions = [];
    var x = player.position.x;
    var y = player.position.y;
    var step;
    if (player.start.x !== x && player.start.y !== y) {
      for (var i = 0; i < 4; ++i) {
        step = Board.to_step(i);
        if (await noPlayerOnNextThreeAsync(x, y, step.x, step.y, game)) {
          selectOptions.push({x: x + step.x, y: y + step.y, dir: i});
        }
      }
    } else {
      for (var j = 0; j < 4; ++j) {
        step = Board.to_step(j);
        selectOptions.push({
          x: x + step.x,
          y: y + step.y,
          dir: j
        });
      }
    }
    await Games.updateAsync(game._id, {
      $set: {
        selectOptions: selectOptions,
        respawnUserId: player.userId
      }
    });
  }

  async function noPlayerOnNextThreeAsync(x, y, dx, dy, game) {
    return !await game.isPlayerOnTileAsync(x + dx, y + dy) &&
           !await game.isPlayerOnTileAsync(x + 2 * dx, y + 2 * dy) &&
           !await game.isPlayerOnTileAsync(x + 3 * dx, y + 3 * dy);
  }
})(GameState);
