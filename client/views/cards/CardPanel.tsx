// The card panel on the board page: the phase label and the programming timer, the
// player's hand and registers, their own status row, and one row per other player.
// Replaces the `cards` template. `CardPanel` rather than `Cards` because that is the
// collection this file reads — the clash `chat` → `ChatPanel` solved at step 5.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { Mongo } from 'meteor/mongo';
import { useFind, useTracker } from 'meteor/react-meteor-data';
import { BoardBox } from '../../../both/board_box.ts';
import { CardLogic } from '../../../both/cardlogic.ts';
import { GameLogic } from '../../../both/gamelogic.ts';
import { GameState } from '../../../both/gamestate.ts';
import {
  deselectAllCards,
  deselectCard,
  playCards,
  selectCard,
  togglePowerDown,
} from '../../../both/methods/cards.ts';
import { Cards } from '../../../collections/cards.ts';
import { Games } from '../../../collections/games.ts';
import type { Game } from '../../../collections/games.ts';
import { Players } from '../../../collections/players.ts';
import type { Player, PlayerDoc } from '../../../collections/players.ts';
import { addUIData } from '../../lib/cardUI.ts';
import { firstEmptySlot, nextEmptySlot } from '../../lib/slots.ts';
import { modalAlert } from '../../helper/modalDialogs.ts';
import { useRouteParam } from '../useRouteParam.ts';
import { Card } from './Card.tsx';
import type { UICard } from './Card.tsx';
import { EYEBROW, OptionCards, PlayerHeader, PlayerStatus } from './PlayerStatus.tsx';

// Each variant carries the whole of its own cursor and colour, so no two utilities for
// one property ever sit on the element together (the stylesheet, not the class
// attribute, would decide between them).
const BTN =
  'inline-flex h-10 items-center justify-center rounded-control px-4 text-sm font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const PRIMARY =
  'cursor-pointer bg-brand text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] hover:text-white';
// No `aria-disabled:` variant: the browser journey asserts `not.toHaveClass(/disabled/)`
// against the whole class attribute, so the word may appear only as the marker itself.
const PRIMARY_OFF = 'disabled cursor-not-allowed bg-brand text-white opacity-45';
const DANGER =
  'cursor-pointer border-0 bg-danger text-white hover:bg-[color-mix(in_srgb,var(--color-danger)_88%,white)]';
const GHOST =
  'cursor-pointer border border-white/22 bg-transparent text-white hover:border-white/40 hover:bg-raised';
const TIMER_PILL =
  'inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-2.5 font-display text-sm font-bold tabular-nums';
const TIMER_CALM = 'bg-raised text-teal';
const TIMER_URGENT = 'animate-timer-pulse bg-heart text-white';
const GRID = 'mt-2 grid grid-cols-5 gap-1.5';

/** The heading. The template's `gameState` helper, switch for switch. */
function phaseLabel(game: Game, player: Player | undefined, userId: string | null) {
  switch (game.gamePhase) {
    case GameState.PHASE.IDLE:
    case GameState.PHASE.DEAL:
      return 'Dealing cards';
    case GameState.PHASE.ENDED:
      return 'Game over';
    case GameState.PHASE.PROGRAM:
      if (!player) return 'Players thinking';
      if (player.lives <= 0) return 'No archives';
      if (player.isPoweredDown() && !player.optionalInstantPowerDown) return 'Powered down';
      return 'Pick your cards';
    case GameState.PHASE.PLAY:
      switch (game.playPhase) {
        case GameState.PLAY_PHASE.IDLE:
        case GameState.PLAY_PHASE.REVEAL_CARDS:
          return 'Revealing cards';
        case GameState.PLAY_PHASE.MOVE_BOTS:
          return 'Moving bots';
        case GameState.PLAY_PHASE.MOVE_BOARD:
          return 'Moving board elements';
        case GameState.PLAY_PHASE.LASERS:
          return 'Shooting lasers';
        case GameState.PLAY_PHASE.CHECKPOINTS:
          return 'Checkpoints';
        case GameState.PLAY_PHASE.REPAIRS:
          return 'Repairing bots';
      }
      break;
    case GameState.PHASE.RESPAWN:
      switch (game.respawnPhase) {
        case GameState.RESPAWN_PHASE.CHOOSE_POSITION:
          return game.respawnUserId === userId
            ? 'Choose position'
            : 'Waiting for destroyed bots to reenter';
        case GameState.RESPAWN_PHASE.CHOOSE_DIRECTION:
          return game.respawnUserId === userId
            ? 'Choose direction'
            : 'Waiting for destroyed bots to reenter';
      }
      break;
  }
  console.log(game.gamePhase, game.playPhase, game.respawnPhase);
  return 'Problem?';
}

/**
 * Seconds left on the programming timer at `now`, 0 when it is not running. Clamped at
 * the top as well: `now` is a state value that only advances while the timer runs, so
 * the first render after the server starts it can read a clock from before the start.
 */
function secondsLeft(game: Game, now: number) {
  if (game.timer !== 1 || !game.timerStartedAt) return 0;
  const elapsed = (now - new Date(game.timerStartedAt).getTime()) / 1000;
  return Math.min(GameLogic.TIMER, Math.max(0, GameLogic.TIMER - Math.floor(elapsed)));
}

function powerButton(powerState: number): [label: string, variant: string] {
  switch (powerState) {
    case GameLogic.DOWN:
      return ['Withdraw power down', DANGER];
    case GameLogic.OFF:
      return ['Cancel power down', GHOST];
    default:
      return ['Announce power down', GHOST];
  }
}

export function CardPanel() {
  const gameId = useRouteParam('_id');
  const game = useTracker(() => (gameId ? Games.findOne(gameId) : undefined), [gameId]);
  const userId = useTracker(() => Meteor.userId());
  // Unfiltered by game on purpose, as the helper this replaces was: the `players`
  // publication sends one game's seats, so the local collection is that game's.
  const player = useTracker(() => (userId ? Players.findOne({ userId }) : undefined), [userId]);
  const others =
    useFind<Player>(() => {
      if (!gameId) return null;
      // `$ne` against an id that may be null: PlayerDoc types `userId` as a string, so the
      // selector type has no way to say "everyone but nobody" for a logged-out reader.
      const selector = { gameId, userId: { $ne: userId } } as unknown as Mongo.Selector<PlayerDoc>;
      return Players.find(selector);
    }, [gameId, userId]) ?? [];
  // The `cards` publication sends the reader's own document, so this is their hand.
  const cardDoc = useTracker(() => Cards.findOne());
  const playerCnt = useTracker(() => (gameId ? Players.find({ gameId }).count() : 0), [gameId]);
  const boardId = game?.boardId;
  const checkpointCnt = useMemo(
    () => (boardId === undefined ? 0 : BoardBox.getBoard(boardId).checkpoints.length),
    [boardId]
  );

  // The register slot the next hand click fills; null until the player picks one, so
  // the first empty slot decides. The template kept it in a module-level ReactiveDict.
  const [pickedSlot, setPickedSlot] = useState<number | null>(null);
  // The clock the countdown is computed from, advanced once a second while it runs.
  const [now, setNow] = useState(0);
  // The auto-submit latch. The effect below runs on every render while the server holds
  // `timer` at 0, and each extra playCards would queue behind the first — whose result
  // only arrives after the whole turn has played out — and execute against the NEXT
  // turn's program phase. Not state: nothing renders differently for it.
  const autoSubmitted = useRef(false);

  const timerRunning = game?.timer === 1;
  useEffect(() => {
    if (!timerRunning) return;
    const tick = () => setNow(Date.now());
    // The first reading straight away — deferred a task, not taken synchronously in the
    // effect — so a page opened mid-countdown does not show 30 for its first second.
    const first = setTimeout(tick, 0);
    const handle = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(handle);
    };
  }, [timerRunning]);

  const isNonPlayer = !player || player.lives <= 0;
  const submitted = player?.submitted ?? false;
  useEffect(() => {
    if (!game) return;
    if (game.timer !== 0) {
      autoSubmitted.current = false;
      return;
    }
    // The submitted check also keeps every other player's client, which sees the same
    // `timer: 0`, from calling in at all.
    if (isNonPlayer || submitted || autoSubmitted.current) return;
    autoSubmitted.current = true;
    submitCards(game, () => setPickedSlot(0));
  }, [game, isNonPlayer, submitted]);

  if (!game) return null;

  const timeLeft = secondsLeft(game, now);
  const showTimer = timerRunning && !isNonPlayer && !submitted;
  const urgent = timeLeft <= 5;
  // Read by game.css, which colours the panel from it.
  const countdown = showTimer ? (urgent ? 'urgent' : 'running') : undefined;

  const chosen = cardDoc?.chosenCards ?? [];
  const slotIndex = pickedSlot ?? firstEmptySlot(chosen);
  const showCards = game.gamePhase === GameState.PHASE.PROGRAM && !submitted && !isNonPlayer;
  // The hand always shows nine slots; the ones damage took are drawn as lost.
  const hand = [...(cardDoc?.handCards ?? [])];
  while (hand.length < CardLogic._MAX_NUMBER_OF_CARDS) hand.push(CardLogic.DAMAGE);
  const chosenIds = new Set(chosen.filter((id) => id !== CardLogic.EMPTY));

  const onHandClick = (card: UICard) => {
    if (card.chosen) return;
    if (!player || player.submitted) return;
    if (chosen[slotIndex] !== CardLogic.EMPTY) return;

    setPickedSlot(nextEmptySlot(chosen, slotIndex));
    selectCard({ gameId: player.gameId, card: card.cardId, index: slotIndex }).catch((error) =>
      modalAlert(error.reason)
    );

    // Any action but "play cards" cancels an announced power down.
    if (player.isPoweredDown()) {
      togglePowerDown({ gameId: player.gameId }).catch((error) => modalAlert(error.reason));
    }
  };

  const onRegisterClick = (card: UICard) => {
    if (card.slot === undefined || !player || player.submitted) return;
    if (chosen[card.slot] === CardLogic.EMPTY) {
      setPickedSlot(card.slot);
      return;
    }
    if (card.locked) return;
    deselectCard({ gameId: player.gameId, index: card.slot }).catch((error) =>
      modalAlert(error.reason)
    );
    setPickedSlot(card.slot);
  };

  const onPowerClick = () => {
    togglePowerDown({ gameId: game._id }).then(
      (powerState) => {
        // Kept from the template. `togglePowerDownAsync` never returns OFF — it only ever
        // toggles ON ↔ DOWN, and OFF → ON — so this branch has never run.
        if (powerState === GameLogic.OFF && player) {
          setPickedSlot(0);
          deselectAllCards({ gameId: player.gameId }).catch((error) => modalAlert(error.reason));
        }
      },
      (error) => modalAlert(error.reason)
    );
  };

  const canSubmit = player !== undefined && (player.chosenCardsCnt === 5 || player.isPoweredDown());
  const onPlayClick = (event: MouseEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    submitCards(game, () => setPickedSlot(0));
  };

  return (
    <div data-countdown={countdown}>
      <div className="flex items-center justify-center gap-3">
        <h3 className="mt-0 mb-0 text-2xl">{phaseLabel(game, player, userId)}</h3>
        {!isNonPlayer && timeLeft > 0 && (
          <span
            className={`${TIMER_PILL} ${urgent ? TIMER_URGENT : TIMER_CALM}`}
            aria-label={`${timeLeft} seconds left`}
          >
            {timeLeft}
          </span>
        )}
      </div>
      <hr className="star-well mt-3 mb-7" />
      {player && showCards ? (
        // `player-robot`, `hand` and `playing` are contract: the browser journey programs
        // its five cards through them.
        <div className="player-robot">
          <p className={EYEBROW}>Your hand</p>
          <div className={`hand ${GRID}`}>
            {addUIData(hand, true, false, false, playerCnt, chosenIds).map((card, index) => (
              // Keyed by card, so the deal replaces the placeholder nodes rather than
              // cross-fading each one into a card through the stylesheet's transition.
              <Card
                key={card.class ? card.cardId : `lost-${index}`}
                card={card}
                // A slot lost to damage has no card and, as in the template, no handler.
                onClick={card.class ? () => onHandClick(card) : undefined}
              />
            ))}
          </div>
          <div className="mt-4">
            <PlayerHeader player={player} own checkpointCnt={checkpointCnt} />
          </div>
          <p className={`${EYEBROW} mt-4`}>Registers</p>
          {player.isPoweredDown() ? (
            <div className="mt-2">
              <p className="mb-0 text-base">Your robot is powered down</p>
              <p className="mb-0 text-xs text-muted">
                Click the play cards button to stay powered down, any other action will cancel the
                power down.
              </p>
            </div>
          ) : (
            <div className={`playing ${GRID}`}>
              {addUIData(chosen, false, player.lockedCnt(), true, playerCnt).map((card) => (
                // Keyed by slot and content, as the template's per-item nodes were: a slot
                // that fills or empties is a new node, not a transition between two looks.
                <Card
                  key={`${card.slot}-${card.cardId}`}
                  card={card}
                  selected={card.slot === slotIndex}
                  timeLeft={timeLeft}
                  onClick={() => onRegisterClick(card)}
                />
              ))}
            </div>
          )}
          <OptionCards optionCards={player.optionCards} />
          <div className="play-buttons mt-4 flex justify-center gap-3">
            <button
              type="button"
              className={`${BTN} ${powerButton(player.powerState)[1]}`}
              onClick={onPowerClick}
            >
              {powerButton(player.powerState)[0]}
            </button>
            {/* `a.playBtn` and its `disabled` class are contract: the browser journey waits
                for the class to go and then clicks the anchor. */}
            <a
              href="#"
              className={`${BTN} ${canSubmit ? PRIMARY : PRIMARY_OFF} playBtn`}
              aria-disabled={!canSubmit}
              onClick={onPlayClick}
            >
              Play cards
            </a>
          </div>
        </div>
      ) : (
        player && (
          <div className="player-robot">
            <PlayerStatus
              player={player}
              game={game}
              own
              checkpointCnt={checkpointCnt}
              playerCnt={playerCnt}
            />
          </div>
        )
      )}
      {player && <hr className="star-well mt-7 mb-7" />}
      {others.map((other) => (
        <div key={other._id} className="other-robot mt-3 rounded-control bg-raised px-3 py-2.5">
          <PlayerStatus
            player={other}
            game={game}
            own={false}
            checkpointCnt={checkpointCnt}
            playerCnt={playerCnt}
          />
        </div>
      ))}
    </div>
  );
}

// The round number lets the server reject this call if it arrives after the turn it was
// meant for (queued duplicate, or a Meteor retry after a reconnect).
function submitCards(game: Game, done: () => void) {
  playCards({ gameId: game._id, programRound: game.programRound }).then(done, (error) => {
    done();
    modalAlert(error.reason);
  });
}
