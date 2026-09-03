import { Cards } from '../collections/cards.ts';
import { Decks } from '../collections/deck.ts';
import { Games } from '../collections/games.ts';
import { Players, type Player } from '../collections/players.ts';
import { CardLogic } from './cardlogic.ts';
import { Tile } from './tile.ts';

// A deferred board cleanup for a robot that just died. Queued rather than awaited when
// the death happened inside a push chain — `tryToMovePlayer` says why.
type Cleanup = () => Promise<void>;

// One would-be roller move. `rotate` and `step` are only on a move that is actually
// happening: a stationary player is in the list purely so conflicts can be spotted.
interface RollerMove {
  player: Player;
  x: number;
  y: number;
  canceled: boolean;
  rotate?: number;
  step?: { x: number; y: number };
}

// `GameLogic` is the constants below plus the handlers the `Object.assign` at the foot of
// this file bolts on, and tsc cannot follow that assignment. So the whole surface is
// declared here and the literal asserted to it: `executeLasers` below, gamestate.ts and
// the methods all read handlers off the object, so leaving them out of the type would be
// a lie. The assertion pins the constants — a name in one half and not the other fails it
// — while the handler list is kept honest only by sitting next to its `Object.assign`.
interface GameLogicSurface {
  UP: number;
  RIGHT: number;
  DOWN: number;
  LEFT: number;
  OFF: number;
  ON: number;
  TIMER: number;
  CARD_SLOTS: number;
  MS_PER_TILE: number;
  playCard: typeof playCard;
  executeRollers: typeof executeRollers;
  executeExpressRollers: typeof executeExpressRollers;
  executeGears: typeof executeGears;
  executePushers: typeof executePushers;
  executeLasers: typeof executeLasers;
  executeRepairs: typeof executeRepairs;
  shootRobotLaserAsync: typeof shootRobotLaserAsync;
  respawnPlayerAtPosAsync: typeof respawnPlayerAtPosAsync;
  respawnPlayerWithDirAsync: typeof respawnPlayerWithDirAsync;
}

export const GameLogic = {
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
} as GameLogicSurface;

const _CARD_PLAY_DELAY = 1000;

async function playCard(player: Player, card: number) {
  if (player.needsRespawn) return;
  console.log(`trying to play next card for player ${player.name}`);

  if (card !== CardLogic.EMPTY) {
    const game = await player.gameAsync();
    // Every card in a register came out of this game's deck, so the lookup always finds
    // one — see the note on `cardType`.
    const cardType = CardLogic.cardType(card, await game.playerCntAsync())!;
    console.log(`playing card ${cardType.name} for player ${player.name}`);

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
      let prevMovingSet: Set<string> | null = null;
      let priorBatchTiles = 0;
      let prevStepDied = false;
      for (let j = 0; j < totalSteps; j++) {
        const players = await Players.find({ gameId: player.gameId }).fetchAsync();
        const movingSet = await predictMovingSet(players, player, direction);
        if (prevMovingSet !== null && !setsEqual(movingSet, prevMovingSet) && priorBatchTiles > 0) {
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
    console.warn(`card is not playable ${card} player ${player.name}`);
  }
}

async function executeRollers(players: Player[]) {
  const roller_moves: RollerMove[] = [];
  for (const player of players) {
    //check if is on roller
    const tile = await player.tileAsync();
    const moving = tile.type === Tile.ROLLER;
    if (!player.needsRespawn) {
      roller_moves.push(rollerMove(player, tile, moving));
    }
  }
  await tryToMovePlayersOnRollers(roller_moves);
}

// move players 2nd step in roller direction; 1st step is done by executeRollers,
async function executeExpressRollers(players: Player[]) {
  const roller_moves: RollerMove[] = [];
  for (const player of players) {
    //check if is on roller
    const tile = await player.tileAsync();
    const moving = tile.type === Tile.ROLLER && tile.speed === 2;
    if (!player.needsRespawn) {
      roller_moves.push(rollerMove(player, tile, moving));
    }
  }
  await tryToMovePlayersOnRollers(roller_moves);
}

async function executeGears(players: Player[]) {
  for (const player of players) {
    const tile = await player.tileAsync();
    if (tile.type === Tile.GEAR) {
      player.rotate(tile.rotate);
      await player.saveAsync();
    }
  }
}

async function executePushers(players: Player[]) {
  if (players.length === 0) return;
  const game = await players[0].gameAsync();
  for (const player of players) {
    const tile = await player.tileAsync();
    if (tile.type === Tile.PUSHER && game.playPhaseCount % 2 === tile.pusher_type) {
      const cleanups: Cleanup[] = [];
      await tryToMovePlayer(players, player, tile.move, cleanups);
      for (const cleanup of cleanups) await cleanup();
    }
  }
}

async function executeLasers(players: Player[]) {
  let victims: Player[] = [];
  const game = players.length > 0 ? await players[0].gameAsync() : null;
  for (const player of players) {
    const tile = await player.tileAsync();
    if (tile.damage > 0) {
      await player.addDamageAsync(tile.damage);
      await player.chatAsync(`was hit by a laser, total damage: ${player.damage}`);
      await checkRespawnsAndUpdateDb(player);
    }
    if (!player.isPoweredDown() && !player.needsRespawn) {
      victims = await GameLogic.shootRobotLaserAsync(players, player, victims);
      if (player.hasOptionCard('rear-firing_laser')) {
        player.rotate(2);
        victims = await GameLogic.shootRobotLaserAsync(players, player, victims);
        player.rotate(2);
      }
      if (
        player.hasOptionCard('mini_howitzer') ||
        player.hasOptionCard('fire_control') ||
        player.hasOptionCard('radio_control') ||
        // `game` is null only when there is nobody to loop over, so inside the loop it
        // is always there.
        (player.hasOptionCard('scrambler') && game!.playPhaseCount < 5) ||
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
}

async function executeRepairs(players: Player[]) {
  for (const player of players) {
    const tile = await player.tileAsync();
    // Rules.pdf p.8 ("Repairs & Upgrades"): every repair space discards 1 Damage
    // token, and a wrench/hammer (option) space also draws an Option card. Checkpoint
    // flags count as single repair sites — setup places a number sticker and a single
    // wrench on each flag. The chain stays if/else-if because option and checkpoint
    // tiles also carry `.repair = true`: a tile must heal only once.
    if (tile.option) {
      await player.drawOptionCardAsync();
      player.damage = Math.max(player.damage - 1, 0);
    } else if (tile.checkpoint || tile.repair) {
      player.damage = Math.max(player.damage - 1, 0);
    }
    await player.saveAsync();
  }
}

async function shootRobotLaserAsync(players: Player[], player: Player, victims: Player[]) {
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
      const debug_info = `Shot: (${player.position.x},${player.position.y}) -> (${x},${y})`;
      await victim.chatAsync(
        `was shot by ${player.name}, Total damage: ${victim.damage + 1}`,
        debug_info
      );
      await Players.updateAsync(player._id, { $set: { shotDistance } });
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
  await Players.updateAsync(player._id, { $set: { shotDistance } });
  return victims;
}

async function executeStep(players: Player[], player: Player, direction: number) {
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
  const cleanups: Cleanup[] = [];
  await tryToMovePlayer(players, player, step, cleanups);
  for (const cleanup of cleanups) await cleanup();
  return cleanups.length > 0;
}

async function tryToMovePlayer(
  players: Player[],
  p: Player,
  step: { x: number; y: number },
  cleanups: Cleanup[]
) {
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
        console.log(`trying to push player ${pushedPlayer.name}`);
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

function rollerMove(player: Player, tile: Tile, is_moving: boolean): RollerMove {
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

async function tryToMovePlayersOnRollers(moves: RollerMove[]) {
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
      // Not canceled means this came from the moving branch of `rollerMove`, which always
      // sets both; the conflict loop above only ever turns `canceled` on.
      roller_move.player.move(roller_move.step!);
      roller_move.player.rotate(roller_move.rotate!);
      await checkRespawnsAndUpdateDb(roller_move.player);
    }
  }
}

function stepVector(player: Player, direction: number) {
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
async function predictMovingSet(players: Player[], player: Player, direction: number) {
  const step = stepVector(player, direction);
  const set = new Set<string>();
  if (step.x === 0 && step.y === 0) return set;
  const board = await player.boardAsync();
  let p = player;
  // bounded by player count; each pushed player is added once
  for (let guard = 0; guard <= players.length; guard++) {
    if (!board.canMove(p.position.x, p.position.y, step)) return new Set<string>();
    set.add(p._id);
    const next = isPlayerOnTile(players, p.position.x + step.x, p.position.y + step.y);
    if (next === null) return set;
    p = next;
  }
  return set;
}

function setsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// The return type is annotated because the assignment happens inside the `forEach`
// callback, which control-flow analysis does not follow — inferred, this returns `null`.
function isPlayerOnTile(players: Player[], x: number, y: number): Player | null {
  let found: Player | null = null;
  players.forEach((player) => {
    if (player.position.x === x && player.position.y === y && !player.needsRespawn) {
      found = player;
    }
  });
  return found;
}

async function checkRespawnsAndUpdateDb(player: Player, cleanups?: Cleanup[]) {
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
    await player.saveAsync();
    if (player.lives > 0) {
      // A side effect inside the turn, not a phase transition, so it is not a claim —
      // but it must be a $push. Writing the whole game document back here silently
      // overwrote every field another writer had set since it was read, `step` included.
      await Games.updateAsync(player.gameId, { $push: { waitingForRespawn: player._id } });
    }
    await player.chatAsync(`died! (lives: ${player.lives}, damage: ${player.damage})`);
    // A destroyed robot loses its option cards to the discard pile (announced per
    // card), from where they can return to play once the option draw pile runs dry.
    // The emptied map is persisted by removePlayerWithDelay below, which also
    // defensively re-clears it.
    for (const name of Object.keys(player.optionCards)) {
      await player.discardOptionCardAsync(name);
    }
    if (cleanups) {
      cleanups.push(() => removePlayerWithDelay(player));
    } else {
      await removePlayerWithDelay(player);
    }
  } else {
    console.log('updating position', player.name);
    await player.saveAsync();
  }
}

async function removePlayerWithDelay(player: Player) {
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

  // Both are there by the time a robot can die: `joinGame` inserts the cards row, and the
  // deal that put cards in this player's hand is what created the deck. The `!`s record
  // that a missing one throws here, exactly as it did before the types.
  const playerCards = (await Cards.findOneAsync({ playerId: player._id }))!;
  const deck = (await Decks.findOneAsync({ gameId: player.gameId }))!;
  for (const unusedCard of playerCards.handCards) {
    if (unusedCard >= 0) {
      deck.cards.push(unusedCard);
    }
  }
  await deck.saveAsync();
  // Clear handCards so discardCardsAsync doesn't return them again
  await Cards.updateAsync({ playerId: player._id }, { $set: { handCards: [] } });

  console.log('removing player', player.name);
  await player.saveAsync();
}

async function respawnPlayerAtPosAsync(player: Player, x: number, y: number) {
  player.position.x = x;
  player.position.y = y;
  console.log('respawning player', player.name, 'at', x, ',', y);
  await player.saveAsync();
}

async function respawnPlayerWithDirAsync(player: Player, dir: number) {
  player.direction = dir;
  player.needsRespawn = false;
  await player.saveAsync();
}

Object.assign(GameLogic, {
  playCard,
  executeRollers,
  executeExpressRollers,
  executeGears,
  executePushers,
  executeLasers,
  executeRepairs,
  shootRobotLaserAsync,
  respawnPlayerAtPosAsync,
  respawnPlayerWithDirAsync,
});
