import { BoardBox } from '../both/board_box.js';
import { CardLogic } from '../both/cardlogic.js';
import { GameLogic } from '../both/gamelogic.js';
import { GameState } from '../both/gamestate.js';
import { getUsername } from '../both/permissions.js';
import { checkArgs, schemas } from '../both/schemas/methods.js';
import { Cards } from '../collections/cards.js';
import { Chat } from '../collections/chat.js';
import { Deck } from '../collections/deck.js';
import { Games } from '../collections/games.js';
import { Players } from '../collections/players.js';
import { buildHighscores } from './highscores.js';

Meteor.methods({
  async createGame(postAttributes) {
    checkArgs(postAttributes, schemas.createGame);
    const user = await Meteor.userAsync();

    // ensure the user is logged in
    if (!user) throw new Meteor.Error(401, 'You need to login to create a game');
    // The schema says `String`, which accepts the empty one; v1 of the schemas uses plain
    // types only, so the name's own rule stays here.
    if (!postAttributes.name || postAttributes.name === '') {
      throw new Meteor.Error(400, 'Name cannot be empty.');
    }
    const author = getUsername(user);

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
      boardId: 0,
      waitingForRespawn: [],
      announce: false,
      cardsToPlay: [],
      // The compare-and-set counter every turn-chain write claims through, and when the
      // last claim landed. See `advanceAsync` in collections/games.js.
      step: 0,
      lastStepAt: null,
    };
    const board_id = BoardBox.getBoardId(game.name);
    if (board_id >= 0) game.boardId = board_id;

    game.min_player = BoardBox.getBoard(board_id).min_player;
    game.max_player = BoardBox.getBoard(board_id).max_player;
    const gameId = await Games.insertAsync(game);

    await Chat.insertAsync({
      gameId,
      message: 'Game created',
      submitted: new Date().getTime(),
    });
    await Meteor.callAsync('joinGame', gameId);

    return gameId;
  },

  async joinGame(gameId) {
    checkArgs({ gameId }, schemas.joinGame);
    const user = await Meteor.userAsync();

    if (!user) throw new Meteor.Error(401, 'You need to login to join a game');
    const game = await Games.findOneAsync(gameId);
    if (!game) throw new Meteor.Error(404, 'Game id not found!');

    const author = getUsername(user);
    let playerId;
    if (!(await Players.findOneAsync({ gameId, userId: user._id }))) {
      // The dev-test board is meant for exercising elimination flows quickly,
      // so seat players with a single life instead of the standard three.
      const startingLives = game.boardId === BoardBox.dev_test_board_id ? 1 : 3;
      playerId = await Players.insertAsync({
        gameId,
        userId: user._id,
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
      });
      await Cards.insertAsync({
        gameId,
        playerId,
        userId: user._id,
        chosenCards: Array.from({ length: GameLogic.CARD_SLOTS }, () => CardLogic.EMPTY),
        handCards: [],
      });
    }
    await game.chatAsync(`${author} joined the game`, gameId);
    return true;
  },

  async leaveGame(gameId) {
    checkArgs({ gameId }, schemas.leaveGame);
    const user = await Meteor.userAsync();
    if (!user) throw new Meteor.Error(401, 'You need to login to leave a game');
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
        const deck = await Deck.findOneAsync({ gameId: game._id });
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
        await buildHighscores();
      } else if (players.length === 0) {
        console.log('Nobody left in the game.');
        await Games.updateAsync(game._id, {
          $set: {
            gamePhase: GameState.PHASE.ENDED,
            winner: 'Nobody',
            stopped: new Date().getTime(),
          },
        });
      }
    }
    await game.chatAsync(`${author} left the game`);
  },

  async selectBoard(boardName, gameId) {
    checkArgs({ boardName, gameId }, schemas.selectBoard);
    const user = await Meteor.userAsync();
    if (!user) throw new Meteor.Error(401, 'You need to login to select a board');
    const game = await Games.findOneAsync(gameId);
    if (!game) throw new Meteor.Error(404, 'Game id not found!');

    const board_id = BoardBox.getBoardId(boardName);
    if (board_id < 0) throw new Meteor.Error(404, `Board ${boardName} not found!`);

    const min = BoardBox.getBoard(board_id).min_player;
    const max = BoardBox.getBoard(board_id).max_player;
    await Games.updateAsync(game._id, {
      $set: { boardId: board_id, min_player: min, max_player: max },
    });

    const author = getUsername(user);
    await game.chatAsync(`${author} selected board ${boardName}`, `for game${gameId}`);
  },

  async startGame(gameId) {
    checkArgs({ gameId }, schemas.startGame);
    if (!Meteor.userId()) throw new Meteor.Error(401, 'You need to login to start a game');
    const game = await Games.findOneAsync(gameId);
    if (!game) throw new Meteor.Error(404, 'Game id not found!');

    const players = await Players.find({ gameId }).fetchAsync();
    if (players.length > game.max_player) {
      throw new Meteor.Error(403, 'Too many players.');
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

  async playCards(gameId, programRound) {
    checkArgs({ gameId, programRound }, schemas.playCards);
    const game = await Games.findOneAsync(gameId);
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId() });
    if (!game || !player) throw new Meteor.Error(404, `Game/Player not found! ${gameId}`);

    // A submit can arrive a whole turn late: the final submitter's call spans the
    // entire turn (submitCardsAsync awaits the phase machine), so a duplicate queued
    // behind it on the same connection — or a Meteor retry after a reconnect —
    // executes against the NEXT program phase, where `submitted` has been reset and
    // the check below passes again. The round number pins a submission to the turn
    // the client actually saw.
    if (programRound !== game.programRound) {
      throw new Meteor.Error(409, 'This submission was for a previous turn.');
    }

    if (player.submitted) {
      console.warn('Player already submitted his cards.');
      return;
    }

    // Filling empty slots with random cards is the timeout penalty, not a player
    // choice: outside the expired-timer window an incomplete program can only be a
    // stale or hand-crafted call, so refuse it rather than submit five random cards.
    if (
      !player.isPoweredDown() &&
      (player.chosenCardsCnt ?? 0) < GameLogic.CARD_SLOTS &&
      game.timer !== 0
    ) {
      throw new Meteor.Error(403, 'Not all program slots are filled.');
    }

    await player.chatAsync('submitted cards');
    await CardLogic.submitCardsAsync(player);
  },

  async selectRespawnPosition(gameId, x, y) {
    checkArgs({ gameId, x, y }, schemas.selectRespawnPosition);
    if (!Meteor.userId()) throw new Meteor.Error(401, 'You need to login to respawn');
    const game = await Games.findOneAsync(gameId);
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId() });
    if (!game || !player) throw new Meteor.Error(404, `Game/Player not found! ${gameId}`);

    await GameLogic.respawnPlayerAtPosAsync(player, x, y);
    await player.chatAsync('chose position', `(${x},${y})`);
    await game.nextRespawnPhaseAsync(GameState.RESPAWN_PHASE.CHOOSE_DIRECTION);
  },

  async selectRespawnDirection(gameId, direction) {
    checkArgs({ gameId, direction }, schemas.selectRespawnDirection);
    if (!Meteor.userId()) throw new Meteor.Error(401, 'You need to login to respawn');
    const game = await Games.findOneAsync(gameId);
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId() });
    if (!game || !player) throw new Meteor.Error(404, `Game/Player not found! ${gameId}`);

    await GameLogic.respawnPlayerWithDirAsync(player, direction);
    await player.chatAsync('reentered the race', direction);
    await GameState.nextGamePhaseAsync(game._id);
  },

  async togglePowerDown(gameId) {
    checkArgs({ gameId }, schemas.togglePowerDown);
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId() });
    if (!player) throw new Meteor.Error(404, `Player not found! ${gameId}`);

    return await player.togglePowerDownAsync();
  },

  async addMessage(postAttributes) {
    checkArgs(postAttributes, schemas.addMessage);
    const user = await Meteor.userAsync();

    // ensure the user is logged in
    if (!user) throw new Meteor.Error(401, 'You need to login to post messages');

    const author = getUsername(user);
    const message = {
      message: postAttributes.message,
      gameId: postAttributes.gameId,
      userId: user._id,
      author,
      submitted: new Date().getTime(),
    };
    await Chat.insertAsync(message);
  },

  isEmailAvailable() {
    return !!process.env.EMAIL_URL || Meteor.isDevelopment;
  },

  async resendVerificationEmail(email) {
    checkArgs({ email }, schemas.resendVerificationEmail);
    const user = await Meteor.users.findOneAsync({ 'emails.address': email });
    if (!user) {
      throw new Meteor.Error('user-not-found', 'No account found with that email address.');
    }
    if (user.emails.some((e) => e.verified)) {
      throw new Meteor.Error('already-verified', 'Email is already verified.');
    }
    Accounts.sendVerificationEmail(user._id);
  },
});
