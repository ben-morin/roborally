// A bare board for phase-machine tests: no walls, belts, lasers or pits, so a robot's fate
// follows from its cards alone. It carries one checkpoint nobody can reach — on an empty
// board `checkpoints` would be `[]`, a fresh player's `visited_checkpoints` (0) would
// equal its length, and checkIfWeHaveAWinner would end the game on the first CHECKPOINTS
// phase. Installed through a spy on BoardBox.getBoard, so vi.restoreAllMocks() removes it.
import { vi } from 'vitest';
import { Board } from '../../both/board.ts';
import { BoardBox } from '../../both/board_box.ts';

export function stubBoard(width = 6, height = 6) {
  const board = new Board('stub-board', 1, 8, width, height);
  board.checkpoints = [{ x: -1, y: -1, number: 1 }];
  vi.spyOn(BoardBox, 'getBoard').mockReturnValue(board);
  return board;
}
