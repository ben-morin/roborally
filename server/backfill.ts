// Every one-time repair to documents already in the database, run once from
// `Meteor.startup` in server/cron.ts before the cron jobs start and before a client can
// reach a method. Each one is idempotent: it selects on the very field it fills in, so a
// second boot finds nothing to do. A repair that is no longer needed can be deleted here
// without touching the entry point.
import type { Mongo } from 'meteor/mongo';
import { CardLogic } from '../both/cardlogic.ts';
import { getUsername } from '../both/permissions.ts';
import { shuffle } from '../both/shuffle.ts';
import { BoardBox } from '../both/board_box.ts';
import { Decks } from '../collections/deck.ts';
import { Games, type GameDoc, type SegmentSnapshot } from '../collections/games.ts';
import { Players } from '../collections/players.ts';
import { endGameOnGoneBoardAsync } from './resume.ts';

// The order matters where one repair reads what an earlier one wrote; each such edge is
// noted at the call.
export async function backfillAsync() {
  await backfillProfileNamesAsync();
  await backfillStepAsync();
  await backfillDeckSizeAsync();
  await backfillBoardNamesAsync();

  // Five fields on the game and one on the player used to be `Optional(AnyOf(X, Null))`
  // and are now required keys that may be null. A document written before that has the
  // key missing, and a whole document is checked against the whole schema: the first
  // `player.saveAsync()` or snapshot restore on such a player would throw a
  // `ValidationError`, which is `isClientSafe` — so nothing is logged and the turn simply
  // stops.
  await seedNullKeys(Games, 'game', [
    'timerStartedAt',
    'respawnPlayerId',
    'respawnUserId',
    'selectOptions',
    'announceCard',
  ]);
  await seedNullKeys(Players, 'player', ['ablativeCoat']);
  await seedSnapshotNullKeys();

  await dropUnknownOptionCardsAsync();
  // After the drop, so every name a hand still holds has an id to look up.
  await rebuildOptionPilesAsync();

  // Before the first `buildHighscores()`, which the caller runs next: the most-won list is
  // grouped on this field.
  await backfillWinnerUserIdsAsync();
}

// Accounts created before display names were stored server-side have no `profile.name`,
// and the publication no longer sends anything a name could be derived from — they
// would show up as blank pills. The `onCreateUser` hook in server/accounts.ts is what
// stamps the name on every account since. Only `emails` is read, so ask for only that.
async function backfillProfileNamesAsync() {
  const legacy = await Meteor.users
    .find({ 'profile.name': { $exists: false } }, { fields: { emails: 1 } })
    .fetchAsync();

  for (const user of legacy) {
    await Meteor.users.updateAsync(user._id, { $set: { 'profile.name': getUsername(user) } });
  }

  if (legacy.length) {
    console.log(`Backfilled profile.name for ${legacy.length} user(s)`);
  }
}

// Games created before resumable turns have no `step`, and `advanceAsync`'s selector can
// never match a missing field — such a game would refuse every write in its turn chain.
async function backfillStepAsync() {
  const backfilled = await Games.updateAsync(
    { step: { $exists: false } },
    { $set: { step: 0, lastStepAt: null } },
    { multi: true }
  );
  if (backfilled > 0) console.log(`Backfilled step on ${backfilled} game(s)`);
}

// Games started before the deck size was stored derive it from their seats. One update
// each, because the size depends on the game's own player count.
async function backfillDeckSizeAsync() {
  for (const game of await Games.find({
    started: true,
    deckSize: { $exists: false },
  }).fetchAsync()) {
    const deckSize = CardLogic.deckSizeFor(await game.playerCntAsync());
    await Games.updateAsync(game._id, { $set: { deckSize } });
    console.log(`Backfilled deckSize ${deckSize} on game ${game._id}`);
  }
}

// `boardId` is the board's position in a list, and a board inserted anywhere but the end
// used to re-point every game after it. This is that list as it stood when the name became
// the key, frozen on purpose: the live catalog's order is display order now and can
// change freely. Nothing but the backfill below and its tests read it.
export const LEGACY_BOARD_ORDER: readonly string[] = [
  'default',
  'risky_exchange',
  'checkmate',
  'dizzy_dash',
  'island_hop',
  'chop_shop_challenge',
  'twister',
  'bloodbath_chess',
  'around_the_world',
  'death_trap',
  'pilgrimage',
  'vault_assault',
  'whirlwind_tour',
  'lost_bearings',
  'robot_stew',
  'oddest_sea',
  'against_the_grain',
  'island_king',
  'tricksy',
  'set_to_kill',
  'factory_rejects',
  'option_world',
  'tight_collar',
  'ball_lightning',
  'flag_fry',
  'crowd_chess',
  'custom_made',
  'quarter_pounder',
  // The two slots past the catalog: `test_board_id` and `dev_test_board_id`.
  'test',
  'dev_test',
];

// Games held their board as `boardId`, a position in a list; the name is the key now. One
// update per game, because the name depends on the game's own id. An id off the end of the
// list, or none at all, read as board 0 back then, so it becomes `default` here too.
export async function backfillBoardNamesAsync() {
  for (const game of await Games.find({ boardName: { $exists: false } }).fetchAsync()) {
    // `boardId` left the schema once every game had a name, so only a document written
    // before that still carries it and the type no longer knows the key.
    const { boardId } = game as GameDoc & { boardId?: number };
    const boardName = LEGACY_BOARD_ORDER[boardId ?? -1] ?? 'default';
    await Games.updateAsync(game._id, { $set: { boardName } });
    console.log(`Backfilled boardName ${boardName} on game ${game._id}`);
  }

  // A board taken out of the catalog has nowhere for a robot to land or move. A started game
  // on one ends here, ahead of the stalled-turn sweep that would otherwise replay it; an
  // unstarted one is left for its owner, whose lobby shows why and whose board select still
  // works. The name stays either way: the client draws the pit for it.
  for (const game of await Games.find({}).fetchAsync()) {
    if (BoardBox.hasBoard(game.boardName)) continue;
    if (!game.started) {
      console.log(
        `Game ${game._id} sits on board ${game.boardName}, not in the catalog; left for its owner`
      );
    } else if (game.winner === undefined) {
      await endGameOnGoneBoardAsync(game._id);
    }
  }

  const dropped = await Games.updateAsync(
    // Neither half can be checked against the document: the key is not in the schema.
    { boardId: { $exists: true } } as Mongo.Selector<GameDoc>,
    { $unset: { boardId: '' } } as Mongo.Modifier<GameDoc>,
    { multi: true }
  );
  if (dropped > 0) console.log(`Dropped boardId from ${dropped} game(s)`);
}

// One update per field, because the selector has to name the key that is missing and a
// document may be missing any subset of them. `moderate` validation lets these through:
// the documents they touch are by definition the non-conforming ones.
//
// `Record<string, unknown>` rather than the npm driver's `Document`: it is the weakest
// constraint `Mongo.Collection` accepts, and it keeps the driver's types out of app code.
// `keyof T` on `fields` is what checks the field names at the two call sites.
async function seedNullKeys<T extends Record<string, unknown>, U>(
  collection: Mongo.Collection<T, U>,
  label: string,
  fields: readonly (keyof T & string)[]
) {
  for (const field of fields) {
    const seeded = await collection.updateAsync(
      // Neither half can be checked against the document once the key comes from a
      // variable; `fields` being `keyof T` is what makes the key itself safe.
      { [field]: { $exists: false } } as Mongo.Selector<T>,
      { $set: { [field]: null } } as Mongo.Modifier<T>,
      { multi: true }
    );
    if (seeded > 0) console.log(`Backfilled ${field} on ${seeded} ${label}(s)`);
  }
}

// The same seeding, one level down. A `segmentSnapshot` holds frozen copies of the player
// documents as they were when the segment started, and `restoreSnapshotAsync` writes those
// copies back whole — so seeding the live Players above is not enough: a game that a deploy
// interrupts mid-segment would fail its restore, and go on failing it on every sweep. The
// whole field goes back rather than a dotted path into it, because the schema says
// `Any` there and has nothing to check a path against.
async function seedSnapshotNullKeys() {
  const games = await Games.find(
    { segmentSnapshot: { $exists: true } },
    { fields: { segmentSnapshot: 1 } }
  ).fetchAsync();
  let repaired = 0;
  for (const game of games) {
    // The schema says `Any` on this field on purpose (see its comment in
    // collections/games.ts), so this is the second of the two sites that assert the shape
    // rather than derive it — the other is `restoreSnapshotAsync`.
    const snapshot = game.segmentSnapshot as SegmentSnapshot | undefined;
    const players = snapshot?.players ?? [];
    if (!players.some((doc) => doc.ablativeCoat === undefined)) continue;
    for (const doc of players) doc.ablativeCoat ??= null;
    await Games.updateAsync(game._id, {
      $set: { segmentSnapshot: { ...snapshot, players } },
    });
    repaired++;
  }
  if (repaired > 0) console.log(`Backfilled ablativeCoat in ${repaired} segment snapshot(s)`);
}

// Option names outlive the deck they came from: one taken out of `_option_deck` stays in
// the row of every player already holding it, where the card panel's description lookup
// and the discard path would both throw on it. The card is dropped, not discarded — an
// option the deck no longer knows has no id, so there is nowhere to put it back.
async function dropUnknownOptionCardsAsync() {
  for (const player of await Players.find().fetchAsync()) {
    // A row that predates the field has no map at all, as the seeds above also find.
    const cards = player.optionCards ?? {};
    const held = Object.keys(cards);
    const known = held.filter((name) => CardLogic.isOptionCard(name));
    if (known.length === held.length) continue;

    const optionCards = Object.fromEntries(known.map((name) => [name, cards[name]]));
    await Players.updateAsync(player._id, { $set: { optionCards } });
    const dropped = held.filter((name) => !CardLogic.isOptionCard(name));
    console.log(`Dropped unknown option card(s) ${dropped.join(', ')} from player ${player._id}`);
  }
}

// The option piles hold card names, as the hands do, but a game in flight can still be
// carrying what an older build wrote: positions in the catalog, which any edit to it
// re-pointed. A healthy deck spreads the catalog across the two piles and the hands
// exactly once, so a stored entry that is not a known name, or one that appears twice, is
// the signal to rebuild the piles from the hands.
async function rebuildOptionPilesAsync() {
  const names = Object.keys(CardLogic._option_cards);
  for (const game of await Games.find({ started: true, winner: { $exists: false } }).fetchAsync()) {
    const deck = await Decks.findOneAsync({ gameId: game._id });
    if (!deck) continue;

    const players = await Players.find({ gameId: game._id }).fetchAsync();
    const held = players.flatMap((player) => Object.keys(player.optionCards ?? {}));
    const all = [...deck.optionCards, ...deck.discardedOptionCards, ...held];
    if (!all.some((name, index) => !CardLogic.isOptionCard(name) || all.indexOf(name) !== index)) {
      continue;
    }

    // Everything not in a hand goes back to the draw pile: which pile a card sat in is not
    // recoverable, and the discard pile only ever refills the draw pile anyway.
    const optionCards = shuffle(names.filter((name) => !held.includes(name)));
    await Decks.updateAsync(
      { gameId: game._id },
      { $set: { optionCards, discardedOptionCards: [] } }
    );
    console.log(`Rebuilt the option piles of game ${game._id}`);
  }
}

// Games that finished before `winnerUserId` existed carry only the winner's display name.
// Resolve it from that game's own players, which is unambiguous unless two of them shared
// a name — the very collision this change is about — so skip those rather than guess.
// Anyone who left the game is unresolvable too: leaveGame deletes the Players document.
async function backfillWinnerUserIdsAsync() {
  const finished = await Games.find({
    winner: { $exists: true, $ne: 'Nobody' },
    winnerUserId: { $exists: false },
  }).fetchAsync();

  let resolved = 0;
  for (const game of finished) {
    const candidates = await Players.find({ gameId: game._id, name: game.winner }).fetchAsync();
    if (candidates.length !== 1 || !candidates[0].userId) continue;
    await Games.updateAsync(game._id, { $set: { winnerUserId: candidates[0].userId } });
    resolved++;
  }

  if (finished.length) {
    console.log(`Backfilled winnerUserId for ${resolved} of ${finished.length} finished game(s)`);
  }
}
