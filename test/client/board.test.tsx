// @vitest-environment jsdom
// The board in play. jsdom does no layout and has no Web Animations, so `#board` gets an
// offsetWidth and every element an `animate`/`getAnimations` pair — the one input the
// geometry hangs off, and the two calls the glide and the lasers make. The inert
// `useTracker`/`useFind` stubs read the collections once per render, so a test that moves
// a robot re-renders the board itself.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../client/helper/modalDialogs.ts', () => ({
  modalAlert: vi.fn(),
  modalConfirm: vi.fn(async () => true),
}));

import {
  Board,
  laserGeometry,
  playPhaseChips,
  registerChips,
} from '../../client/views/board/Board.tsx';
import { modalAlert } from '../../client/helper/modalDialogs.ts';
import { GameLogic } from '../../both/gamelogic.ts';
import { GameState } from '../../both/gamestate.ts';
import { Games } from '../../collections/games.ts';
import { Players } from '../../collections/players.ts';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import { loginAs, resetFakeCollections } from '../setup.js';
import { renderAt, resetRouter, setRoute } from '../helpers/router.tsx';

const TURN_RIGHT = 6;
// The default board is 12 tiles wide, so a 600px board is 50px tiles.
const BOARD_PX = 600;
const TILE = 50;

type Overrides = Record<string, unknown>;

// What jsdom lacks. `animate` records its calls; `getAnimations` answers from a per-element
// list a test can fill to stand for a glide still in flight.
const animate = vi.fn();
const inFlight = new WeakMap<Element, Animation[]>();
let boardWidth = BOARD_PX;

beforeEach(async () => {
  resetFakeCollections();
  resetRouter();
  await loginAs('me');
  boardWidth = BOARD_PX;
  animate.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.id === 'board' ? boardWidth : 0;
    },
  });
  Element.prototype.animate = function (this: Element, ...args: unknown[]) {
    animate(this, ...args);
    return { cancel() {} } as unknown as Animation;
  };
  Element.prototype.getAnimations = function (this: Element) {
    return inFlight.get(this) ?? [];
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A started game with the caller's robot on it, routed the way FlowRouter would have it. */
async function openBoard({
  game: gameOverrides = {},
  player: playerOverrides = {},
}: { game?: Overrides; player?: Overrides } = {}) {
  // The fixtures read the document straight back, so there is always one.
  const game = (await insertGame(gameOverrides))!;
  const player = (await insertPlayer(game._id, {
    userId: 'me',
    name: 'me',
    robotId: '0',
    start: { x: 1, y: 2 },
    ...playerOverrides,
  }))!;
  setRoute(`/board/${game._id}`);
  return { game, player };
}

const board = () => document.getElementById('board')!;
const robot = (id = '0') => document.querySelector<HTMLElement>(`.robot.r${id}`)!;
const chips = (label: string) =>
  [...screen.getByRole('list', { name: label }).querySelectorAll('li')].map((li) => ({
    name: li.textContent,
    state: li.dataset.state,
    icon: li.querySelector('svg')!.dataset.icon,
  }));

describe('the page', () => {
  it('says it is loading while the route points at no game', () => {
    renderAt(<Board />);

    expect(screen.getByText('Loading...')).toBeVisible();
    expect(document.getElementById('board')).toBeNull();
  });

  it('draws the game board as tiles', async () => {
    const { game } = await openBoard();

    renderAt(<Board />);

    const tiles = game.board();
    expect(board().querySelectorAll('span.tile')).toHaveLength(tiles.width * tiles.height);
    expect(board().querySelector('img[src="/start.png"]')).toBeNull();

    // Nothing on the board is meant to be dragged, and an `<img>` is draggable by
    // default — dragging one lifts a ghost image out of the window and looks like a bug.
    // React renders the attribute as the string 'false'. The filter is so that a failure
    // names the offending image rather than reporting a count.
    const images = [...board().querySelectorAll('img')];
    expect(images.length).toBeGreaterThan(0);
    expect(
      images.filter((img) => img.getAttribute('draggable') !== 'false').map((img) => img.src)
    ).toEqual([]);
  });

  it('draws a pit and a caption for a board name it cannot build', async () => {
    await openBoard({ game: { boardName: 'gone_board' } });

    renderAt(<Board />);

    const tiles = [...board().querySelectorAll<HTMLElement>('span.tile')];
    expect(tiles).toHaveLength(12 * 16);
    expect(tiles.filter((t) => t.style.backgroundImage.includes('void-full'))).toHaveLength(140);
    const caption = board().querySelector('.board-missing')!;
    expect(caption).toHaveTextContent('Board not available');
    expect(caption).toHaveTextContent('“gone_board” is not in the catalog.');
  });

  it('draws the real board for a hidden name', async () => {
    await openBoard({ game: { boardName: 'test' } });

    renderAt(<Board />);

    expect(board().querySelectorAll('span.tile')).toHaveLength(4 * 5);
    expect(board().querySelector('.board-missing')).toBeNull();
  });

  it('draws the scrapyard strip under the tiles, beneath the robots', async () => {
    await openBoard();

    renderAt(<Board />);

    const strips = board().querySelectorAll('.scrapyard');
    expect(strips).toHaveLength(1);
    // The strip and the robots are all absolutely positioned, so document order is paint
    // order: the strip has to come first to lie under them.
    expect(
      strips[0].compareDocumentPosition(robot()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe('tile geometry', () => {
  it('divides the measured width across the columns and pins the board to it', async () => {
    const { game } = await openBoard();
    boardWidth = game.board().width * 32;

    renderAt(<Board />);

    expect(board().style.getPropertyValue('--tile-size')).toBe('32px');
    expect(board().style.width).toBe(`${game.board().width * 32}px`);
    // One tile row more than the tiles: the parking row under the board.
    expect(board().style.height).toBe(`${(game.board().height + 1) * 32}px`);
  });

  it('positions everything on the board from that tile size', async () => {
    await openBoard({ player: { position: { x: 3, y: 4 } } });

    renderAt(<Board />);

    expect(robot().style.left).toBe(`${3 * TILE}px`);
    expect(robot().style.top).toBe(`${4 * TILE}px`);
  });

  it('re-measures after the window is resized, once the resize has settled', async () => {
    vi.useFakeTimers();
    const { game } = await openBoard();
    renderAt(<Board />);
    expect(board().style.getPropertyValue('--tile-size')).toBe('50px');

    boardWidth = game.board().width * 40;
    act(() => window.dispatchEvent(new Event('resize')));
    act(() => vi.advanceTimersByTime(50));
    expect(board().style.getPropertyValue('--tile-size')).toBe('50px');

    act(() => vi.advanceTimersByTime(60));
    expect(board().style.getPropertyValue('--tile-size')).toBe('40px');
    expect(robot().style.left).toBe('0px');
  });
});

describe('robots', () => {
  it('places each robot on its tile and names the caller "You"', async () => {
    const { game } = await openBoard({ player: { position: { x: 3, y: 4 } } });
    await insertPlayer(game._id, {
      userId: 'them',
      name: 'them',
      robotId: '1',
      position: { x: 0, y: 0 },
      start: { x: 0, y: 0 },
    });

    renderAt(<Board />);

    expect(robot('0')).toHaveStyle({ left: '150px', top: '200px' });
    expect(robot('0').querySelector('img')).toHaveAttribute('src', '/robots/robot_0.png');
    expect(screen.getByAltText('You')).toBeInTheDocument();
    expect(screen.getByAltText('them')).toBeInTheDocument();
  });

  it('turns the robot to face its direction', async () => {
    await openBoard({ player: { direction: GameLogic.LEFT } });

    renderAt(<Board />);

    expect(robot().querySelector('img')!.style.transform).toBe('rotate(270deg)');
  });

  it('dims an eliminated robot', async () => {
    await openBoard({ player: { lives: 0 } });

    renderAt(<Board />);

    expect(robot()).toHaveClass('eliminated');
  });

  it('marks a powered-down robot', async () => {
    await openBoard({ player: { powerState: GameLogic.OFF } });

    renderAt(<Board />);

    expect(robot().querySelector('img.robot-off')).toHaveAttribute('src', '/Power_Off.png');
  });

  it('does not mark a robot that is running', async () => {
    await openBoard();

    renderAt(<Board />);

    expect(robot().querySelector('img.robot-off')).toBeNull();
  });
});

describe('the glide', () => {
  it('only places the robot on the first render', async () => {
    await openBoard();

    renderAt(<Board />);

    expect(animate).not.toHaveBeenCalled();
  });

  it('plays a three-tile move as one glide of three tiles', async () => {
    const { player } = await openBoard({ player: { position: { x: 0, y: 0 } } });
    const { rerender } = renderAt(<Board />);

    await Players.updateAsync(player._id, { $set: { position: { x: 3, y: 0 } } });
    rerender(<Board />);

    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(
      robot(),
      [
        { left: '0px', top: '0px' },
        { left: '150px', top: '0px' },
      ],
      { duration: 3 * GameLogic.MS_PER_TILE }
    );
    expect(robot().style.left).toBe('150px');
  });

  it('starts a new glide from where the robot is visible when one is still in flight', async () => {
    const { player } = await openBoard({ player: { position: { x: 0, y: 0 } } });
    const { rerender } = renderAt(<Board />);

    await Players.updateAsync(player._id, { $set: { position: { x: 1, y: 0 } } });
    rerender(<Board />);
    // Midway through the first glide, at 25px, as the browser would report it.
    const cancel = vi.fn();
    inFlight.set(robot(), [{ cancel } as unknown as Animation]);
    robot().style.left = '25px';
    Object.defineProperty(robot(), 'ownerDocument', { value: document });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      left: '25px',
      top: '0px',
    } as CSSStyleDeclaration);

    await Players.updateAsync(player._id, { $set: { position: { x: 3, y: 0 } } });
    rerender(<Board />);

    expect(cancel).toHaveBeenCalled();
    expect(animate).toHaveBeenLastCalledWith(
      robot(),
      [
        { left: '25px', top: '0px' },
        { left: '150px', top: '0px' },
      ],
      { duration: 2.5 * GameLogic.MS_PER_TILE }
    );
  });

  it('does not glide a robot whose document changed without moving', async () => {
    const { player } = await openBoard();
    const { rerender } = renderAt(<Board />);

    await Players.updateAsync(player._id, { $set: { damage: 2 } });
    rerender(<Board />);

    expect(animate).not.toHaveBeenCalled();
  });
});

describe('respawn markers', () => {
  it('places a marker on each living robot’s archive position', async () => {
    await openBoard({ player: { start: { x: 1, y: 2 } } });

    renderAt(<Board />);

    const marker = document.querySelector<HTMLElement>('.marker.m0')!;
    expect(marker).toHaveStyle({ left: '50px', top: '100px' });
    expect(marker.querySelector('img')).toHaveAttribute('src', '/robots/marker_0.png');
    expect(screen.getByAltText('respawn location ( You )')).toBeInTheDocument();
  });

  it('drops the marker for an eliminated robot', async () => {
    await openBoard({ player: { lives: 0 } });

    renderAt(<Board />);

    expect(document.querySelector('.marker')).toBeNull();
  });
});

describe('laser geometry', () => {
  const shooter = (direction: number, shotDistance = 3) => ({
    position: { x: 2, y: 2 },
    direction,
    shotDistance,
  });

  it('draws a vertical hairline from the top edge for a robot facing up', () => {
    const { style, extend, retract, duration } = laserGeometry(shooter(GameLogic.UP), 60);

    // 60 / 15 = 4 wide, centred at (60 - 4) / 2 = 28 in; five pixels down from the edge.
    expect(style).toEqual({ width: '4px', height: '0px', left: '148px', top: '125px' });
    // Extends 180px upward, so its top moves by 180 - 5 = 175.
    expect(extend).toEqual({ height: '180px', top: '-50px' });
    expect(retract).toEqual({ height: '0px' });
    expect(duration).toBe(3 * 26);
  });

  it('draws a horizontal hairline from the right edge for a robot facing right', () => {
    const { style, extend, retract } = laserGeometry(shooter(GameLogic.RIGHT, 2), 60);

    expect(style).toEqual({ height: '4px', width: '0px', left: '175px', top: '148px' });
    expect(extend).toEqual({ width: '120px' });
    expect(retract).toEqual({ width: '0px', left: '290px' });
  });

  it('retracts a downward beam from its far end', () => {
    const { style, extend, retract } = laserGeometry(shooter(GameLogic.DOWN, 1), 60);

    expect(style.top).toBe('175px');
    expect(extend).toEqual({ height: '60px' });
    expect(retract).toEqual({ height: '0px', top: '230px' });
  });

  it('extends a leftward beam by moving its left edge', () => {
    const { style, extend, retract } = laserGeometry(shooter(GameLogic.LEFT, 1), 60);

    expect(style.left).toBe('125px');
    expect(extend).toEqual({ width: '60px', left: '70px' });
    expect(retract).toEqual({ width: '0px' });
  });
});

describe('lasers', () => {
  const checkpoints = { playPhase: GameState.PLAY_PHASE.CHECKPOINTS };

  it('draws no beams outside the checkpoints phase', async () => {
    await openBoard({
      game: { playPhase: GameState.PLAY_PHASE.LASERS },
      player: { shotDistance: 3 },
    });

    renderAt(<Board />);

    expect(document.querySelector('.laser')).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it('fires one beam per robot during the checkpoints phase, then retracts it', async () => {
    vi.useFakeTimers();
    const { game } = await openBoard({
      game: checkpoints,
      player: { direction: GameLogic.UP, position: { x: 1, y: 1 }, shotDistance: 3 },
    });
    await insertPlayer(game._id, {
      userId: 'them',
      robotId: '1',
      direction: GameLogic.RIGHT,
      position: { x: 4, y: 4 },
      start: { x: 4, y: 4 },
      shotDistance: 1,
    });

    renderAt(<Board />);

    const beams = document.querySelectorAll<HTMLElement>('.laser');
    expect(beams).toHaveLength(2);
    expect(beams[0]).toHaveClass('l0');
    expect(beams[1]).toHaveClass('l1');
    // A vertical beam: the hairline is its width, and its height grows from nothing.
    expect(beams[0]).toHaveStyle({ width: '3px', height: '0px' });
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate).toHaveBeenCalledWith(beams[0], [{}, { height: '150px', top: '-90px' }], {
      duration: 78,
      fill: 'forwards',
    });

    // The retract follows a seventh of the extend in.
    act(() => vi.advanceTimersByTime(78 / 7 + 1));
    expect(animate).toHaveBeenCalledTimes(4);
    expect(animate).toHaveBeenCalledWith(beams[0], [{}, { height: '0px' }], {
      duration: 78,
      fill: 'forwards',
    });
  });

  // The game ends inside the checkpoints phase and the game-over write leaves `playPhase`
  // there, so a finished game used to fire on every page load.
  it('draws no beams once the game is over', async () => {
    await openBoard({
      game: { ...checkpoints, gamePhase: GameState.PHASE.ENDED, winner: 'them' },
      player: { direction: GameLogic.UP, position: { x: 1, y: 1 }, shotDistance: 3 },
    });

    renderAt(<Board />);

    expect(document.querySelector('.laser')).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it('skips powered-down and destroyed robots', async () => {
    const { game } = await openBoard({
      game: checkpoints,
      player: { powerState: GameLogic.OFF, shotDistance: 2 },
    });
    await insertPlayer(game._id, {
      userId: 'x',
      robotId: '1',
      needsRespawn: true,
      shotDistance: 2,
      start: { x: 0, y: 0 },
    });

    renderAt(<Board />);

    expect(document.querySelector('.laser')).toBeNull();
  });

  // The server flips the phase to CHECKPOINTS and then writes each robot's distance as it
  // fires, so the phase's first render can carry no distance at all.
  it('draws nothing for a robot whose shot distance has not been written yet', async () => {
    const { player } = await openBoard({
      game: checkpoints,
      player: { direction: GameLogic.UP, position: { x: 1, y: 1 }, shotDistance: undefined },
    });
    const { rerender } = renderAt(<Board />);
    expect(document.querySelector('.laser')).toBeNull();
    expect(animate).not.toHaveBeenCalled();

    await Players.updateAsync(player._id, { $set: { shotDistance: 2 } });
    rerender(<Board />);

    expect(document.querySelectorAll('.laser')).toHaveLength(1);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('fires once per volley, not once per render', async () => {
    const { player } = await openBoard({
      game: checkpoints,
      player: { direction: GameLogic.UP, position: { x: 1, y: 1 }, shotDistance: 3 },
    });
    const { rerender } = renderAt(<Board />);
    expect(animate).toHaveBeenCalledTimes(1);

    // A checkpoint reached during the phase changes the document but not the beam.
    await Players.updateAsync(player._id, { $set: { visited_checkpoints: 1 } });
    rerender(<Board />);

    expect(animate).toHaveBeenCalledTimes(1);
  });
});

describe('the announce strip', () => {
  it('shows only while the game is announcing', async () => {
    const { game } = await openBoard({ game: { announce: false } });
    const { rerender } = renderAt(<Board />);
    expect(document.querySelector('.announce-bar')).toBeNull();

    await Games.updateAsync(game._id, { $set: { announce: true } });
    rerender(<Board />);

    expect(document.querySelector('.announce-bar')).toBeVisible();
  });

  it('is as wide as the board', async () => {
    const { game } = await openBoard({ game: { announce: true } });

    renderAt(<Board />);

    expect(document.querySelector<HTMLElement>('.announce-bar')!.style.width).toBe(
      `${game.board().width * TILE}px`
    );
  });

  it('marks the registers done, active and pending', async () => {
    await openBoard({ game: { announce: true, playPhaseCount: 3 } });

    renderAt(<Board />);

    expect(chips('Registers')).toEqual([
      { name: 'register 1', state: 'done', icon: 'check-circle' },
      { name: 'register 2', state: 'done', icon: 'check-circle' },
      { name: 'register 3', state: 'active', icon: 'arrow-right-circle' },
      { name: 'register 4', state: 'pending', icon: 'circle' },
      { name: 'register 5', state: 'pending', icon: 'circle' },
    ]);
    expect(document.querySelector('[aria-current="step"]')).toHaveTextContent('register 3');
  });

  it('abbreviates every label once the board is too narrow for the full ones', async () => {
    const { game } = await openBoard({
      game: { announce: true, playPhaseCount: 3, playPhase: GameState.PLAY_PHASE.LASERS },
    });
    // 12 tiles at 40px is a 480px strip, under the 556px the full labels need.
    boardWidth = game.board().width * 40;

    renderAt(<Board />);

    expect(chips('Registers').map((chip) => chip.name)).toEqual([
      'reg 1',
      'reg 2',
      'reg 3',
      'reg 4',
      'reg 5',
    ]);
    expect(chips('Play phases').map((chip) => chip.name)).toEqual([
      'move bots',
      'move board',
      'lasers',
      'checks',
    ]);
    // The state each chip reports is the full label's, abbreviated or not.
    expect(document.querySelector('[aria-current="step"]')).toHaveTextContent('reg 3');
  });

  it('walks the play phases, marking everything before the current one done', async () => {
    await openBoard({ game: { announce: true, playPhase: GameState.PLAY_PHASE.LASERS } });

    renderAt(<Board />);

    expect(chips('Play phases').map((chip) => [chip.name, chip.state])).toEqual([
      ['moving bots', 'done'],
      ['moving board', 'done'],
      ['shooting lasers', 'active'],
      ['checkpoints', 'pending'],
    ]);
  });

  it('marks every play phase done once the register is past them', async () => {
    const { game } = await openBoard({ game: { playPhase: GameState.PLAY_PHASE.REPAIRS } });

    expect(playPhaseChips(game).every((chip) => chip.state === 'done')).toBe(true);
    expect(registerChips({ ...game, playPhaseCount: 1 } as typeof game)[0].state).toBe('active');
  });
});

describe('the announced card', () => {
  const card = () => document.querySelector<HTMLElement>('#board .gamecard.fadeInAndOut');

  it('shows the card being played, one tile wide and lifted half a tile over the robot', async () => {
    const { player } = await openBoard({
      game: {
        playPhase: GameState.PLAY_PHASE.MOVE_BOTS,
        announceCard: { cardId: TURN_RIGHT, playerId: 'later' },
      },
      player: { position: { x: 2, y: 3 } },
    });
    await Games.updateAsync((await Games.findOneAsync())!._id, {
      $set: { announceCard: { cardId: TURN_RIGHT, playerId: player._id } },
    });

    renderAt(<Board />);

    expect(card()).toHaveClass('gamecard', 'fadeInAndOut', 'turn-right', 'played', 'announce-move');
    expect(card()).toHaveStyle({ left: '100px', top: '125px', width: '50px' });
    expect(card()).toHaveAccessibleName('You: turn right, priority 70');
  });

  it('announces only while bots are moving', async () => {
    const { game, player } = await openBoard({
      game: {
        playPhase: GameState.PLAY_PHASE.LASERS,
        announceCard: { cardId: TURN_RIGHT, playerId: 'later' },
      },
    });
    await Games.updateAsync(game._id, {
      $set: { announceCard: { cardId: TURN_RIGHT, playerId: player._id } },
    });

    renderAt(<Board />);

    expect(card()).toBeNull();
  });

  it('announces nothing for a robot waiting to respawn, or when no card is in flight', async () => {
    const { game, player } = await openBoard({
      game: { playPhase: GameState.PLAY_PHASE.MOVE_BOTS },
      player: { needsRespawn: true },
    });
    const { rerender } = renderAt(<Board />);
    expect(card()).toBeNull();

    await Games.updateAsync(game._id, {
      $set: { announceCard: { cardId: TURN_RIGHT, playerId: player._id } },
    });
    rerender(<Board />);

    expect(card()).toBeNull();
  });
});

describe('respawn choices', () => {
  const respawn = (phase: string, options: unknown, respawnUserId = 'me') => ({
    gamePhase: GameState.PHASE.RESPAWN,
    respawnPhase: phase,
    respawnUserId,
    selectOptions: options,
  });
  const positions = () => document.querySelectorAll<HTMLElement>('#board .position-select');
  const directions = () => document.querySelectorAll<HTMLElement>('#board .direction-select');

  it('offers the starting positions to the player who is respawning', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game } = await openBoard({
      game: respawn(GameState.RESPAWN_PHASE.CHOOSE_POSITION, [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ]),
    });
    renderAt(<Board />);

    expect(positions()).toHaveLength(2);
    expect(positions()[0]).toHaveStyle({ left: '50px', top: '50px' });
    expect(positions()[0]).toHaveAttribute('title', 'choose a starting position');

    await userEvent.click(screen.getByRole('button', { name: 'Start at column 3, row 2' }));

    // Numbers, as the method's schema demands; the template read strings off `dataset`.
    expect(call).toHaveBeenCalledWith('selectRespawnPosition', { gameId: game._id, x: 2, y: 1 });
  });

  it('offers the directions in the second round, from the keyboard too', async () => {
    const call = vi.spyOn(Meteor, 'callAsync').mockResolvedValue(undefined);
    const { game } = await openBoard({
      game: respawn(GameState.RESPAWN_PHASE.CHOOSE_DIRECTION, [
        { x: 1, y: 1, dir: GameLogic.UP },
        { x: 1, y: 1, dir: GameLogic.LEFT },
      ]),
    });
    renderAt(<Board />);

    expect(directions()).toHaveLength(2);
    expect(positions()).toHaveLength(0);
    expect(directions()[1]).toHaveAttribute('title', 'choose the direction you want to face');

    screen.getByRole('button', { name: 'Face left' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(call).toHaveBeenCalledWith('selectRespawnDirection', {
      gameId: game._id,
      direction: GameLogic.LEFT,
    });
  });

  it('reports a refused choice through the modal', async () => {
    vi.spyOn(Meteor, 'callAsync').mockRejectedValue({ reason: 'Game/Player not found! g' });
    await openBoard({
      game: respawn(GameState.RESPAWN_PHASE.CHOOSE_POSITION, [{ x: 1, y: 1 }]),
    });
    renderAt(<Board />);

    await userEvent.click(positions()[0]);

    await vi.waitFor(() => expect(modalAlert).toHaveBeenCalledWith('Game/Player not found! g'));
  });

  it('offers nothing to the other players', async () => {
    await openBoard({
      game: respawn(GameState.RESPAWN_PHASE.CHOOSE_POSITION, [{ x: 1, y: 1 }], 'someone-else'),
    });

    renderAt(<Board />);

    expect(positions()).toHaveLength(0);
  });

  // While the server picks the next robot it clears `selectOptions` to null; the options
  // for that robot arrive in a later write. Nothing may throw in between.
  it('offers nothing while the options for this robot have not been written yet', async () => {
    await openBoard({ game: respawn(GameState.RESPAWN_PHASE.CHOOSE_POSITION, null) });

    renderAt(<Board />);

    expect(positions()).toHaveLength(0);
  });
});

describe('game over', () => {
  it('names the winner above a board that stays on screen', async () => {
    await openBoard({ game: { gamePhase: GameState.PHASE.ENDED, winner: 'them', announce: true } });

    renderAt(<Board />);

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Game over');
    expect(screen.getByText('them has won the game!')).toBeVisible();
    // The notice takes the strip's place; the finished board can still be looked at.
    expect(document.querySelector('.announce-bar')).toBeNull();
    expect(board().querySelectorAll('span.tile').length).toBeGreaterThan(0);
    expect(robot()).toBeInTheDocument();
  });

  // Closing is the chat panel's exit button, the one control that handles leaving and
  // closing for every screen; the board carried a second one for a finished game.
  it('offers no close button of its own', async () => {
    await openBoard({ game: { gamePhase: GameState.PHASE.ENDED, winner: 'them' } });
    renderAt(<Board />);

    expect(screen.queryByRole('button', { name: 'Close game' })).not.toBeInTheDocument();
  });
});
