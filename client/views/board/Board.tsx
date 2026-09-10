// The board in play: the announce strip, the tile floor, every robot and its archive
// marker, the laser beams, the respawn pickers, the announced card, and the game-over
// notice. Replaces the `board` template. The geometry — tiles, robots, lasers, the
// announce card's animation — stays in game.css; this file positions things from one
// measured number, the tile size, and drives the animations imperatively (D10).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useFind, useTracker } from 'meteor/react-meteor-data';
import { BoardBox } from '../../../both/board_box.ts';
import { CardLogic } from '../../../both/cardlogic.ts';
import { GameLogic } from '../../../both/gamelogic.ts';
import { GameState } from '../../../both/gamestate.ts';
import {
  leaveGame,
  selectRespawnDirection,
  selectRespawnPosition,
} from '../../../both/methods/games.ts';
import { Games } from '../../../collections/games.ts';
import type { Game } from '../../../collections/games.ts';
import { Players } from '../../../collections/players.ts';
import type { Player, PlayerDoc } from '../../../collections/players.ts';
import { modalAlert, modalConfirm } from '../../helper/modalDialogs.ts';
import { paths } from '../routes.ts';
import { useRouteParam } from '../useRouteParam.ts';
import { ArrowRightCircle } from '../icons/ArrowRightCircle.tsx';
import { CheckCircle } from '../icons/CheckCircle.tsx';
import { Circle } from '../icons/Circle.tsx';
import { Tiles } from './Tiles.tsx';

const DANGER =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-control border-0 bg-danger px-4 text-sm font-semibold text-white no-underline hover:bg-[color-mix(in_srgb,var(--color-danger)_88%,white)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const CHIP =
  'flex h-[30px] items-center justify-center gap-1.5 rounded-card text-xs font-semibold tracking-[.04em] uppercase';
// Each state carries the whole of its own colour, so no two utilities for one property
// ever sit on the chip together.
const CHIP_PENDING = 'bg-white/8 text-white/60';
const CHIP_ACTIVE = 'bg-teal text-navy';
const CHIP_DONE = 'bg-checkpoint-visited text-white';
const CHIP_ROW = 'm-0 grid list-none gap-1 p-0';

/** The tile size before the board has been measured, and when there is nothing to measure. */
const DEFAULT_TILE_SIZE = 50;
/** How far in from the robot's facing edge a beam starts. */
const LASER_START_OFFSET = 5;
/** Milliseconds per tile of beam, for the extend and again for the retract. */
const MS_PER_LASER_TILE = 26;

interface Point {
  x: number;
  y: number;
}

type ChipState = 'pending' | 'active' | 'done';

interface Chip {
  name: string;
  state: ChipState;
}

function chipClass(state: ChipState) {
  switch (state) {
    case 'active':
      return CHIP_ACTIVE;
    case 'done':
      return CHIP_DONE;
    default:
      return CHIP_PENDING;
  }
}

function ChipIcon({ state }: { state: ChipState }) {
  switch (state) {
    case 'active':
      return <ArrowRightCircle size={14} />;
    case 'done':
      return <CheckCircle size={14} />;
    default:
      return <Circle size={14} />;
  }
}

/** The five register chips. The template's `registerPhases` helper. */
export function registerChips(game: Game): Chip[] {
  return [1, 2, 3, 4, 5].map((register) => ({
    name: `register ${register}`,
    state:
      game.playPhaseCount === register
        ? 'active'
        : game.playPhaseCount > register
          ? 'done'
          : 'pending',
  }));
}

const PLAY_PHASE_NAMES: [string, string][] = [
  [GameState.PLAY_PHASE.MOVE_BOTS, 'moving bots'],
  [GameState.PLAY_PHASE.MOVE_BOARD, 'moving board'],
  [GameState.PLAY_PHASE.LASERS, 'shooting lasers'],
  [GameState.PLAY_PHASE.CHECKPOINTS, 'checkpoints'],
];

/**
 * The four play-phase chips: everything before the current phase is done, the current one
 * is active, the rest are pending. The template's `playPhases` helper — including its
 * quirk that a phase outside the four (reveal, repairs) marks all of them done.
 */
export function playPhaseChips(game: Game): Chip[] {
  let finished = true;
  return PLAY_PHASE_NAMES.map(([phase, name]) => {
    if (phase === game.playPhase) {
      finished = false;
      return { name, state: 'active' };
    }
    return { name, state: finished ? 'done' : 'pending' };
  });
}

function ChipRow({ chips, label, columns }: { chips: Chip[]; label: string; columns: string }) {
  return (
    <ol className={`${CHIP_ROW} ${columns}`} aria-label={label}>
      {chips.map((chip) => (
        <li
          key={chip.name}
          className={`${CHIP} ${chipClass(chip.state)}`}
          aria-current={chip.state === 'active' ? 'step' : undefined}
          data-state={chip.state}
        >
          <ChipIcon state={chip.state} />
          {chip.name}
        </li>
      ))}
    </ol>
  );
}

function position(tileSize: number, x: number, y: number, offsetX = 0, offsetY = 0): Point {
  return { x: tileSize * x + offsetX, y: tileSize * y + offsetY };
}

/** An inline position, usable both as a style and as an animation keyframe. */
function at(point: Point): { left: string; top: string } {
  return { left: `${point.x}px`, top: `${point.y}px` };
}

/** What a beam is drawn from. `direction` and `shotDistance` are set on every robot in play. */
export interface Shooter {
  position: PlayerDoc['position'];
  direction: number;
  shotDistance: number;
}

export interface LaserGeometry {
  style: CSSProperties;
  extend: Keyframe;
  retract: Keyframe;
  duration: number;
}

/**
 * A robot's beam: a hairline of `tileSize / 15` starting five pixels in from the robot's
 * facing edge, extended to `shotDistance` tiles and then retracted from the far end. The
 * template's `shots` helper, arithmetic unchanged.
 */
export function laserGeometry(shooter: Shooter, tileWidth: number): LaserGeometry {
  const { direction, shotDistance } = shooter;
  const laserWidth = Math.trunc(tileWidth / 15);
  const beamLength = tileWidth * shotDistance;
  const tailDistance = beamLength - LASER_START_OFFSET;
  const extend: Keyframe = {};
  const retract: Keyframe = {};
  const style: CSSProperties = {};
  let offsetX = 0;
  let offsetY = 0;

  if (direction % 2 === 0) {
    extend.height = `${beamLength}px`;
    retract.height = '0px';
    style.width = `${laserWidth}px`;
    style.height = '0px';
    offsetX = (tileWidth - laserWidth) / 2;
  } else {
    extend.width = `${beamLength}px`;
    retract.width = '0px';
    style.height = `${laserWidth}px`;
    style.width = '0px';
    offsetY = (tileWidth - laserWidth) / 2;
  }

  switch (direction) {
    case GameLogic.UP:
      offsetY = LASER_START_OFFSET;
      break;
    case GameLogic.LEFT:
      offsetX = LASER_START_OFFSET;
      break;
    case GameLogic.DOWN:
      offsetY = tileWidth - LASER_START_OFFSET;
      break;
    case GameLogic.RIGHT:
      offsetX = tileWidth - LASER_START_OFFSET;
      break;
  }

  const origin = position(tileWidth, shooter.position.x, shooter.position.y, offsetX, offsetY);
  switch (direction) {
    case GameLogic.UP:
      extend.top = `${origin.y - tailDistance}px`;
      break;
    case GameLogic.LEFT:
      extend.left = `${origin.x - tailDistance}px`;
      break;
    case GameLogic.DOWN:
      retract.top = `${origin.y + tailDistance}px`;
      break;
    case GameLogic.RIGHT:
      retract.left = `${origin.x + tailDistance}px`;
      break;
  }

  return {
    style: { ...style, ...at(origin) },
    extend,
    retract,
    duration: shotDistance * MS_PER_LASER_TILE,
  };
}

// Flat numbers rather than a Player, so the effect below can list exactly what a beam is
// drawn from and re-fire on nothing else.
interface LaserProps {
  index: number;
  x: number;
  y: number;
  direction: number;
  shotDistance: number;
  tileSize: number;
}

/**
 * One robot's beam for the checkpoints phase: extends as it mounts, retracts a seventh of
 * the way in, and fires again only if what it is drawn from changes. Mounting is what
 * starts the volley, so a player document changing for another reason during the phase
 * does not restart it.
 */
function Laser({ index, x, y, direction, shotDistance, tileSize }: LaserProps) {
  const ref = useRef<HTMLDivElement>(null);
  const shooter: Shooter = { position: { x, y }, direction, shotDistance };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { extend, retract, duration } = laserGeometry(
      { position: { x, y }, direction, shotDistance },
      tileSize
    );
    el.getAnimations().forEach((animation) => animation.cancel());
    el.animate([{}, extend], { duration, fill: 'forwards' });
    const timer = setTimeout(() => {
      ref.current?.animate([{}, retract], { duration, fill: 'forwards' });
    }, duration / 7);
    return () => clearTimeout(timer);
  }, [x, y, direction, shotDistance, tileSize]);

  return (
    <div ref={ref} className={`laser l${index}`} style={laserGeometry(shooter, tileSize).style} />
  );
}

/**
 * Whether a robot's beam is drawn. `shotDistance` is what the server writes as each robot
 * fires, and it flips the play phase to CHECKPOINTS before it starts firing — so on the
 * first turn a robot reaches this phase with no distance at all, and on later turns with
 * the previous round's. A robot without one has not fired yet and draws nothing; the
 * template drew it anyway and its animation threw on a NaN duration, which Tracker
 * swallowed and React would not.
 */
function firesThisRound(player: Player): player is Player & { shotDistance: number } {
  return !player.isPoweredDown() && !player.needsRespawn && typeof player.shotDistance === 'number';
}

/** A tile on offer while the player's robot re-enters the race. */
function RespawnOption({
  tileSize,
  x,
  y,
  dir,
  choosing,
  onChoose,
}: {
  tileSize: number;
  x: number;
  y: number;
  dir?: number;
  choosing: 'position' | 'direction';
  onChoose: () => void;
}) {
  const title =
    choosing === 'position'
      ? 'choose a starting position'
      : 'choose the direction you want to face';
  const label =
    choosing === 'position'
      ? `Start at column ${x + 1}, row ${y + 1}`
      : `Face ${['up', 'right', 'down', 'left'][dir ?? 0]}`;
  return (
    <div
      className={`${choosing}-select pointer`}
      style={at(position(tileSize, x, y))}
      role="button"
      tabIndex={0}
      title={title}
      aria-label={label}
      onClick={onChoose}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onChoose();
      }}
    />
  );
}

export function Board() {
  const gameId = useRouteParam('_id');
  const navigate = useNavigate();
  const game = useTracker(() => (gameId ? Games.findOne(gameId) : undefined), [gameId]);
  const userId = useTracker(() => Meteor.userId());
  // Unfiltered by game on purpose, as the helper this replaces was: the `players`
  // publication sends one game's seats, so the local collection is that game's.
  const players = useFind<Player>(() => Players.find()) ?? [];

  const boardRef = useRef<HTMLDivElement>(null);
  const [tileSize, setTileSize] = useState(DEFAULT_TILE_SIZE);
  // One element per robot, by player id, for the glide below.
  const robotEls = useRef(new Map<string, HTMLDivElement>());
  // Each robot's last rendered tile, so a real move can be told from a re-render without
  // reading the DOM — offsetLeft is unreliable while an animation is mid-flight.
  const lastKnown = useRef(new Map<string, Point>());

  const gameEnded = game?.gamePhase === GameState.PHASE.ENDED;
  // `getBoard` builds the board afresh on every call, so hold one per game board. Board 0
  // stands in until the game arrives; nothing draws it, because `#board` is not rendered.
  const boardId = game?.boardId;
  const board = useMemo(() => BoardBox.getBoard(boardId), [boardId]);
  const columns = board.width;
  const rows = board.height;
  const showBoard = game !== undefined;

  // The tile size is the board element's width divided across the columns, re-measured
  // on a window resize and whenever the element's own box changes. The `--tile-size`
  // custom property is what game.css sizes the tiles, robots and markers from; the
  // element's own width and height are pinned so the floated tiles wrap exactly once.
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const measure = () => {
      el.style.width = '100%';
      const size = Math.floor(el.offsetWidth / columns);
      el.style.setProperty('--tile-size', `${size}px`);
      el.style.width = `${size * columns}px`;
      // One row more than the tiles: the parking row, where a robot that is out or waiting
      // to re-enter sits (removePlayerWithDelay parks at y = board.height).
      el.style.height = `${size * (rows + 1)}px`;
      setTileSize(size);
    };
    measure();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, 100);
    };
    window.addEventListener('resize', debounced);
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(debounced);
    observer?.observe(el);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', debounced);
      observer?.disconnect();
    };
  }, [columns, rows, showBoard]);

  // The robot glide. A robot whose tile changed since the last render animates from where
  // it is visible to its new inline position. When a glide is still in flight — the
  // server writes a "move 3" as three updates within milliseconds — the visible position
  // is read off the running animation, so the three play as one continuous glide rather
  // than three that cancel each other. Without one, the start is the previous tile.
  useLayoutEffect(() => {
    if (!showBoard) return;
    for (const player of players) {
      const previous = lastKnown.current.get(player._id);
      const { x, y } = player.position;
      lastKnown.current.set(player._id, { x, y });
      if (!previous || (previous.x === x && previous.y === y)) continue;

      const el = robotEls.current.get(player._id);
      if (!el) continue;
      const target = position(tileSize, x, y);
      let start = position(tileSize, previous.x, previous.y);
      if (el.getAnimations().length > 0) {
        const computed = getComputedStyle(el);
        const left = parseFloat(computed.left);
        const top = parseFloat(computed.top);
        start = { x: Number.isNaN(left) ? start.x : left, y: Number.isNaN(top) ? start.y : top };
      }
      el.getAnimations().forEach((animation) => animation.cancel());
      const tilesTraveled =
        Math.max(Math.abs(target.x - start.x), Math.abs(target.y - start.y)) /
        Math.max(tileSize, 1);
      el.animate([at(start), at(target)], { duration: tilesTraveled * GameLogic.MS_PER_TILE });
    }
  });

  if (!game) {
    return (
      <div className="text-center" style={{ padding: 50 }}>
        <p>Loading...</p>
      </div>
    );
  }

  const goToLobby = () => navigate(paths.gameList());

  // The template's `.cancel` handler, kept whole though the button only shows once the
  // game has ended: leaving a live game forfeits it and asks first.
  const onClose = async () => {
    if (game.gamePhase !== GameState.PHASE.ENDED) {
      if (
        await modalConfirm(
          'If you leave, you will forfeit the game, are you sure you want to give up?'
        )
      ) {
        leaveGame({ gameId: game._id }).then(goToLobby, (error) => {
          modalAlert(error.reason);
          goToLobby();
        });
      }
    } else {
      goToLobby();
    }
  };

  const boardWidth = board.width * tileSize;
  const playerCnt = players.length;
  const you = (player: Player) => (player.userId === userId ? 'You' : player.name);

  const shooters =
    game.playPhase === GameState.PLAY_PHASE.CHECKPOINTS ? players.filter(firesThisRound) : [];

  // The pickers show for the player whose robot is re-entering, and only in the two
  // phases that have something to pick. The server clears `selectOptions` to null while
  // it picks the next robot to respawn; the options for that robot land in a later write.
  const choosing =
    game.respawnPhase === GameState.RESPAWN_PHASE.CHOOSE_POSITION
      ? 'position'
      : game.respawnPhase === GameState.RESPAWN_PHASE.CHOOSE_DIRECTION
        ? 'direction'
        : undefined;
  const options =
    choosing !== undefined && game.respawnUserId === userId ? (game.selectOptions ?? []) : [];

  const announceCard =
    game.playPhase === GameState.PLAY_PHASE.MOVE_BOTS && game.announceCard
      ? game.announceCard
      : null;
  const announcer = announceCard && players.find((p) => p._id === announceCard.playerId);
  // A card id off the deck: this already throws today, as the template's helper did.
  const announceType = announceCard && CardLogic.cardType(announceCard.cardId, playerCnt)!.name;

  const onChoosePosition = (x: number, y: number) =>
    selectRespawnPosition({ gameId: game._id, x, y }).catch((error) => modalAlert(error.reason));
  const onChooseDirection = (direction: number) =>
    selectRespawnDirection({ gameId: game._id, direction }).catch((error) =>
      modalAlert(error.reason)
    );

  return (
    <>
      {gameEnded ? (
        // The notice sits where the strip does, over a board that stays on screen: a
        // finished game can still be looked at, as the template had it.
        <div className="mb-7 text-center">
          <h3 className="mt-0 mb-0 text-2xl">Game over</h3>
          <hr className="star-well mt-3 mb-7" />
          <p className="text-base">{game.winner} has won the game!</p>
          <div className="mt-7">
            <button type="button" className={DANGER} onClick={onClose}>
              Close game
            </button>
          </div>
        </div>
      ) : (
        game.announce && (
          // `announce-bar` is contract: the browser journey waits for it to be visible. The
          // strip is as wide as the board under it.
          <div
            className="announce-bar mx-auto mb-3 flex flex-col gap-1 rounded-control bg-navy-deep p-1.5"
            style={{ width: `${boardWidth}px` }}
          >
            <ChipRow chips={registerChips(game)} label="Registers" columns="grid-cols-5" />
            <ChipRow chips={playPhaseChips(game)} label="Play phases" columns="grid-cols-4" />
          </div>
        )
      )}
      {/* `#board` is contract: the browser journey checks its position and `--tile-size`. */}
      <div id="board" ref={boardRef}>
        <Tiles rows={board.tiles} showStart={false} />
        {/* The parking row's floor; game.css draws it. Before the robots, so they sit on it. */}
        <div className="scrapyard" aria-hidden="true" />
        <br />
        {players
          .filter((player) => player.lives > 0)
          .map((player) => (
            <div
              key={player._id}
              className={`marker m${player.robotId}`}
              // `start` is written when the game starts, before a board can be on screen.
              style={at(position(tileSize, player.start!.x, player.start!.y))}
            >
              <img
                src={`/robots/marker_${player.robotId}.png`}
                alt={`respawn location ( ${you(player)} )`}
              />
            </div>
          ))}
        {players.map((player) => (
          // `robot` and `r<robotId>` are contract: the browser journey waits for `.robot.r0`.
          <div
            key={player._id}
            ref={(el) => {
              if (el) robotEls.current.set(player._id, el);
              else robotEls.current.delete(player._id);
            }}
            className={`robot r${player.robotId}${player.lives <= 0 ? ' eliminated' : ''}`}
            style={at(position(tileSize, player.position.x, player.position.y))}
          >
            <img
              src={`/robots/robot_${player.robotId}.png`}
              alt={you(player)}
              style={{ transform: `rotate(${(player.direction ?? 0) * 90}deg)` }}
            />
            {player.isPoweredDown() && <img src="/Power_Off.png" className="robot-off" alt="" />}
          </div>
        ))}
        {shooters.map((player, i) => (
          <Laser
            key={player._id}
            index={i}
            x={player.position.x}
            y={player.position.y}
            // Set when the game starts, before a robot can be on the board.
            direction={player.direction!}
            shotDistance={player.shotDistance}
            tileSize={tileSize}
          />
        ))}
        {options.map((option) => (
          <RespawnOption
            key={`${option.x},${option.y},${option.dir ?? ''}`}
            tileSize={tileSize}
            x={option.x}
            y={option.y}
            dir={option.dir}
            choosing={choosing!}
            onChoose={() =>
              choosing === 'position'
                ? onChoosePosition(option.x, option.y)
                : // The schema makes `dir` optional because the position round has none;
                  // the direction round always writes it.
                  onChooseDirection(option.dir!)
            }
          />
        ))}
        {announceCard && announcer && !announcer.needsRespawn && (
          // `#board .gamecard.fadeInAndOut` is contract: the browser journey asserts a
          // running animation on it. Centred over the robot, one tile wide.
          <div
            className={`gamecard fadeInAndOut ${announceType} played announce-move`}
            style={{
              ...at(
                position(tileSize, announcer.position.x, announcer.position.y, 0, -tileSize / 2)
              ),
              width: `${tileSize}px`,
            }}
            role="img"
            aria-label={`${you(announcer)}: ${announceType!.replace(/-/g, ' ')}, priority ${CardLogic.priority(announceCard.cardId)}`}
          />
        )}
      </div>
    </>
  );
}
