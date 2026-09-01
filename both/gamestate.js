import { Games } from '../collections/games.js';
import { Players } from '../collections/players.js';
import { Board } from './board.js';
import { CardLogic } from './cardlogic.js';
import { GameLogic } from './gamelogic.js';
import { shuffle } from './shuffle.js';
import { Tile } from './tile.js';

export const GameState = {
  PHASE: {
    IDLE: 'waiting',
    DEAL: 'deal',
    PROGRAM: 'program',
    PLAY: 'play',
    RESPAWN: 'respawn',
    ENDED: 'game ended',
  },
  PLAY_PHASE: {
    IDLE: 'waiting',
    REVEAL_CARDS: 'reveal',
    MOVE_BOTS: 'move bots',
    MOVE_BOARD: 'move board',
    LASERS: 'lasers',
    LASER_OPTIONS: 'laser options',
    CHECKPOINTS: 'checkpoints',
    REPAIRS: 'repairs',
  },
  RESPAWN_PHASE: {
    CHOOSE_POSITION: 'choose position',
    CHOOSE_DIRECTION: 'choose direction',
  },
};

// `buildHighscores` lives in `server/highscores.js`, which shared code cannot import: it
// would pull server-only code (and `rawCollection`) into the client bundle. The server
// injects it as it loads. The phase machine is only ever driven from server methods, so
// the client never reaches the call sites below and the default is never invoked.
let buildHighscores = async () => {};

export function setBuildHighscores(fn) {
  buildHighscores = fn;
}

const _NEXT_PHASE_DELAY = 250;
const _ANNOUNCE_NEXT_PHASE = 1000;
const _ANNOUNCE_CARD_TIME = 1750; // match to .fadeInAndOut duration in game.scss
const _EXECUTE_CARD_TIME = 1000;

// game phases:
//
// Every write to the game document below is a claim — `game.advanceAsync(...)`, or one
// of the game methods that wrap it — and a claim that resolves to `false` means another
// driver has advanced this game since this one read it. That is the normal outcome for
// the second of two concurrent drivers (a double-clicked start, a player's timer-0
// submit racing the server's auto-submit, an overlapping recovery sweep), not an error:
// the loser has done nothing since its last successful write except idempotent work, so
// it simply returns and lets the winner carry on. Hence the `if (!(await ...)) return;`
// shape at every write. See `advanceAsync` in collections/games.js.

async function nextGamePhaseAsync(gameId) {
  const game = await Games.findOneAsync(gameId);
  await new Promise((resolve) => Meteor.setTimeout(resolve, _NEXT_PHASE_DELAY));
  switch (game.gamePhase) {
    case GameState.PHASE.IDLE:
      if (!(await game.advanceAsync({ $set: { started: true, gamePhase: GameState.PHASE.DEAL } })))
        return;
      await playDealPhase(game);
      break;
    case GameState.PHASE.DEAL:
      if (!(await game.stopAnnounceAsync())) return;
      await playDealPhase(game);
      break;
    case GameState.PHASE.PROGRAM:
      if (!(await game.startAnnounceAsync())) return;
      await playProgramCardsSubmitted(game);
      break;
    case GameState.PHASE.PLAY:
      if (game.waitingForRespawn.length > 0) {
        // `respawnPlayerId: null` marks "no robot picked yet", which is how a recovery
        // sweep tells this state apart from a respawn waiting on a human.
        const claimed = await game.advanceAsync({
          $set: {
            waitingForRespawn: game.waitingForRespawn.reverse(),
            gamePhase: GameState.PHASE.RESPAWN,
            respawnPlayerId: null,
          },
        });
        if (!claimed) return;
        await game.nextGamePhaseAsync();
      } else {
        await game.nextGamePhaseAsync(GameState.PHASE.DEAL);
      }
      break;
    case GameState.PHASE.RESPAWN:
      await playNextRespawn(game);
      break;
  }
}

async function playDealPhase(game) {
  const players = await game.playersAsync();
  let playersToDeal = [];

  // Phase 1: Update player states and return all cards to deck
  for (const player of players) {
    let dealCards = player.lives > 0;
    player.playedCardsCnt = 0;
    player.submitted = false;
    if (player.hasOptionCard('circuit_breaker') && player.damage >= 3) {
      player.powerState = GameLogic.DOWN;
      // Say why in chat: the trigger, the power-down and the discard all land in the
      // same deal pass, far too fast to follow from the UI alone.
      await player.chatAsync('powers down — Circuit Breaker triggered at 30%+ damage');
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
        // Covers announced power-downs too — until now no power-down ever reached
        // the chat (togglePowerDown only console.logs), only the panel badge.
        await player.chatAsync('is powered down this turn');
      }
    }

    await player.saveAsync();
    await CardLogic.discardCardsAsync(game, player);
    if (dealCards) {
      playersToDeal.push(player);
    }
  }

  // Phase 2: Shuffle the deck once after all cards are returned
  const deck = await game.getDeckAsync();
  console.log(`Shuffling deck with ${deck.cards.length} cards`);
  deck.cards = shuffle(deck.cards);
  await deck.saveAsync();

  // Phase 3: Deal cards to all eligible players (randomized order)
  playersToDeal = shuffle(playersToDeal);
  for (const player of playersToDeal) {
    await CardLogic.dealCardsAsync(game, player);
  }

  // Entering PROGRAM opens a new programming round. The counter gives every
  // submission a turn identity: playCards rejects a round number that no longer
  // matches, which is what stops a stale or replayed submit from a previous turn
  // from being accepted as this turn's program.
  const claimed = await game.advanceAsync({
    $set: { gamePhase: GameState.PHASE.PROGRAM },
    $inc: { programRound: 1 },
  });
  if (!claimed) return;
  const notPoweredDownCnt = await Players.find({
    gameId: game._id,
    submitted: false,
  }).countAsync();
  if (notPoweredDownCnt === 0) {
    await game.nextGamePhaseAsync();
  }
}

async function playProgramCardsSubmitted(game) {
  const claimed = await game.advanceAsync({
    $set: {
      gamePhase: GameState.PHASE.PLAY,
      playPhase: GameState.PLAY_PHASE.IDLE,
      playPhaseCount: 1,
    },
  });
  if (!claimed) return;
  await game.nextPlayPhaseAsync();
}

async function playNextRespawn(game) {
  if (game.waitingForRespawn.length > 0) {
    const player = await Players.findOneAsync(game.waitingForRespawn.pop());
    let nextPhase;
    const x = player.start.x;
    const y = player.start.y;
    // The robot itself never counts as the occupant of its start tile. This step has to
    // reach the same decision when it is run again — a restart replays it — and after
    // the first run the robot is already standing on that tile; without the `_id` check
    // a re-run would find it there and turn a CHOOSE_DIRECTION into a CHOOSE_POSITION.
    const occupant = await game.isPlayerOnTileAsync(x, y);
    if (occupant && occupant._id !== player._id) {
      nextPhase = GameState.RESPAWN_PHASE.CHOOSE_POSITION;
    } else {
      await GameLogic.respawnPlayerAtPosAsync(player, x, y);
      nextPhase = GameState.RESPAWN_PHASE.CHOOSE_DIRECTION;
    }
    // `selectOptions: null` until prepareChooseRespawn* writes this robot's options;
    // the client guards for it, and it is how a sweep knows no human is being waited on.
    const claimed = await game.advanceAsync({
      $set: {
        respawnPhase: nextPhase,
        respawnPlayerId: player._id,
        waitingForRespawn: game.waitingForRespawn,
        selectOptions: null,
        respawnUserId: null,
      },
    });
    if (!claimed) return;
    await game.nextRespawnPhaseAsync();
  } else {
    const claimed = await game.advanceAsync({
      $set: {
        gamePhase: GameState.PHASE.DEAL,
        respawnUserId: null,
        respawnPlayerId: null,
        selectOptions: null,
      },
    });
    if (!claimed) return;
    await game.nextGamePhaseAsync();
  }
}

// play phases:

async function nextPlayPhaseAsync(gameId) {
  const game = await Games.findOneAsync(gameId);
  await new Promise((resolve) => Meteor.setTimeout(resolve, _NEXT_PHASE_DELAY));
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
}

async function announceAsync(game, fn) {
  await new Promise((resolve) => Meteor.setTimeout(resolve, _ANNOUNCE_NEXT_PHASE));
  await fn(game);
}

async function playRevealCards(game) {
  if (!(await game.advanceAsync({ $set: { playPhase: GameState.PLAY_PHASE.MOVE_BOTS } }))) return;

  const players = await game.livingPlayersAsync();
  for (const player of players) {
    if (player.isActive()) {
      const cards = player.cards;
      const cardIndex = player.playedCardsCnt;
      const chosenCards = await player.getChosenCardsAsync();
      console.log('reveal', cardIndex, chosenCards[cardIndex]);
      cards[cardIndex] = chosenCards[cardIndex];
      await Players.updateAsync(player._id, { $set: { cards: cards } });
    }
  }
  await GameState.nextPlayPhaseAsync(game._id);
}

async function playMoveBots(game) {
  const players = await game.activePlayersAsync();
  // play 1 card per player
  game.cardsToPlay = [];

  for (const player of players) {
    const chosenCards = await player.getChosenCardsAsync();
    const card = {
      cardId: chosenCards[player.playedCardsCnt],
    };
    await Players.updateAsync(player._id, { $inc: { playedCardsCnt: 1 } });
    if (card.cardId >= 0) {
      card.playerId = player._id;
      game.cardsToPlay.push(card);
    }
  }
  // cardId has same order as card priority
  game.cardsToPlay.sort((a, b) => b.cardId - a.cardId);
  if (!(await game.advanceAsync({ $set: { cardsToPlay: game.cardsToPlay } }))) return;
  if (game.cardsToPlay.length > 0) {
    await playMoveBot(game);
  } else {
    await game.nextPlayPhaseAsync(GameState.PLAY_PHASE.MOVE_BOARD);
  }
}

async function playMoveBot(game) {
  const card = game.cardsToPlay.shift();
  const player = await Players.findOneAsync(card.playerId);
  // Skip the announce + execute for dead players: their card is dequeued
  // but their robot is off-board, so flashing their card on the bottom-right
  // teleport position would just be visual noise.
  const skip = !player || player.needsRespawn;
  if (skip) {
    if (!(await game.advanceAsync({ $set: { cardsToPlay: game.cardsToPlay } }))) return;
  } else {
    const announced = await game.advanceAsync({
      $set: {
        announceCard: card,
        cardsToPlay: game.cardsToPlay,
      },
    });
    if (!announced) return;
    await new Promise((resolve) => Meteor.setTimeout(resolve, _ANNOUNCE_CARD_TIME));
    if (!(await game.advanceAsync({ $set: { announceCard: null } }))) return;
    await GameLogic.playCard(player, card.cardId);
  }
  if (game.cardsToPlay.length > 0) {
    if (!skip) {
      await new Promise((resolve) => Meteor.setTimeout(resolve, _EXECUTE_CARD_TIME));
    }
    await playMoveBot(game);
  } else {
    await new Promise((resolve) => Meteor.setTimeout(resolve, _EXECUTE_CARD_TIME));
    if (!(await game.advanceAsync({ $set: { announceCard: null } }))) return;
    await game.nextPlayPhaseAsync(GameState.PLAY_PHASE.MOVE_BOARD);
  }
}

async function playMoveBoard(game) {
  const players = await game.playersOnBoardAsync();
  await GameLogic.executeRollers(players);
  await GameLogic.executeExpressRollers(players);
  await GameLogic.executeGears(players);
  await GameLogic.executePushers(players);

  await game.nextPlayPhaseAsync(GameState.PLAY_PHASE.LASERS);
}

async function playLasers(game) {
  const players = await game.playersOnBoardAsync();
  if (!(await game.setPlayPhaseAsync(GameState.PLAY_PHASE.CHECKPOINTS))) return;
  await GameLogic.executeLasers(players);
  await game.nextPlayPhaseAsync();
}

async function playCheckpoints(game) {
  if (!(await checkIfWeHaveAWinner(game))) {
    if (game.playPhaseCount < 5) {
      const claimed = await game.advanceAsync({
        $set: { playPhase: GameState.PLAY_PHASE.REVEAL_CARDS },
        $inc: { playPhaseCount: 1 },
      });
      if (!claimed) return;
      await game.nextPlayPhaseAsync();
    } else {
      await game.nextPlayPhaseAsync(GameState.PLAY_PHASE.REPAIRS);
    }
  }
}

async function playRepairs(game) {
  const players = await game.playersOnBoardAsync();
  await GameLogic.executeRepairs(players);
  await game.nextGamePhaseAsync();
}

async function checkCheckpoints(player) {
  const tile = await player.tileAsync();

  if (tile.checkpoint || tile.repair) {
    player.updateStartPosition();
    if (tile.checkpoint && tile.checkpoint === player.visited_checkpoints + 1) {
      player.visited_checkpoints++;
    }
    await player.saveAsync();
  }
}

// Resolves to true when the caller must not go on: the game ended here, or a lost claim
// showed another driver owns it. A lost claim announces nothing — the winner does.
async function checkIfWeHaveAWinner(game) {
  const players = await Players.find({ gameId: game._id }).fetchAsync();
  const board = game.board();
  let ended = false;
  let lastManStanding = false;
  let livingPlayers = 0;
  const messages = [];

  for (const i in players) {
    const player = players[i];
    await checkCheckpoints(player);
    if (player.lives > 0) {
      livingPlayers++;
      lastManStanding = player;
    } else {
      messages.push(`Player ${player.name} ran out of lives`);
      console.log(`Player ran out of lives: ${player.name}`);
    }

    if (player.visited_checkpoints === board.checkpoints.length) {
      const claimed = await game.advanceAsync({
        $set: {
          gamePhase: GameState.PHASE.ENDED,
          winner: player.name,
          // The aggregation key. `winner` is a display name and display names are not
          // unique; server/highscores.js counts wins per account, so it needs this.
          winnerUserId: player.userId,
          stopped: new Date().getTime(),
        },
      });
      if (!claimed) return true;
      messages.push(`Player ${player.name} won the game!!`);
      console.log(`Player won: ${player.name}`);
      await buildHighscores();
      console.log('after build highscores');
      ended = true;
      break;
    }
  }

  if (livingPlayers === 0) {
    messages.push('All robots are dead');
    const claimed = await game.advanceAsync({
      $set: {
        gamePhase: GameState.PHASE.ENDED,
        winner: 'Nobody',
        stopped: new Date().getTime(),
      },
    });
    if (!claimed) return true;
    ended = true;
  } else if (livingPlayers === 1 && players.length > 1) {
    messages.push(`Player ${lastManStanding.name} won the game!!`);
    console.log(`Last player standing: ${lastManStanding.name}`);
    const claimed = await game.advanceAsync({
      $set: {
        gamePhase: GameState.PHASE.ENDED,
        winner: lastManStanding.name,
        winnerUserId: lastManStanding.userId,
        stopped: new Date().getTime(),
      },
    });
    if (!claimed) return true;
    await buildHighscores();
    ended = true;
  }
  for (const msg of messages) {
    await game.chatAsync(msg);
  }
  return ended;
}

// respawn phases
async function nextRespawnPhaseAsync(gameId) {
  const game = await Games.findOneAsync(gameId);
  await new Promise((resolve) => Meteor.setTimeout(resolve, _NEXT_PHASE_DELAY));
  switch (game.respawnPhase) {
    case GameState.RESPAWN_PHASE.CHOOSE_POSITION:
      await prepareChooseRespawnPosition(game);
      break;
    case GameState.RESPAWN_PHASE.CHOOSE_DIRECTION:
      await prepareChooseRespawnDirection(game);
      break;
  }
}

async function prepareChooseRespawnPosition(game) {
  const player = await Players.findOneAsync(game.respawnPlayerId);
  const selectOptions = [];
  const x = player.start.x;
  const y = player.start.y;
  const board = game.board();
  // House rule: the base game says "adjacent space" (radius 1). If every
  // adjacent square is a pit, off-board, or occupied, expand outward ring
  // by ring until at least one valid square is found, capped at the board's
  // longer dimension so the loop always terminates.
  const maxR = Math.max(board.width, board.height);
  for (let r = 1; r <= maxR && selectOptions.length === 0; ++r) {
    for (let dx = -r; dx <= r; ++dx) {
      for (let dy = -r; dy <= r; ++dy) {
        // For r > 1, only consider the new ring (skip inner squares
        // already evaluated at smaller radii).
        if (r > 1 && Math.max(Math.abs(dx), Math.abs(dy)) < r) continue;
        if (
          board.onBoard(x + dx, y + dy) &&
          !(await game.isPlayerOnTileAsync(x + dx, y + dy)) &&
          board.getTile(x + dx, y + dy).type !== Tile.VOID
        ) {
          selectOptions.push({ x: x + dx, y: y + dy });
        }
      }
    }
  }
  // End of the server's part: the claim's result has nobody left to stop.
  await game.advanceAsync({ $set: { selectOptions, respawnUserId: player.userId } });
}

async function prepareChooseRespawnDirection(game) {
  const player = await Players.findOneAsync(game.respawnPlayerId);
  const selectOptions = [];
  const x = player.position.x;
  const y = player.position.y;
  let step;
  if (player.start.x !== x && player.start.y !== y) {
    for (let i = 0; i < 4; ++i) {
      step = Board.to_step(i);
      if (await noPlayerOnNextThreeAsync(x, y, step.x, step.y, game)) {
        selectOptions.push({ x: x + step.x, y: y + step.y, dir: i });
      }
    }
  } else {
    for (let j = 0; j < 4; ++j) {
      step = Board.to_step(j);
      selectOptions.push({
        x: x + step.x,
        y: y + step.y,
        dir: j,
      });
    }
  }
  await game.advanceAsync({ $set: { selectOptions, respawnUserId: player.userId } });
}

async function noPlayerOnNextThreeAsync(x, y, dx, dy, game) {
  return (
    !(await game.isPlayerOnTileAsync(x + dx, y + dy)) &&
    !(await game.isPlayerOnTileAsync(x + 2 * dx, y + 2 * dy)) &&
    !(await game.isPlayerOnTileAsync(x + 3 * dx, y + 3 * dy))
  );
}

// re-entry

const RESUME_CHAT = 'Server restarted — replaying this turn from the start';

// Pick a game up again after the process that was driving it died — or, from the sweep,
// after it has not moved for long enough to be presumed dead. One rule: the game document
// says where the turn is, its snapshot says where the current segment started, and nothing
// that happened in between is trusted.
async function resumeAsync(gameId) {
  const game = await Games.findOneAsync(gameId);
  if (!game) return;
  const replay = await resumeStepFor(game);
  if (!replay) return;
  // The touch: a claim with nothing to set. It moves `step` and `lastStepAt`, so a second
  // sweeper looking at the same game loses right here and never restores anything, and a
  // driver that turns out to be alive after all loses its next claim instead of fighting
  // the replay. It comes after the decision so that a game nobody needs to touch is not.
  if (!(await game.advanceAsync())) return;
  // Logged here rather than at the sweep's call site so that the line means work has
  // started, not work was considered. The sweep's filter is deliberately coarse — a PROGRAM
  // game passes it whether or not a human still owes cards — so a line at the call site
  // repeats every minute for the rest of such a game's life and says nothing.
  console.log(`Resuming stalled turn for game ${gameId}`);
  await replay();
}

// What re-entry means for the phase the game is in, as a function to run once the touch
// has been won — or null when a human is expected to act (PROGRAM with players still
// programming, RESPAWN with options on the table) or there is nothing to drive.
async function resumeStepFor(game) {
  switch (game.gamePhase) {
    case GameState.PHASE.PLAY:
      if (!hasSnapshotFor(game)) return null;
      return async () => {
        // The game document's own play-start state — constants, because the respawn
        // queue is always empty when play begins and the rest is exactly what
        // playProgramCardsSubmitted writes. Claimed before the collections are restored,
        // so a loss here has changed nothing yet.
        const claimed = await game.advanceAsync({
          $set: {
            playPhase: GameState.PLAY_PHASE.IDLE,
            playPhaseCount: 1,
            cardsToPlay: [],
            announceCard: null,
            waitingForRespawn: [],
          },
        });
        if (!claimed) return;
        await game.restoreSnapshotAsync();
        await game.chatAsync(RESUME_CHAT);
        await GameState.nextPlayPhaseAsync(game._id);
      };
    case GameState.PHASE.DEAL:
      if (!hasSnapshotFor(game)) return null;
      return async () => {
        // The deal handler's own writes cover the game document; only the collections
        // go back. Re-entering through the dispatcher runs the DEAL case as usual.
        await game.restoreSnapshotAsync();
        await GameState.nextGamePhaseAsync(game._id);
      };
    case GameState.PHASE.RESPAWN:
      // Two server-driven pieces, both safe to run again: pick the next robot, then compute
      // its options. Options already written means a human is choosing — leave it alone.
      if (game.respawnPlayerId == null) return () => GameState.nextGamePhaseAsync(game._id);
      if (game.selectOptions == null) return () => GameState.nextRespawnPhaseAsync(game._id);
      return null;
    case GameState.PHASE.PROGRAM: {
      // Everyone submitted and nobody drove on: the process died in the ~250 ms between
      // the last submit and the PLAY write, or the last submitter's claim lost to another
      // player's concurrent submit. No human is expected to act, so kick it.
      const programming = await Players.find({
        gameId: game._id,
        lives: { $gt: 0 },
        submitted: false,
      }).countAsync();
      if (programming > 0) return null;
      return async () => {
        // What the last submitter's claim would have written. Without it a `timer: 0`
        // left behind by a timeout that found nobody left to submit would follow the game
        // into its next program phase — where every client auto-submits on sight of it.
        if (!(await game.advanceAsync({ $set: { timer: -1, timerStartedAt: null } }))) return;
        await GameState.nextGamePhaseAsync(game._id);
      };
    }
    default:
      // IDLE and ENDED: nothing to resume.
      return null;
  }
}

// The claim that enters a segment writes `gamePhase` and the snapshot together, so a
// mismatch cannot come from this code — treat one as a bug and leave the game alone.
function hasSnapshotFor(game) {
  const segment = game.segmentSnapshot?.segment;
  if (segment === game.gamePhase) return true;
  console.error(
    `resumeAsync: game ${game._id} is in ${game.gamePhase} but its snapshot is for ${segment ?? 'nothing'}`
  );
  return false;
}

Object.assign(GameState, {
  nextGamePhaseAsync,
  nextPlayPhaseAsync,
  nextRespawnPhaseAsync,
  resumeAsync,
});
