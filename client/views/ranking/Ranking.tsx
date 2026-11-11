// The ranking: one list at a time, its top three on a podium and the rest in rows under it.
// Both lists are rebuilt server-side into one collection and told apart by `type`.
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useFind } from 'meteor/react-meteor-data';
import { Highscores } from '../../../collections/highscores.ts';
import { rankPlaces } from '../../lib/ranking.ts';
import type { Medal } from '../../lib/ranking.ts';
import { Crown } from '../icons/Crown.tsx';

interface List {
  type: string;
  label: string;
  one: string;
  many: string;
  empty: string;
}

const LISTS: List[] = [
  {
    type: 'mostWon',
    label: 'Most wins',
    one: 'win',
    many: 'wins',
    empty: 'Nobody has won a game yet.',
  },
  {
    type: 'mostPlayed',
    label: 'Most games',
    one: 'game',
    many: 'games',
    empty: 'Nobody has played a game yet.',
  },
];

// Board select's pill tabs.
const TABLIST = 'inline-flex gap-1 rounded-full bg-raised p-1';
const TAB =
  'h-9 cursor-pointer rounded-full border-0 px-[18px] text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const TAB_ACTIVE = 'bg-teal text-navy';
const TAB_IDLE = 'bg-transparent text-white/70 hover:bg-raised-hover hover:text-white';

const PODIUM = 'mx-auto mt-10 mb-0 grid w-full max-w-150 list-none grid-cols-3 items-end gap-4 p-0';
const PLACE = 'flex min-w-0 flex-col items-center';
const COUNT = 'font-display font-bold tabular-nums';
const UNIT = 'text-xs font-semibold tracking-[.08em] text-muted uppercase';
const STEP =
  'mt-3.5 flex w-full items-center justify-center rounded-t-[10px] border-t-[3px] font-display font-bold';
const EMPTY_STEP = 'w-full rounded-t-[10px] border-t-[3px] border-line bg-raised';
const FLOOR = 'mx-auto h-px w-full max-w-160 bg-line';
const ROWS = 'mx-auto mt-7 mb-0 flex w-full max-w-160 list-none flex-col gap-2 p-0 text-left';
const ROW =
  'relative grid h-11 grid-cols-[40px_minmax(0,1fr)_auto] items-center overflow-hidden rounded-control bg-raised px-4 text-base';
const SHARE = 'absolute inset-y-0 left-0 bg-teal/16';
const ROW_RANK = 'relative font-display text-[15px] font-bold text-muted tabular-nums';
const ROW_NAME = 'relative truncate font-semibold';
const ROW_COUNT = 'relative tabular-nums';
const ROW_UNIT = 'text-[13px] text-muted';
const NOTE = 'mt-10 mb-0 text-base text-muted';

// Each medal carries the whole of its own look, so places that tie stand alike: the robot,
// the name, the count and the step.
const MEDALS: Record<
  Medal,
  { robot: string; size: number; name: string; count: string; step: string }
> = {
  gold: {
    robot: '/robots/robot_0.png',
    size: 120,
    name: 'text-xl font-bold',
    count: 'text-[40px] text-medal-gold',
    step: 'h-34 border-medal-gold bg-medal-gold/16 text-[56px] text-medal-gold',
  },
  silver: {
    robot: '/robots/robot_4.png',
    size: 88,
    name: 'text-[17px] font-semibold',
    count: 'text-[28px] text-medal-silver',
    step: 'h-24 border-medal-silver bg-medal-silver/14 text-[44px] text-medal-silver',
  },
  bronze: {
    robot: '/robots/robot_7.png',
    size: 88,
    name: 'text-[17px] font-semibold',
    count: 'text-[28px] text-medal-bronze',
    step: 'h-17 border-medal-bronze bg-medal-bronze/14 text-4xl text-medal-bronze',
  },
};

// The three podium places in list order. `order` draws them 2nd, 1st, 3rd, so the winner
// stands in the middle while a screen reader still meets them best first. A place nobody
// holds yet keeps its bare step.
const STEPS = [
  { order: 'order-2', empty: 'h-34' },
  { order: 'order-1', empty: 'h-24' },
  { order: 'order-3', empty: 'h-17' },
];

export function Ranking() {
  const [shown, setShown] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = LISTS[shown];
  const rows = useFind(
    () => Highscores.find({ type: list.type }, { sort: { rank: 1 } }),
    [list.type]
  );
  const places = rankPlaces(rows);
  const unit = (value: number) => (value === 1 ? list.one : list.many);

  function onTabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + LISTS.length) % LISTS.length;
    setShown(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <h2 className="mt-0 text-3xl">Ranking</h2>
      <hr className="star-well mt-3 mb-7" />
      <div role="tablist" aria-label="Ranking lists" className={TABLIST}>
        {LISTS.map((item, index) => (
          <button
            key={item.type}
            type="button"
            role="tab"
            id={`ranking-tab-${item.type}`}
            aria-selected={index === shown}
            aria-controls="ranking-list"
            // Roving tabindex: the tablist is one stop, and the arrows move within it.
            tabIndex={index === shown ? 0 : -1}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            className={`${TAB} ${index === shown ? TAB_ACTIVE : TAB_IDLE}`}
            onClick={() => setShown(index)}
            onKeyDown={(event) => onTabKeys(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="ranking-list" aria-labelledby={`ranking-tab-${list.type}`}>
        {places.length === 0 ? (
          <p className={NOTE}>{list.empty}</p>
        ) : (
          <>
            <ol className={PODIUM}>
              {STEPS.map((slot, index) => {
                const place = places[index];
                if (!place) {
                  return (
                    <li key={slot.order} className={`${PLACE} ${slot.order}`} aria-hidden="true">
                      <div className={`${EMPTY_STEP} ${slot.empty}`} />
                    </li>
                  );
                }
                // `!`: a place among the first three ranks 1 to 3, and each of those has a medal.
                const medal = MEDALS[place.medal!];
                return (
                  <li key={place._id} className={`${PLACE} ${slot.order}`}>
                    {place.medal === 'gold' && <Crown size={32} className="text-medal-gold" />}
                    <img
                      src={medal.robot}
                      alt=""
                      width={medal.size}
                      height={medal.size}
                      draggable={false}
                      className="mt-1"
                    />
                    <span className={`mt-2.5 max-w-full truncate ${medal.name}`}>{place.name}</span>
                    <span className="mt-0.5 flex items-baseline gap-1.5">
                      <span className={`${COUNT} ${medal.count}`}>{place.value}</span>
                      <span className={UNIT}>{unit(place.value)}</span>
                    </span>
                    <span className={`${STEP} ${medal.step}`}>{place.rank}</span>
                  </li>
                );
              })}
            </ol>
            <div className={FLOOR} />
            {places.length > STEPS.length && (
              <ol className={ROWS}>
                {places.slice(STEPS.length).map((place) => (
                  <li key={place._id} className={ROW}>
                    <span
                      aria-hidden="true"
                      className={SHARE}
                      style={{ width: `${place.share}%` }}
                    />
                    <span className={ROW_RANK}>{place.rank}</span>
                    <span className={ROW_NAME}>{place.name}</span>
                    <span className={ROW_COUNT}>
                      {place.value} <span className={ROW_UNIT}>{unit(place.value)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </>
  );
}
