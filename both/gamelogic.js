GameLogic = {
  UP: 0,
  RIGHT: 1,
  DOWN: 2,
  LEFT: 3,
  OFF: 4,
  ON: 5,
  TIMER: 30,
  CARD_SLOTS: 5,
  // Per-tile animation duration. Shared with the client (see client/views/board/board.js)
  // so the server's inter-batch pause matches the time the client needs to play out the
  // prior batch's smooth glide.
  MS_PER_TILE: 220,
};

(function (scope) {
  _CARD_PLAY_DELAY = 1000;

  scope.playCard = async function (player, card) {
    if (player.needsRespawn) return;
    console.log('trying to play next card for player ' + player.name);

    if (card !== CardLogic.EMPTY) {
      const game = await player.gameAsync();
      const cardType = CardLogic.cardType(card, await game.playerCntAsync());
      console.log('playing card ' + cardType.name + ' for player ' + player.name);

      player.rotate(cardType.direction);

      if (cardType.position === 0) {
        await checkRespawnsAndUpdateDb(player);
      } else {
        const direction = Math.min(cardType.position, 1);
        const totalSteps = Math.abs(cardType.position);
        // Group contiguous steps that move the same set of robots into a "batch".
        // Between batches, pause long enough for the client's smooth glide of the
        // prior batch to finish, so a pushed robot doesn't start moving before the
        // pusher visually reaches it. Skip the pause when the prior batch ended in
        // a death — the 1s removePlayerWithDelay already covered the glide time.
        let prevMovingSet = null;
        let priorBatchTiles = 0;
        let prevStepDied = false;
        for (let j = 0; j < totalSteps; j++) {
          const players = await Players.find({ gameId: player.gameId }).fetchAsync();
          const movingSet = await predictMovingSet(players, player, direction);
          if (
            prevMovingSet !== null &&
            !setsEqual(movingSet, prevMovingSet) &&
            priorBatchTiles > 0
          ) {
            if (!prevStepDied) {
              await new Promise((resolve) =>
                Meteor.setTimeout(resolve, priorBatchTiles * GameLogic.MS_PER_TILE)
              );
            }
            priorBatchTiles = 0;
          }
          prevStepDied = await executeStep(players, player, direction);
          if (movingSet.size > 0) {
            priorBatchTiles += 1;
          }
          prevMovingSet = movingSet;
          if (player.needsRespawn) {
            break;
          } // player respawned, don't continue playing out this card.
        }
      }
    } else {
      console.warn('card is not playable ' + card + ' player ' + player.name);
    }
  };

  scope.executeRollers = async function (players) {
    const roller_moves = [];
    for (const player of players) {
      //check if is on roller
      const tile = await player.tileAsync();
      const moving = tile.type === Tile.ROLLER;
      if (!player.needsRespawn) {
        roller_moves.push(rollerMove(player, tile, moving));
      }
    }
    await tryToMovePlayersOnRollers(roller_moves);
  };

  // move players 2nd step in roller direction; 1st step is done by executeRollers,
  scope.executeExpressRollers = async function (players) {
    const roller_moves = [];
    for (const player of players) {
      //check if is on roller
      const tile = await player.tileAsync();
      const moving = tile.type === Tile.ROLLER && tile.speed === 2;
      if (!player.needsRespawn) {
        roller_moves.push(rollerMove(player, tile, moving));
      }
    }
    await tryToMovePlayersOnRollers(roller_moves);
  };

  scope.executeGears = async function (players) {
    for (const player of players) {
      const tile = await player.tileAsync();
      if (tile.type === Tile.GEAR) {
        player.rotate(tile.rotate);
        await Players.updateAsync(player._id, player);
      }
    }
  };

  scope.executePushers = async function (players) {
    if (players.length === 0) return;
    const game = await players[0].gameAsync();
    for (const player of players) {
      const tile = await player.tileAsync();
      if (tile.type === Tile.PUSHER && game.playPhaseCount % 2 === tile.pusher_type) {
        const cleanups = [];
        await tryToMovePlayer(players, player, tile.move, cleanups);
        for (const cleanup of cleanups) await cleanup();
      }
    }
  };

  scope.executeLasers = async function (players) {
    let victims = [];
    const game = players.length > 0 ? await players[0].gameAsync() : null;
    for (const player of players) {
      const tile = await player.tileAsync();
      if (tile.damage > 0) {
        await player.addDamageAsync(tile.damage);
        await player.chatAsync('was hit by a laser, total damage: ' + player.damage);
        await checkRespawnsAndUpdateDb(player);
      }
      if (!player.isPoweredDown() && !player.needsRespawn) {
        victims = await scope.shootRobotLaserAsync(players, player, victims);
        if (player.hasOptionCard('rear-firing_laser')) {
          player.rotate(2);
          victims = await scope.shootRobotLaserAsync(players, player, victims);
          player.rotate(2);
        }
        if (
          player.hasOptionCard('mini_howitzer') ||
          player.hasOptionCard('fire_control') ||
          player.hasOptionCard('radio_control') ||
          (player.hasOptionCard('scrambler') && game.playPhaseCount < 5) ||
          player.hasOptionCard('tractor_beam') ||
          player.hasOptionCard('pressor_beam')
        ) {
          //todo: there is no game state laser options yet..?
          //player.game().setPlayPhase(GameState.PLAY_PHASE.LASER_OPTIONS);
        }
      }
    }
    for (const victim of victims) {
      await victim.addDamageAsync(1);
      await checkRespawnsAndUpdateDb(victim);
    }
  };

  scope.executeRepairs = async function (players) {
    for (const player of players) {
      const tile = await player.tileAsync();
      if (tile.option) {
        await player.drawOptionCardAsync();
        player.damage = Math.max(player.damage - 1, 0);
      } else if (tile.checkpoint) {
        player.damage = Math.max(player.damage - 1, 0);
      } else if (tile.repair) {
        player.damage = Math.max(player.damage - 3, 0);
      }
      await Players.updateAsync(player._id, player);
    }
  };

  scope.shootRobotLaserAsync = async function (players, player, victims) {
    const step = { x: 0, y: 0 };
    const board = await player.boardAsync();
    switch (player.direction) {
      case GameLogic.UP:
        step.y = -1;
        break;
      case GameLogic.RIGHT:
        step.x = 1;
        break;
      case GameLogic.DOWN:
        step.y = 1;
        break;
      case GameLogic.LEFT:
        step.x = -1;
        break;
    }
    let x = player.position.x;
    let y = player.position.y;
    let shotDistance = 0;
    let highPower = player.hasOptionCard('high-power_laser');
    while (board.onBoard(x + step.x, y + step.y) && (board.canMove(x, y, step) || highPower)) {
      if (highPower && !board.canMove(x, y, step)) {
        highPower = false;
      }
      x += step.x;
      y += step.y;
      shotDistance++;
      const victim = isPlayerOnTile(players, x, y);
      if (victim) {
        debug_info =
          'Shot: (' + player.position.x + ',' + player.position.y + ') -> (' + x + ',' + y + ')';
        await victim.chatAsync(
          'was shot by ' + player.name + ', Total damage: ' + (victim.damage + 1),
          debug_info
        );
        await Players.updateAsync(player._id, { $set: { shotDistance: shotDistance } });
        victims.push(victim);
        if (player.hasOptionCard('double-barreled_laser')) {
          victims.push(victim);
        }
        if (!highPower) {
          return victims;
        }
        highPower = false;
      }
    }
    await Players.updateAsync(player._id, { $set: { shotDistance: shotDistance } });
    return victims;
  };

  async function executeStep(players, player, direction) {
    // direction = 1 for step forward, -1 for step backwards. Returns true if
    // anyone died as a result of this step (used by playCard to skip the
    // inter-batch animation pause — the 1s death cleanup has already covered
    // the prior batch's smooth-glide time).
    const step = { x: 0, y: 0 };
    switch (player.direction) {
      case GameLogic.UP:
        step.y = -1 * direction;
        break;
      case GameLogic.RIGHT:
        step.x = direction;
        break;
      case GameLogic.DOWN:
        step.y = direction;
        break;
      case GameLogic.LEFT:
        step.x = -1 * direction;
        break;
    }
    const cleanups = [];
    await tryToMovePlayer(players, player, step, cleanups);
    for (const cleanup of cleanups) await cleanup();
    return cleanups.length > 0;
  }

  async function tryToMovePlayer(players, p, step, cleanups) {
    // cleanups: shared queue threaded through push recursion. When a pushed
    // robot falls off the board / into a void, its 1-second remove delay is
    // deferred to the caller (executeStep / executePushers) so the pusher's
    // position update lands before the off-screen teleport — otherwise the
    // pushed robot leaves an empty square that the pusher then slides into a
    // second later.
    const board = await p.boardAsync();
    let makeMove = true;
    if (step.x !== 0 || step.y !== 0) {
      console.log(
        'trying to move player ' +
          p.name +
          ' to ' +
          (p.position.x + step.x) +
          ',' +
          (p.position.y + step.y)
      );

      if (board.canMove(p.position.x, p.position.y, step)) {
        const pushedPlayer = isPlayerOnTile(players, p.position.x + step.x, p.position.y + step.y);
        if (pushedPlayer !== null) {
          console.log('trying to push player ' + pushedPlayer.name);
          if (p.hasOptionCard('ramming_gear')) {
            await pushedPlayer.addDamageAsync(1);
          }
          makeMove = await tryToMovePlayer(players, pushedPlayer, step, cleanups);
        }
        if (makeMove) {
          console.log(
            'moving player ' +
              p.name +
              ' to ' +
              (p.position.x + step.x) +
              ',' +
              (p.position.y + step.y)
          );
          p.move(step);
          await checkRespawnsAndUpdateDb(p, cleanups);
          return true;
        }
      }
    }
    return false;
  }

  function rollerMove(player, tile, is_moving) {
    if (is_moving) {
      return {
        player: player,
        x: player.position.x + tile.move.x,
        y: player.position.y + tile.move.y,
        rotate: tile.rotate,
        step: tile.move,
        canceled: false,
      };
    } else {
      // to detect conflicts add non-moving players
      return {
        player: player,
        x: player.position.x,
        y: player.position.y,
        canceled: true,
      };
    }
  }

  async function tryToMovePlayersOnRollers(moves) {
    let move_canceled = true;
    let max = 0;
    while (move_canceled) {
      // if a move was canceled we have to check for other conflicts again
      max++;
      if (max > 100) {
        console.warn('Infinite loop detected.. cancelling..');
        break;
      }
      move_canceled = false;
      for (let i = 0; i < moves.length; ++i) {
        for (let j = i + 1; j < moves.length; ++j) {
          if (moves[i].x === moves[j].x && moves[i].y === moves[j].y) {
            moves[i].canceled = true;
            moves[j].canceled = true;
            moves[i].x = moves[i].player.position.x;
            moves[j].x = moves[j].player.position.x;
            moves[i].y = moves[i].player.position.y;
            moves[j].y = moves[j].player.position.y;
            move_canceled = true;
          }
        }
      }
    }
    for (const roller_move of moves) {
      if (!roller_move.canceled) {
        //move player 1 step in roller direction and rotate
        roller_move.player.move(roller_move.step);
        roller_move.player.rotate(roller_move.rotate);
        await checkRespawnsAndUpdateDb(roller_move.player);
      }
    }
  }

  function stepVector(player, direction) {
    const step = { x: 0, y: 0 };
    switch (player.direction) {
      case GameLogic.UP:
        step.y = -1 * direction;
        break;
      case GameLogic.RIGHT:
        step.x = direction;
        break;
      case GameLogic.DOWN:
        step.y = direction;
        break;
      case GameLogic.LEFT:
        step.x = -1 * direction;
        break;
    }
    return step;
  }

  // Walks the would-be push chain for `player` taking one step in `direction` and
  // returns the set of player ids that would visibly move. Returns an empty set if
  // the step is blocked by a wall or an immovable chain — those are also batch
  // boundaries for animation purposes. Pure: does not mutate state.
  async function predictMovingSet(players, player, direction) {
    const step = stepVector(player, direction);
    const set = new Set();
    if (step.x === 0 && step.y === 0) return set;
    const board = await player.boardAsync();
    let p = player;
    // bounded by player count; each pushed player is added once
    for (let guard = 0; guard <= players.length; guard++) {
      if (!board.canMove(p.position.x, p.position.y, step)) return new Set();
      set.add(p._id);
      const next = isPlayerOnTile(players, p.position.x + step.x, p.position.y + step.y);
      if (next === null) return set;
      p = next;
    }
    return set;
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  function isPlayerOnTile(players, x, y) {
    let found = null;
    players.forEach(function (player) {
      if (player.position.x === x && player.position.y === y && !player.needsRespawn) {
        found = player;
      }
    });
    return found;
  }

  async function checkRespawnsAndUpdateDb(player, cleanups) {
    const isOnBoard = await player.isOnBoardAsync();
    const isOnVoid = isOnBoard ? await player.isOnVoidAsync() : false;
    console.log(
      player.name +
        ' Player.position ' +
        player.position.x +
        ',' +
        player.position.y +
        ' ' +
        isOnBoard +
        '|' +
        isOnVoid
    );
    if (!player.needsRespawn && (!isOnBoard || isOnVoid || player.damage > 9)) {
      if (player.hasOptionCard('superior_archive')) {
        player.damage = 0;
      } else {
        player.damage = 2;
      }

      player.lives--;
      player.needsRespawn = true;
      player.optionalInstantPowerDown = true;
      player.optionCards = {};
      await Players.updateAsync(player._id, player);
      if (player.lives > 0) {
        const game = await player.gameAsync();
        game.waitingForRespawn.push(player._id);
        await Games.updateAsync(game._id, game);
      }
      await player.chatAsync('died! (lives: ' + player.lives + ', damage: ' + player.damage + ')');
      if (cleanups) {
        cleanups.push(() => removePlayerWithDelay(player));
      } else {
        await removePlayerWithDelay(player);
      }
    } else {
      console.log('updating position', player.name);
      await Players.updateAsync(player._id, player);
    }
  }

  async function removePlayerWithDelay(player) {
    await new Promise((resolve) => Meteor.setTimeout(resolve, _CARD_PLAY_DELAY));
    const board = await player.boardAsync();
    // Park players waiting to respawn at the bottom-right; permanently
    // eliminated players (out of lives) line up along the bottom-left in
    // elimination order so multiple eliminations don't stack on the same tile.
    player.position.y = board.height;
    if (player.lives > 0) {
      player.position.x = board.width - 1;
    } else {
      const parkedCount = await Players.find({
        gameId: player.gameId,
        lives: { $lte: 0 },
        'position.y': board.height,
        _id: { $ne: player._id },
      }).countAsync();
      player.position.x = parkedCount;
    }
    player.direction = GameLogic.UP;
    player.optionCards = {};

    const playerCards = await Cards.findOneAsync({ playerId: player._id });
    const deck = await Deck.findOneAsync({ gameId: player.gameId });
    for (const unusedCard of playerCards.handCards) {
      if (unusedCard >= 0) {
        deck.cards.push(unusedCard);
      }
    }
    await Deck.updateAsync(deck._id, deck);
    // Clear handCards so discardCardsAsync doesn't return them again
    await Cards.updateAsync({ playerId: player._id }, { $set: { handCards: [] } });

    console.log('removing player', player.name);
    await Players.updateAsync(player._id, player);
  }

  scope.respawnPlayerAtPosAsync = async function (player, x, y) {
    player.position.x = x;
    player.position.y = y;
    console.log('respawning player', player.name, 'at', x, ',', y);
    await Players.updateAsync(player._id, player);
  };

  scope.respawnPlayerWithDirAsync = async function (player, dir) {
    player.direction = dir;
    player.needsRespawn = false;
    await Players.updateAsync(player._id, player);
  };
})(GameLogic);
