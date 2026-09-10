// @vitest-environment jsdom
// One player's row on the card panel: the header, the five register slots as the table
// sees them, the status pill and the option chips. Rendered against real transform-wrapped
// documents from FakeCollection, so `lockedCnt()` and friends are the production ones.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PlayerStatus } from '../../client/views/cards/PlayerStatus.tsx';
import { CardLogic } from '../../both/cardlogic.ts';
import { GameLogic } from '../../both/gamelogic.ts';
import { GameState } from '../../both/gamestate.ts';
import type { Game } from '../../collections/games.ts';
import type { Player } from '../../collections/players.ts';
import { insertGame, insertPlayer } from '../helpers/fixtures.js';
import { resetFakeCollections } from '../setup.js';

const E = CardLogic.EMPTY;
const C = CardLogic.COVERED;
const TURN_RIGHT = 6;

let game: Game;
let checkpointCnt: number;

beforeEach(async () => {
  resetFakeCollections();
  // The fixture reads the document straight back, so there is always one.
  game = (await insertGame())!;
  checkpointCnt = game.board().checkpoints.length;
});
afterEach(cleanup);

async function renderRow(overrides: Record<string, unknown> = {}, own = false) {
  const player = (await insertPlayer(game._id, {
    userId: 'them',
    name: 'them',
    robotId: '2',
    ...overrides,
  }))!;
  return render(
    <PlayerStatus
      player={player as Player}
      game={game}
      own={own}
      checkpointCnt={checkpointCnt}
      deckSize={84}
    />
  );
}

const pill = () => document.querySelector('.rounded-full.uppercase');

describe('PlayerStatus', () => {
  it('names the caller "Your robot" and everyone else by name', async () => {
    const { unmount } = await renderRow({}, true);
    expect(screen.getByText('Your robot')).toBeInTheDocument();
    unmount();

    await renderRow();
    expect(screen.getByText('them')).toBeInTheDocument();
  });

  it('shows the robot, the lives and the damage', async () => {
    const { container } = await renderRow({ lives: 2, damage: 3 });

    expect(container.querySelector('img')).toHaveAttribute('src', '/robots/robot_2.png');
    // An `<img>` drags by default, which lifts a ghost image out of the window.
    expect(container.querySelector('img')).toHaveAttribute('draggable', 'false');
    expect(screen.getByRole('img', { name: '2 of 3 lives' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-icon="heart"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-icon="heart-outline"]')).toHaveLength(1);
    expect(screen.getByText('30% damaged')).toBeInTheDocument();
  });

  it('renders the register as the table sees it, and hides it once the player is out', async () => {
    const { container, unmount } = await renderRow({ cards: [TURN_RIGHT, C, C, C, C] });
    const cards = container.querySelectorAll('.smallhand .gamecard');
    expect(cards).toHaveLength(5);
    expect(cards[0]).toHaveClass('turn-right', 'played');
    expect(cards[1]).toHaveClass('covered');
    unmount();

    const dead = await renderRow({ lives: 0, cards: [TURN_RIGHT, C, C, C, C] });
    expect(dead.container.querySelector('.smallhand')).not.toBeInTheDocument();
    expect(screen.getByText('unrepairable')).toBeInTheDocument();
    expect(pill()).toHaveTextContent('no archives');
  });

  it('marks the locked tail of a damaged register', async () => {
    // lockedCnt() = max(0, 5 + damage - 9); damage 5 locks the last slot.
    const { container } = await renderRow({ damage: 5, cards: [C, C, C, C, TURN_RIGHT] });

    const cards = container.querySelectorAll('.smallhand .gamecard');
    expect(cards[4]).toHaveClass('locked');
    expect(cards[4].querySelector('img.locked')).toBeInTheDocument();
  });

  it('points at the next checkpoint, then the finish, then the trophy', async () => {
    const early = await renderRow({ visited_checkpoints: 1 });
    expect(screen.getByText('next')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    early.unmount();

    const nearly = await renderRow({ visited_checkpoints: checkpointCnt - 1 });
    expect(screen.getByAltText('the finish')).toHaveAttribute('draggable', 'false');
    nearly.unmount();

    await renderRow({ visited_checkpoints: checkpointCnt });
    expect(screen.getByText('WINNER!')).toBeInTheDocument();
    expect(screen.getByAltText('Trophy')).toHaveAttribute('draggable', 'false');
  });

  it('shows the submitted pill during programming only', async () => {
    const programming = await renderRow({ submitted: true, cards: [C, C, C, C, C] });
    expect(pill()).toHaveTextContent('submitted');
    programming.unmount();

    game = (await insertGame({ gamePhase: GameState.PHASE.PLAY }))!;
    await renderRow({ submitted: true, cards: [C, C, C, C, C] });
    expect(pill()).not.toBeInTheDocument();
  });

  it('appends the power-down card to an announced power down and widens the row for it', async () => {
    const { container } = await renderRow({
      powerState: GameLogic.DOWN,
      cards: [C, C, C, C, C],
    });

    const row = container.querySelector('.smallhand')!;
    expect(row).toHaveClass('grid-cols-6');
    expect(row.querySelectorAll('.gamecard')).toHaveLength(6);
    expect(row.lastElementChild).toHaveClass('powerdown');
    // Announced but not yet submitted: no pill.
    expect(pill()).not.toBeInTheDocument();
  });

  it('labels a robot that is powered down this turn', async () => {
    const waiting = await renderRow({ powerState: GameLogic.OFF, submitted: false });
    // During programming the label waits for the submit, as the template's did.
    expect(pill()).not.toBeInTheDocument();
    waiting.unmount();

    const submitted = await renderRow({ powerState: GameLogic.OFF, submitted: true });
    expect(pill()).toHaveTextContent('powered down');
    // The deal skipped this robot, so there is no program to show.
    expect(submitted.container.querySelector('.smallhand')).not.toBeInTheDocument();
    submitted.unmount();

    game = (await insertGame({ gamePhase: GameState.PHASE.PLAY }))!;
    await renderRow({ powerState: GameLogic.OFF, submitted: false });
    expect(pill()).toHaveTextContent('powered down');
  });

  it('lists the option cards the player holds, with the description as the tooltip', async () => {
    const none = await renderRow();
    expect(screen.queryByText('Option cards')).not.toBeInTheDocument();
    none.unmount();

    await renderRow({ optionCards: { extra_memory: true } });
    expect(screen.getByText('Option cards')).toBeInTheDocument();
    const chip = screen.getByText(CardLogic.getOptionTitle('extra_memory'));
    expect(chip).toHaveAttribute('title', CardLogic.getOptionDesc('extra_memory'));
  });

  it('draws five empty slots for a register nothing has gone into yet', async () => {
    const { container } = await renderRow({ cards: [E, E, E, E, E] });

    // Five empty slots are still a register the table can see.
    expect(container.querySelectorAll('.smallhand .gamecard.empty')).toHaveLength(5);
    expect(pill()).not.toBeInTheDocument();
  });
});
