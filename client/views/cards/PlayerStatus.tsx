// One player's row on the card panel: robot, name, lives and damage, the next checkpoint,
// then the five register slots as the rest of the table sees them, the status pill and
// any option cards. Replaces the `playerStatus` template. `PlayerHeader` and
// `OptionCards` are exported because the card panel also puts them around the player's
// own hand, where the template repeated the markup.
import { CardLogic } from '../../../both/cardlogic.ts';
import { GameLogic } from '../../../both/gamelogic.ts';
import { GameState } from '../../../both/gamestate.ts';
import type { Game } from '../../../collections/games.ts';
import type { Player } from '../../../collections/players.ts';
import { addUIData } from '../../lib/cardUI.ts';
import { Heart } from '../icons/Heart.tsx';
import { Power } from '../icons/Power.tsx';
import { Card } from './Card.tsx';

export const EYEBROW = 'text-xs font-semibold tracking-[.08em] text-muted uppercase';
const PILL =
  'inline-flex h-[22px] items-center rounded-full px-2.5 text-xs font-bold tracking-[.06em] whitespace-nowrap text-white uppercase';
const PILL_BRAND = 'bg-brand';
const PILL_DANGER = 'bg-danger';
const CHIP =
  'inline-flex h-[26px] items-center rounded-full border border-line bg-raised px-2.5 text-xs';
const META = 'flex items-center justify-center gap-1.5 text-xs whitespace-nowrap text-muted';
const CHECKPOINT =
  'inline-flex h-5 w-5 items-center justify-center rounded-full bg-checkpoint text-xs leading-none font-bold text-white';

/** Three hearts, filled up to the life count. */
function Lives({ lives }: { lives: number }) {
  return (
    <span role="img" aria-label={`${lives} of 3 lives`} className="inline-flex gap-0.5 text-heart">
      {[0, 1, 2].map((i) => (
        <Heart key={i} filled={i < lives} size={16} />
      ))}
    </span>
  );
}

function NextCheckpoint({ player, checkpointCnt }: { player: Player; checkpointCnt: number }) {
  if (player.visited_checkpoints >= checkpointCnt) {
    return (
      <>
        <span>WINNER!</span>
        <img className="h-[35px] w-[35px]" src="/trophy.png" alt="Trophy" draggable={false} />
      </>
    );
  }
  const headingForFinish = player.visited_checkpoints === checkpointCnt - 1;
  return (
    <>
      <span>next</span>
      {headingForFinish ? (
        <img className="h-[35px] w-[35px]" src="/finish.png" alt="the finish" draggable={false} />
      ) : (
        <span className={CHECKPOINT}>
          {Math.min(checkpointCnt, player.visited_checkpoints + 1)}
        </span>
      )}
    </>
  );
}

export interface PlayerHeaderProps {
  player: Player;
  own: boolean;
  checkpointCnt: number;
}

export function PlayerHeader({ player, own, checkpointCnt }: PlayerHeaderProps) {
  return (
    // Two centred lines, so a long name is never cut short: robot, name and hearts, then
    // the damage and next-checkpoint readout under them.
    <div className="flex flex-col items-center gap-1">
      {/* The hearts drop to a line of their own when the robot and the name have taken the
          width. Robot and name are one flex item so the wrap can only fall between the name
          and the hearts, never between the robot and the name; `wrap-anywhere` is what lets
          the name itself break, since a long one is a single unbreakable run of digits. */}
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
        <span className="flex min-w-0 items-center gap-2.5">
          <img
            className="h-7 w-7 shrink-0"
            src={`/robots/robot_${player.robotId}.png`}
            alt=""
            draggable={false}
          />
          <span className="text-sm font-semibold wrap-anywhere">
            {own ? 'Your robot' : player.name}
          </span>
        </span>
        <Lives lives={player.lives} />
      </div>
      <span className={META}>
        <span>{player.lives <= 0 ? 'unrepairable' : `${player.damage * 10}% damaged`}</span>
        <span aria-hidden="true">·</span>
        <NextCheckpoint player={player} checkpointCnt={checkpointCnt} />
      </span>
    </div>
  );
}

export function OptionCards({ optionCards }: { optionCards: object }) {
  // A name the option deck no longer has is not drawn at all. The server strips those from
  // the player's row at boot; this covers the copy a client is already holding, and keeps
  // the description lookup below — which throws on an unknown name — off it.
  const names = Object.keys(optionCards).filter((name) => CardLogic.isOptionCard(name));
  if (names.length === 0) return null;
  return (
    <div className="option-cards mt-3">
      <p className={`${EYEBROW} mb-1.5`}>Option cards</p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {names.map((name) => (
          <span key={name} className={CHIP} title={CardLogic.getOptionDesc(name)}>
            {CardLogic.getOptionTitle(name)}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface PlayerStatusProps {
  player: Player;
  game: Game;
  own: boolean;
  checkpointCnt: number;
  // Which deck the card ids index — `addUIData` needs it to name a card's type.
  deckSize: number;
}

export function PlayerStatus({ player, game, own, checkpointCnt, deckSize }: PlayerStatusProps) {
  const alive = player.lives > 0;
  const cards = alive ? addUIData(player.cards, false, player.lockedCnt(), false, deckSize) : [];
  const powerDownPlayed = alive && player.powerState === GameLogic.DOWN;
  const programming = game.gamePhase === GameState.PHASE.PROGRAM;

  // The template's three-way `{{#if}}`, in its order.
  let pill: [string, string] | null = null;
  if (!alive) {
    pill = ['no archives', PILL_DANGER];
  } else if (player.powerState === GameLogic.OFF && (!programming || player.submitted)) {
    pill = ['powered down', PILL_BRAND];
  } else if (player.submitted && programming) {
    pill = ['submitted', PILL_BRAND];
  }
  // A robot powered down for the turn holds no program: the deal skipped it and its
  // slots are five blanks. The pill says so; the template drew the blanks as well.
  const showRegister = pill?.[0] !== 'powered down' && (cards.length > 0 || powerDownPlayed);

  return (
    <>
      <PlayerHeader player={player} own={own} checkpointCnt={checkpointCnt} />
      {showRegister && (
        // `smallhand` is contract: the browser journey counts `.player-robot .smallhand
        // .gamecard.played` to see a register resolve. Six columns make room for the
        // announced power-down card; the pill below never shares the row with it.
        <div
          className={`smallhand mt-2 grid gap-1.5 ${powerDownPlayed ? 'grid-cols-6' : 'grid-cols-5'}`}
        >
          {cards.map((card, index) => (
            // Slot and content, so a reveal replaces the covered node instead of fading.
            <Card key={`${index}-${card.cardId}`} card={card} />
          ))}
          {powerDownPlayed && (
            <div className="gamecard powerdown" role="img" aria-label="Power down announced">
              <Power />
            </div>
          )}
        </div>
      )}
      {pill && (
        <div className="mt-2">
          <span className={`${PILL} ${pill[1]}`}>{pill[0]}</span>
        </div>
      )}
      <OptionCards optionCards={player.optionCards} />
    </>
  );
}
