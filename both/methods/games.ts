import './config.ts';
import { createMethod } from 'meteor/jam:method';
import { BoardBox } from '../board_box.ts';
import { CardLogic, startTimerIfLastOwingAsync } from '../cardlogic.ts';
import { GameLogic } from '../gamelogic.ts';
import { GameState, buildHighscoresAsync } from '../gamestate.ts';
import { getUsername } from '../permissions.ts';
import type { Doc } from '../schemas/infer.ts';
import { checkArgsWith, schemas } from '../schemas/methods.ts';
import { Cards } from '../../collections/cards.ts';
import { Chat } from '../../collections/chat.ts';
import { Decks } from '../../collections/deck.ts';
import { Games } from '../../collections/games.ts';
import { Players } from '../../collections/players.ts';

// The lobby and lifecycle surface: making a game, sitting down at one, leaving it,
// cancelling it, choosing its board, starting it, and the two halves of a respawn.
//
// All eight take the app-wide `serverOnly: true` from ./config.ts — no stub is registered
// and no body runs in the browser. They live under `both/` anyway so the view modules can
// import the functions instead of naming a method by string; the whole gain of jam:method
// is that a typo is a build error rather than a 404 at click time.
//
// That import direction is also why nothing here may reach into `server/`. `leaveGame`
// used to `import { buildHighscores } from '../../server/highscores.ts'`, which Meteor
// excludes from the client bundle — the specifier would have no target. It calls
// `buildHighscoresAsync()` from `both/gamestate.ts` instead, the same injected function
// the phase machine ends a game with.

// The seating half of `joinGame`, lifted out so `createGame` can finish the job itself.
// It used to end with a nested `Meteor.callAsync` of `joinGame`, which still works on the
// server (a nested call inherits `userId`), but a method calling a method is one more
// thing every reader and the test harness has to model. A plain function is not.
//
// `user` is whatever `Meteor.userAsync()` resolved to at the call site, and both callers
// are `open: false` methods, so the package's logged-in check has already run and null is
// unreachable. The assertions below record the TypeError a null user throws today; a guard
// would turn it into a silent no-op.
export async function joinGameAsync(gameId: string, user: Meteor.User | null) {
  const game = await Games.findOneAsync(gameId);
  if (!game) throw new Meteor.Error(404, 'Game id not found!');

  const author = getUsername(user!);
  let playerId;
  if (!(await Players.findOneAsync({ gameId, userId: user!._id }))) {
    // A seat taken after the start has no start point and no robotId, and the deck was
    // already sized for the seats the game started with — see `deckSize` in
    // collections/games.ts.
    if (game.started) throw new Meteor.Error(403, 'Game already started.');
    if ((await Players.find({ gameId }).countAsync()) >= game.max_player) {
      throw new Meteor.Error(403, 'Game is full.');
    }
    // The dev-test board is meant for exercising elimination flows quickly,
    // so seat players with a single life instead of the standard three.
    const startingLives = game.boardName === 'dev_test' ? 1 : 3;
    playerId = await Players.insertAsync({
      gameId,
      userId: user!._id,
      name: author,
      lives: startingLives,
      damage: 0,
      visited_checkpoints: 0,
      needsRespawn: false,
      powerState: GameLogic.ON,
      optionalInstantPowerDown: false,
      position: { x: -1, y: -1 },
      chosenCardsCnt: 0,
      optionCards: {},
      cards: Array.from({ length: GameLogic.CARD_SLOTS }, () => CardLogic.EMPTY),
      // Seeded, not left absent: a player is written back as a whole document a dozen
      // times a turn, and the schema requires the key. See collections/players.ts.
      ablativeCoat: null,
    });
    await Cards.insertAsync({
      gameId,
      playerId,
      userId: user!._id,
      chosenCards: Array.from({ length: GameLogic.CARD_SLOTS }, () => CardLogic.EMPTY),
      handCards: [],
    });
  }
  await game.chatAsync(`${author} joined the game`, gameId);
  return true;
}

export const createGame = createMethod({
  name: 'createGame',
  // A deliberate click, so a low ceiling costs a real player nothing.
  rateLimit: { limit: 3, interval: 10000 },
  validate: checkArgsWith(schemas.createGame),
  async run(postAttributes: Doc<typeof schemas.createGame>) {
    // `open: false` from ./config.ts, so the package's logged-in check has already run and
    // this cannot resolve to null — the `!` records the TypeError a missing user throws.
    const user = (await Meteor.userAsync())!;

    // The schema says `String`, which accepts the empty one; v1 of the schemas uses plain
    // types only, so the name's own rule stays here.
    if (!postAttributes.name || postAttributes.name === '') {
      throw new Meteor.Error(400, 'Name cannot be empty.');
    }
    const author = getUsername(user);

    // Every game opens on `default`; the owner picks another board from board select. The
    // name used to double as a board lookup, which was the only way onto a dev board.
    const board = BoardBox.getBoard('default');
    const game = {
      name: postAttributes.name,
      userId: user._id,
      author,
      submitted: new Date().getTime(),
      started: false,
      gamePhase: GameState.PHASE.IDLE,
      playPhase: GameState.PLAY_PHASE.IDLE,
      respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION,
      playPhaseCount: 0,
      programRound: 0,
      boardName: board.name,
      min_player: board.min_player,
      max_player: board.max_player,
      waitingForRespawn: [],
      announce: false,
      cardsToPlay: [],
      // The compare-and-set counter every turn-chain write claims through, and when the
      // last claim landed. See `advanceAsync` in collections/games.ts.
      step: 0,
      lastStepAt: null,
      // The turn writes these five as null long before it writes a value, so they are
      // required keys that may be null rather than keys that may also be missing.
      timerStartedAt: null,
      respawnPlayerId: null,
      respawnUserId: null,
      selectOptions: null,
      announceCard: null,
    };
    const gameId = await Games.insertAsync(game);

    await Chat.insertAsync({
      gameId,
      message: 'Game created',
      submitted: new Date().getTime(),
    });
    await joinGameAsync(gameId, user);

    return gameId;
  },
});

export const joinGame = createMethod({
  name: 'joinGame',
  // A deliberate click too, one step looser than createGame.
  rateLimit: { limit: 5, interval: 10000 },
  validate: checkArgsWith(schemas.joinGame),
  async run({ gameId }: Doc<typeof schemas.joinGame>) {
    return await joinGameAsync(gameId, await Meteor.userAsync());
  },
});

export const leaveGame = createMethod({
  name: 'leaveGame',
  validate: checkArgsWith(schemas.leaveGame),
  async run({ gameId }: Doc<typeof schemas.leaveGame>) {
    // Logged in, as in createGame above.
    const user = (await Meteor.userAsync())!;
    const game = await Games.findOneAsync(gameId);
    if (!game) throw new Meteor.Error(404, 'Game id not found!');

    if (
      game.started &&
      game.gamePhase !== GameState.PHASE.ENDED &&
      game.gamePhase !== GameState.PHASE.PROGRAM
    ) {
      const stillPlaying = await Players.findOneAsync({ gameId: game._id, userId: user._id });
      if (stillPlaying) {
        throw new Meteor.Error(403, 'You can only leave during the program phase');
      }
    }

    const author = getUsername(user);
    console.log(`User ${author} leaving game ${gameId}`);

    // Return any held cards to the deck before removing
    if (game.started) {
      const playerCards = await Cards.findOneAsync({ gameId: game._id, userId: user._id });
      if (playerCards) {
        const deck = await Decks.findOneAsync({ gameId: game._id });
        if (deck) {
          for (const c of playerCards.handCards) {
            if (c >= 0) deck.cards.push(c);
          }
          for (const c of playerCards.chosenCards) {
            if (c >= 0) deck.cards.push(c);
          }
          await deck.saveAsync();
        }
      }
      // Held option cards go to the discard pile the same way, announced per card.
      // Each discard re-reads the deck doc, so this must stay after the whole-doc
      // deck update above or that write would clobber the discards.
      const leavingPlayer = await Players.findOneAsync({ gameId: game._id, userId: user._id });
      if (leavingPlayer) {
        for (const name of Object.keys(leavingPlayer.optionCards ?? {})) {
          await leavingPlayer.discardOptionCardAsync(name);
        }
      }
    }
    await Cards.removeAsync({ gameId: game._id, userId: user._id });
    await Players.removeAsync({ gameId: game._id, userId: user._id });
    if (game.started) {
      const players = await Players.find({ gameId: game._id }).fetchAsync();
      if (players.length === 1) {
        await Games.updateAsync(game._id, {
          $set: {
            gamePhase: GameState.PHASE.ENDED,
            winner: players[0].name,
            winnerUserId: players[0].userId,
            stopped: new Date().getTime(),
          },
        });
        await buildHighscoresAsync();
      } else if (players.length === 0) {
        console.log('Nobody left in the game.');
        await Games.updateAsync(game._id, {
          $set: {
            gamePhase: GameState.PHASE.ENDED,
            winner: 'Nobody',
            stopped: new Date().getTime(),
          },
        });
      } else if (game.gamePhase === GameState.PHASE.PROGRAM) {
        // The leaver was one of the players the others were waiting on, so the same call
        // their submit would have made has to be made here — nothing else will make it.
        // Re-read for a current `step`: the claims below are conditional on it.
        const live = (await Games.findOneAsync(game._id))!;
        if ((await startTimerIfLastOwingAsync(live)) === 0) {
          // Nobody left to hear from. Drive the turn on exactly as the last submit would,
          // but without awaiting it: the rest of the turn is half a minute of animation
          // and this method answers the browser of the player walking out.
          if (await live.advanceAsync({ $set: { timer: -1, timerStartedAt: null } })) {
            void GameState.nextGamePhaseAsync(game._id).catch((err) =>
              console.error(`could not drive game ${game._id} on after a leave`, err)
            );
          }
        }
      }
    }
    await game.chatAsync(`${author} left the game`);
  },
});

// The owner's counterpart to leaveGame: the whole game goes, rows and all. It replaces a
// client-side `Games.remove(id)` that landed through the app's only `allow` rule and took
// the game document alone, leaving its players, cards, deck and chat behind as orphans.
// That rule is gone with it, so nothing writes to a collection from the browser now.
export const cancelGame = createMethod({
  name: 'cancelGame',
  validate: checkArgsWith(schemas.cancelGame),
  async run({ gameId }: Doc<typeof schemas.cancelGame>) {
    // Logged in, as in createGame above.
    const user = (await Meteor.userAsync())!;
    const game = await Games.findOneAsync(gameId);
    if (!game) throw new Meteor.Error(404, 'Game id not found!');

    if (game.userId !== user._id) {
      throw new Meteor.Error(403, 'Only the owner can cancel this game');
    }
    // Narrower than the allow rule was, and unreachable from the UI: the lobby and
    // board-select pages both send a started game to its board before they render, so the
    // Cancel button is only ever on screen for one that has not started. `leaveGame` is
    // the way out of a started game.
    if (game.started) {
      throw new Meteor.Error(409, 'A started game cannot be cancelled');
    }

    console.log(`User ${getUsername(user)} cancelling game ${gameId}`);
    await game.removeWithChildrenAsync();
  },
});

export const selectBoard = createMethod({
  name: 'selectBoard',
  validate: checkArgsWith(schemas.selectBoard),
  async run({ boardName, gameId }: Doc<typeof schemas.selectBoard>) {
    // Logged in, as in createGame above.
    const user = (await Meteor.userAsync())!;
    const game = await Games.findOneAsync(gameId);
    if (!game) throw new Meteor.Error(404, 'Game id not found!');

    if (game.userId !== user._id) {
      throw new Meteor.Error(403, 'Only the owner can change the board.');
    }
    if (game.started) throw new Meteor.Error(409, 'Game already started.');

    // Unknown, hidden and (outside development) dev boards all read the same to a client.
    if (!BoardBox.isSelectable(boardName)) {
      throw new Meteor.Error(404, `Board ${boardName} not found!`);
    }

    const { min_player: min, max_player: max } = BoardBox.getBoard(boardName);
    // A maximum only: a game under the minimum is just a lobby still filling up. Both
    // numbers are in the message because the owner's fix is to get people to leave.
    const seated = await Players.find({ gameId }).countAsync();
    if (seated > max) {
      throw new Meteor.Error(403, `${seated} players are seated; that board seats ${max}.`);
    }
    await Games.updateAsync(game._id, {
      $set: { boardName, min_player: min, max_player: max },
    });

    const author = getUsername(user);
    await game.chatAsync(`${author} selected board ${boardName}`, `for game${gameId}`);
  },
});

export const startGame = createMethod({
  name: 'startGame',
  validate: checkArgsWith(schemas.startGame),
  async run({ gameId }: Doc<typeof schemas.startGame>) {
    const game = await Games.findOneAsync(gameId);
    if (!game) throw new Meteor.Error(404, 'Game id not found!');
    // A board the catalog lost: the lobby shows the pit, and the owner picks another.
    if (!BoardBox.hasBoard(game.boardName)) {
      throw new Meteor.Error(409, 'Board not available');
    }

    const players = await Players.find({ gameId }).fetchAsync();
    if (players.length < Math.max(1, game.min_player)) {
      throw new Meteor.Error(403, 'Not enough players.');
    }
    if (players.length > game.max_player) {
      throw new Meteor.Error(403, 'Too many players.');
    }
    // The board's own limit is above; this is the deck's, and it holds whatever a board
    // declares — no deck covers more than 12 players.
    if (players.length > CardLogic.MAX_PLAYERS) {
      throw new Meteor.Error(403, 'Too many players for a deck.');
    }

    // NOTE: `for...in` on purpose — `i` is a string index, and robotId is persisted as
    // that string. Switching to a numeric index would mix types across existing docs.
    for (const i in players) {
      const start = game.board().startpoints[i];
      const player = players[i];
      player.position.x = start.x;
      player.position.y = start.y;
      player.direction = start.direction;
      player.robotId = i;
      player.start = start;
      await player.saveAsync();
    }
    await game.chatAsync('Game started');
    await GameState.nextGamePhaseAsync(gameId);
  },
});

export const selectRespawnPosition = createMethod({
  name: 'selectRespawnPosition',
  validate: checkArgsWith(schemas.selectRespawnPosition),
  async run({ gameId, x, y }: Doc<typeof schemas.selectRespawnPosition>) {
    const game = await Games.findOneAsync(gameId);
    // Logged in, as in createGame above, so there is a user id to query on.
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId()! });
    if (!game || !player) throw new Meteor.Error(404, `Game/Player not found! ${gameId}`);

    await GameLogic.respawnPlayerAtPosAsync(player, x, y);
    await player.chatAsync('chose position', `(${x},${y})`);
    await game.nextRespawnPhaseAsync(GameState.RESPAWN_PHASE.CHOOSE_DIRECTION);
  },
});

export const selectRespawnDirection = createMethod({
  name: 'selectRespawnDirection',
  validate: checkArgsWith(schemas.selectRespawnDirection),
  async run({ gameId, direction }: Doc<typeof schemas.selectRespawnDirection>) {
    const game = await Games.findOneAsync(gameId);
    // Logged in, as in createGame above, so there is a user id to query on.
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId()! });
    if (!game || !player) throw new Meteor.Error(404, `Game/Player not found! ${gameId}`);

    await GameLogic.respawnPlayerWithDirAsync(player, direction);
    await player.chatAsync('reentered the race', direction);
    await GameState.nextGamePhaseAsync(game._id);
  },
});
