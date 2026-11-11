// How a finished game ended, as a sentence fragment, with the winner's current name.
import { hasWinner } from '../../lib/adminGames.ts';
import type { AdminGameDoc } from '../../lib/adminGames.ts';
import { UserName } from '../users/UserName.tsx';

export function WonBy({ game }: { game: AdminGameDoc }) {
  if (!hasWinner(game)) return <>nobody won</>;
  // `winner!`: hasWinner has just said it is there.
  return (
    <>
      won by <UserName userId={game.winnerUserId} name={game.winner!} />
    </>
  );
}
