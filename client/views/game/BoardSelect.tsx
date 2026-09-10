// The board catalog, split into three categories, with the game's current board ringed.
// Replaces the `boardselect` template, whose three pill tabs are component state here.
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { BoardBox } from '../../../both/board_box.ts';
import { selectBoard } from '../../../both/methods/games.ts';
import { Games } from '../../../collections/games.ts';
import { PREVIEW_TILE_SIZE, Thumbnail } from '../board/Thumbnail.tsx';
import { modalAlert } from '../../helper/modalDialogs.ts';
import { paths } from '../routes.ts';
import { useRouteParam } from '../useRouteParam.ts';

type Category = 'beginner' | 'expert' | 'custom';

// The selected and idle halves below carry the whole of their own colour for the same reason a
// component splits a variant: two utilities for one property are ordered by the generated
// stylesheet, not by the order they are written in the class attribute.
const TABLIST = 'inline-flex gap-1 rounded-full bg-raised p-1';
const TAB =
  'h-9 cursor-pointer rounded-full border-0 px-[18px] text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const TAB_ACTIVE = 'bg-teal text-navy';
const TAB_IDLE = 'bg-transparent text-white/70 hover:bg-raised-hover hover:text-white';
// The design's three columns need an 836px panel; the Blaze layout's `col-lg-8` gives 743,
// so the track count comes off the width and becomes three when step 9 widens the panel.
// `justify-items-center` sizes each choice to its own thumbnail rather than to the track.
const GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(268px,1fr))] justify-items-center gap-x-4 gap-y-5 [&_h4]:text-base [&_h4]:font-semibold [&_span]:text-[13px] [&_span]:text-muted';
const CHOICE =
  'boardchoice cursor-pointer rounded-panel border-[2px] p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const CHOICE_SELECTED = 'border-teal [&_h4]:text-teal';
const CHOICE_IDLE = 'border-transparent hover:bg-raised';

/** The catalog's three ranges, in tab order. */
function categories() {
  return [
    {
      id: 'beginner' as const,
      label: 'Beginner courses',
      from: 0,
      to: BoardBox.BEGINNER_COURSE_CNT,
    },
    {
      id: 'expert' as const,
      label: 'Expert courses',
      from: BoardBox.BEGINNER_COURSE_CNT,
      to: BoardBox.CUSTOM_COURSE_IDX,
    },
    {
      id: 'custom' as const,
      label: 'Custom courses',
      from: BoardBox.CUSTOM_COURSE_IDX,
      to: BoardBox.CATALOG.length,
    },
  ];
}

/** Which tab holds a board — the same two thresholds the Blaze helpers used. */
function categoryOf(boardId: number | undefined): Category {
  if (boardId === undefined) return 'beginner';
  if (boardId >= BoardBox.CUSTOM_COURSE_IDX) return 'custom';
  if (boardId >= BoardBox.BEGINNER_COURSE_CNT) return 'expert';
  return 'beginner';
}

export function BoardSelect() {
  const gameId = useRouteParam('_id');
  const navigate = useNavigate();
  useSubscribe('games');
  const game = useTracker(() => (gameId ? Games.findOne(gameId) : undefined), [gameId]);

  // Null until the reader picks a tab, so the game decides which one opens — the game
  // document arrives after the first render, and the Blaze helper re-ran when it did.
  const [picked, setPicked] = useState<Category | null>(null);
  const active = picked ?? categoryOf(game?.boardId);

  const tabs = categories();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onTabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + tabs.length) % tabs.length;
    setPicked(tabs[next].id);
    tabRefs.current[next]?.focus();
  }

  function onChoose(boardName: string) {
    if (!game) return;
    selectBoard({ boardName, gameId: game._id }).then(
      () => navigate(paths.lobby(game._id)),
      (error) => modalAlert(error.reason)
    );
  }

  const shown = tabs.find((tab) => tab.id === active) ?? tabs[0];
  const boards = [];
  // No game means nothing to select against, exactly as the Blaze helper's empty list did.
  if (game) {
    for (let i = shown.from; i < shown.to; i++) {
      boards.push({ index: i, board: BoardBox.getBoard(i) });
    }
  }

  return (
    <>
      <h3 className="mt-0 text-3xl">Select board</h3>
      <hr className="star-well mt-3 mb-7" />
      <div role="tablist" aria-label="Course categories" className={TABLIST}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === active}
            aria-controls="boardchoices"
            // Roving tabindex: the tablist is one stop, and the arrows move within it.
            tabIndex={tab.id === active ? 0 : -1}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            className={`${TAB} ${tab.id === active ? TAB_ACTIVE : TAB_IDLE}`}
            onClick={() => setPicked(tab.id)}
            onKeyDown={(event) => onTabKeys(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="boardchoices"
        aria-labelledby={`tab-${active}`}
        className={`${GRID} mt-5`}
      >
        {boards.map(({ index, board }) => (
          // A div rather than a button because the choice holds a heading; the role and
          // the key handler are what the Blaze version's bare click target never had.
          <div
            key={board.name}
            role="button"
            tabIndex={0}
            aria-current={index === game?.boardId ? 'true' : undefined}
            className={`${CHOICE} ${index === game?.boardId ? CHOICE_SELECTED : CHOICE_IDLE}`}
            onClick={() => onChoose(board.name)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onChoose(board.name);
            }}
          >
            <Thumbnail
              board={board}
              width={board.width * PREVIEW_TILE_SIZE}
              height={board.height * PREVIEW_TILE_SIZE}
              extraClass="mx-auto overflow-hidden rounded-sm"
            />
          </div>
        ))}
      </div>
    </>
  );
}
