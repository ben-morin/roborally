// @vitest-environment jsdom
// The board helpers turn game state into inline styles and CSS classes. jsdom does no
// layout, so `#board` gets an explicit offsetWidth — that is the one input the whole
// geometry chain (getTileSize -> calcPosition -> cssPosition) hangs off.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../client/views/board/board.js';
import { callHelper, flushTracker, resetClientState, templateLifecycle } from '../clientSetup.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { resetRouter, setRoute } from '../stubs/flow-router.js';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import { GameLogic } from '../../both/gamelogic.ts';
import { GameState } from '../../both/gamestate.ts';
import { Games } from '../../collections/games.ts';
import { Players } from '../../collections/players.ts';

const TURN_RIGHT = 6;

// board.js keeps a module-level Map of last-known robot positions, cleared only when the
// template is destroyed. Replaying that teardown between tests keeps animation state from
// leaking across them.
function destroyBoardTemplate() {
  for (const fn of templateLifecycle('board').onDestroyed) fn.call({});
}

// jsdom reports offsetWidth as 0 for everything, so set it explicitly: tile size is
// floor(offsetWidth / board.width), and the default board is 12 wide -> 600/12 = 50.
function mountBoardElement(offsetWidth = 600) {
  const el = document.createElement('div');
  el.id = 'board';
  Object.defineProperty(el, 'offsetWidth', { value: offsetWidth, configurable: true });
  document.body.appendChild(el);
  return el;
}

async function openBoard({ game: gameOverrides = {}, player: playerOverrides = {} } = {}) {
  const user = await loginAs('me');
  const game = await insertGame(gameOverrides);
  const player = await insertPlayer(game._id, {
    userId: user._id,
    name: 'me',
    robotId: '0',
    start: { x: 1, y: 2 },
    ...playerOverrides,
  });
  setRoute({ params: { _id: game._id }, name: 'board.page' });
  return { user, game, player };
}

beforeEach(() => {
  resetFakeCollections();
  resetClientState();
  resetRouter();
  destroyBoardTemplate();
  document.body.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());

describe('tile geometry', () => {
  it('falls back to a 50px tile when the board element is not on the page yet', async () => {
    const { game } = await openBoard();
    const board = game.board();

    expect(callHelper('board', 'boardWidth')).toBe(board.width * 50);
    expect(callHelper('board', 'boardHeight')).toBe(board.height * 50);
  });

  it('divides the rendered width across the board columns', async () => {
    const { game } = await openBoard();
    const board = game.board();
    mountBoardElement(board.width * 32);

    expect(callHelper('board', 'boardWidth')).toBe(board.width * 32);
    expect(callHelper('board', 'boardHeight')).toBe(board.height * 32);
  });

  it('reports zero size when the route points at no game', () => {
    expect(callHelper('board', 'boardWidth')).toBe(0);
    expect(callHelper('board', 'boardHeight')).toBe(0);
  });
});

describe('robots', () => {
  it('positions each robot and names the caller "You"', async () => {
    const { game } = await openBoard({ player: { position: { x: 3, y: 4 } } });
    await insertPlayer(game._id, {
      userId: 'them',
      name: 'them',
      robotId: '1',
      position: { x: 0, y: 0 },
    });

    const robots = callHelper('board', 'robots');

    expect(robots).toHaveLength(2);
    expect(robots[0]).toMatchObject({
      path: '/robots/robot_0.png',
      robot_class: 'r0',
      name: 'You',
      poweredDown: false,
    });
    // 50px default tile: (3,4) -> left 150, top 200.
    expect(robots[0].position).toBe('left: 150px; top: 200px;');
    expect(robots[1].name).toBe('them');
  });

  it('marks an eliminated robot', async () => {
    await openBoard({ player: { lives: 0 } });

    expect(callHelper('board', 'robots')[0].robot_class).toBe('r0 eliminated');
  });

  it('flags a powered-down robot', async () => {
    await openBoard({ player: { powerState: GameLogic.OFF } });

    expect(callHelper('board', 'robots')[0].poweredDown).toBe(true);
  });

  it('returns a rotation style while the robot element is absent', async () => {
    await openBoard({ player: { direction: GameLogic.LEFT } });

    expect(callHelper('board', 'robots')[0].direction).toBe('transform: rotate(270deg)');
  });

  it('writes the rotation straight onto the element once it exists', async () => {
    await openBoard({ player: { direction: GameLogic.RIGHT } });
    const robotEl = document.createElement('div');
    robotEl.className = 'r0';
    document.body.appendChild(robotEl);

    // With a live element the helper mutates it and returns no inline style, so the
    // rotation is not re-applied by the re-render.
    expect(callHelper('board', 'robots')[0].direction).toBe('');
    expect(robotEl.style.transform).toBe('rotate(90deg)');
  });

  it('queues a glide animation only once the robot actually moves', async () => {
    const { player } = await openBoard({ player: { position: { x: 0, y: 0 } } });

    callHelper('board', 'robots');
    expect(flushTracker()).toBe(0); // first render just places the robot

    await Players.updateAsync(player._id, { $set: { position: { x: 2, y: 0 } } });
    callHelper('board', 'robots');
    expect(flushTracker()).toBe(1);
  });
});

describe('respawn markers', () => {
  it('places a marker on each living robot’s archive position', async () => {
    await openBoard({ player: { start: { x: 1, y: 2 } } });

    const [marker] = callHelper('board', 'markers');

    expect(marker).toMatchObject({
      path: '/robots/marker_0.png',
      marker_class: 'm0',
      name: 'respawn location ( You )',
    });
    expect(marker.position).toBe('top: 100px; left:50px;');
  });

  it('drops the marker for an eliminated robot', async () => {
    await openBoard({ player: { lives: 0 } });

    expect(callHelper('board', 'markers')).toEqual([]);
  });
});

describe('lasers', () => {
  it('draws no shots outside the checkpoints phase', async () => {
    await openBoard({ game: { playPhase: GameState.PLAY_PHASE.LASERS } });

    expect(callHelper('board', 'shots')).toEqual([]);
  });

  it('draws a shot per firing robot during the checkpoints phase', async () => {
    await openBoard({
      game: { playPhase: GameState.PLAY_PHASE.CHECKPOINTS },
      player: { direction: GameLogic.UP, position: { x: 1, y: 1 }, shotDistance: 3 },
    });

    const shots = callHelper('board', 'shots');

    expect(shots).toHaveLength(1);
    expect(shots[0].laser_class).toBe('l0');
    // Vertical beam: width is the laser thickness, height animates from 0.
    expect(shots[0].shot).toContain('width: 3px');
    expect(shots[0].shot).toContain('height: 0px');
  });

  it('skips powered-down and destroyed robots', async () => {
    const { game } = await openBoard({
      game: { playPhase: GameState.PLAY_PHASE.CHECKPOINTS },
      player: { powerState: GameLogic.OFF, shotDistance: 2 },
    });
    await insertPlayer(game._id, {
      userId: 'x',
      robotId: '1',
      needsRespawn: true,
      shotDistance: 2,
    });

    expect(callHelper('board', 'shots')).toEqual([]);
  });

  it('survives its deferred animation work when the beam element never rendered', async () => {
    await openBoard({
      game: { playPhase: GameState.PLAY_PHASE.CHECKPOINTS },
      player: { direction: GameLogic.RIGHT, shotDistance: 1 },
    });

    callHelper('board', 'shots');

    expect(() => flushTracker()).not.toThrow();
  });
});

describe('phase indicators', () => {
  it('marks finished, active and pending registers', async () => {
    await openBoard({ game: { playPhaseCount: 3 } });

    const phases = callHelper('board', 'registerPhases');

    expect(phases.map((p) => p.phaseClass)).toEqual([
      'finished',
      'finished',
      'active',
      false,
      false,
    ]);
    expect(phases.map((p) => p.status)).toEqual([
      'fa-check-circle',
      'fa-check-circle',
      'fa-arrow-circle-right',
      'fa-circle',
      'fa-circle',
    ]);
    expect(phases[0].phaseName).toBe('register 1');
  });

  it('splits the indicator strip evenly across the board width', async () => {
    const { game } = await openBoard();
    const expected = (game.board().width * 50) / 5;

    expect(callHelper('board', 'registerPhases').every((p) => p.width === expected)).toBe(true);
  });

  it('walks the play phases, marking everything before the current one finished', async () => {
    await openBoard({ game: { playPhase: GameState.PLAY_PHASE.LASERS } });

    const phases = callHelper('board', 'playPhases');

    expect(phases.map((p) => p.phaseName)).toEqual([
      'moving bots',
      'moving board',
      'shooting lasers',
      'checkpoints',
    ]);
    expect(phases.map((p) => p.phaseClass)).toEqual(['finished', 'finished', 'active', false]);
  });
});

describe('announced card', () => {
  it('announces only while bots are moving', async () => {
    const { game, player } = await openBoard({
      game: {
        playPhase: GameState.PLAY_PHASE.MOVE_BOTS,
        announceCard: { cardId: TURN_RIGHT, playerId: 'x' },
      },
    });
    expect(callHelper('board', 'announceMove')).toBeTruthy();

    await Games.updateAsync(game._id, { $set: { playPhase: GameState.PLAY_PHASE.LASERS } });
    expect(callHelper('board', 'announceMove')).toBe(false);
    void player;
  });

  it('describes the card being played and centres it over the robot', async () => {
    const { game, player } = await openBoard({ player: { position: { x: 2, y: 3 } } });
    await Games.updateAsync(game._id, {
      $set: { announceCard: { cardId: TURN_RIGHT, playerId: player._id } },
    });

    const card = callHelper('board', 'cardPlaying');

    expect(card).toMatchObject({
      class: 'played announce-move',
      type: 'turn-right',
      playerName: 'me',
      tileSize: '50px',
      robotId: '0',
    });
    // Lifted half a tile so the card sits over the robot rather than on it.
    expect(card.position).toBe('top: 125px; left:100px;');
  });

  it('announces nothing for a robot waiting to respawn', async () => {
    const { game, player } = await openBoard({ player: { needsRespawn: true } });
    await Games.updateAsync(game._id, {
      $set: { announceCard: { cardId: TURN_RIGHT, playerId: player._id } },
    });

    expect(callHelper('board', 'cardPlaying')).toBeUndefined();
  });

  it('announces nothing when no card is in flight', async () => {
    await openBoard();

    expect(callHelper('board', 'cardPlaying')).toBeUndefined();
  });
});

describe('respawn choices', () => {
  it('offers the choices only to the player who is respawning', async () => {
    const { game } = await openBoard({
      game: {
        respawnUserId: 'me',
        respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION,
        selectOptions: [{ x: 1, y: 1 }],
      },
    });

    const [option] = callHelper('board', 'selectOptions');

    expect(option).toMatchObject({
      select_class: 'position-select pointer',
      title: 'choose a starting position',
      gameId: game._id,
    });
    expect(option.position).toBe('top: 50px; left:50px;');
  });

  it('switches to direction choices in the second respawn step', async () => {
    await openBoard({
      game: {
        respawnUserId: 'me',
        respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_DIRECTION,
        selectOptions: [{ x: 1, y: 1, dir: 0 }],
      },
    });

    expect(callHelper('board', 'selectOptions')[0].select_class).toBe('direction-select pointer');
  });

  it('offers nothing to the other players', async () => {
    await openBoard({
      game: {
        respawnUserId: 'someone-else',
        respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION,
        selectOptions: [{ x: 1, y: 1 }],
      },
    });

    expect(callHelper('board', 'selectOptions')).toEqual([]);
  });

  // While the server picks the next robot it clears `selectOptions` to null; the options
  // for that robot arrive in a later write. The helper must not throw in between.
  it('offers nothing while the options for this robot have not been written yet', async () => {
    await openBoard({
      game: {
        respawnUserId: 'me',
        respawnPhase: GameState.RESPAWN_PHASE.CHOOSE_POSITION,
        selectOptions: null,
      },
    });

    expect(callHelper('board', 'selectOptions')).toEqual([]);
  });
});

describe('membership and end state', () => {
  it('knows whether the caller holds a robot on this board', async () => {
    await openBoard();
    expect(callHelper('board', 'inGame')).toBe(true);
    expect(callHelper('board', 'player').name).toBe('me');
    expect(callHelper('board', 'getRobotId')).toBe('0');
  });

  it('reports a spectator as not in the game', async () => {
    const game = await insertGame();
    await insertPlayer(game._id, { userId: 'them', robotId: '0' });
    await loginAs('watcher');
    setRoute({ params: { _id: game._id } });

    expect(callHelper('board', 'inGame')).toBe(false);
    expect(callHelper('board', 'player')).toBeUndefined();
  });

  it('reports the end of the game', async () => {
    const { game } = await openBoard({ game: { gamePhase: GameState.PHASE.ENDED } });
    expect(callHelper('board', 'gameEnded')).toBe(true);

    await Games.updateAsync(game._id, { $set: { gamePhase: GameState.PHASE.PLAY } });
    expect(callHelper('board', 'gameEnded')).toBe(false);
  });

  it('hands the board tiles to the template', async () => {
    const { game } = await openBoard();

    expect(callHelper('board', 'tiles')).toBe(game.board().tiles);
    expect(callHelper('board', 'game')._id).toBe(game._id);
  });

  it('has no tiles before a game is routed to', () => {
    expect(callHelper('board', 'tiles')).toEqual([]);
    expect(callHelper('board', 'game')).toBeUndefined();
  });
});
