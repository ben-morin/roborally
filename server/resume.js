// The sweep behind the `Recover stalled turns` cron job. Every claim in the turn chain
// stamps `lastStepAt` on the game document (see `advanceAsync` in collections/games.js);
// a started game whose stamp is older than STALL_MS has lost its driver — the process
// died, or a deploy replaced it — and is handed to `GameState.resumeAsync`, which knows
// what re-entry means for the phase the game is in.
//
// Only server-driven states count. PROGRAM with players still programming and RESPAWN
// with options on the table are a human's move and are never swept, however long the
// human takes. What can stall is a deal or a play segment, a respawn whose options were
// never written, or a program phase where everyone has submitted and nobody drove on.
import { GameState } from '../both/gamestate.js';
import { Games } from '../collections/games.js';

// How long a game may go without a claim before its driver is presumed dead. The longest
// gap between two claims in a live turn is one card with a push chain and two deaths,
// about 6 s; this is ten times that, so a live-but-slow driver is never mistaken for a
// dead one. Exported for the tests.
export const STALL_MS = 60_000;

const RESUME_FAILED_CHAT = 'The turn could not be resumed — the server will try again shortly.';

// Could this game, stalled, be waiting on the server rather than on a human? Decided from
// the game document alone, so it is pure and cheap. PROGRAM passes: whether every living
// player has submitted takes the Players, and resumeAsync makes that call — and leaves
// the game untouched when someone is still programming.
export function needsDriver(game) {
  switch (game.gamePhase) {
    case GameState.PHASE.DEAL:
    case GameState.PHASE.PLAY:
    case GameState.PHASE.PROGRAM:
      return true;
    case GameState.PHASE.RESPAWN:
      return game.selectOptions == null;
    default:
      // IDLE never has `started: true`; ENDED has nothing to drive.
      return false;
  }
}

// Resolves once every stalled game has been handed off — to one promise per game, each
// settling when that game's replay ends and never rejecting (see resumeOne). The cron job
// awaits only the hand-off: awaiting the replays would hold the job for the rest of the
// turn and push back the next tick. The tests await the array.
export async function resumeStalledTurnsAsync({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - STALL_MS);
  // A `lastStepAt` of null — a game created or backfilled before its first claim — never
  // satisfies `$lt`, in Mongo as in the test fake, so such a game is never swept. Nothing
  // could restore it anyway: it has no snapshot.
  const stalled = await Games.find(
    { started: true, lastStepAt: { $lt: cutoff } },
    { fields: { gamePhase: 1, selectOptions: 1 } }
  ).fetchAsync();
  return stalled.filter(needsDriver).map((game) => resumeOne(game._id));
}

// Fire-and-forget, so the catch is load-bearing: without it a failed replay is an
// unhandled rejection. It cannot recover — but the game's `lastStepAt` was touched at the
// start of the attempt, so once that is STALL_MS old again the next sweep tries once more.
// The gameId is in the log line because it is the only trace such a game leaves.
function resumeOne(gameId) {
  console.log(`Resuming stalled turn for game ${gameId}`);
  return GameState.resumeAsync(gameId).catch(async (err) => {
    console.error(`resumeAsync failed for game ${gameId}`, err);
    // Say so in the game chat: without this the turn simply stops and the players have
    // no idea why. Guarded because the likeliest reason for getting here is that the
    // game no longer exists.
    try {
      const game = await Games.findOneAsync(gameId);
      await game?.chatAsync(RESUME_FAILED_CHAT);
    } catch (announceErr) {
      console.error(`could not announce resume failure for ${gameId}`, announceErr);
    }
  });
}
