// Shuffle a fresh program deck the way the game does and show what the hands from the
// front look like. `meteor npm run deck:shuffle -- --help` lists the options.
//
// Each shuffle is dealt to the players two ways: whole hands, as the game does, and one card
// around the table at a time, as a table of humans would. Only the cards the players need
// come off the deck; the rest stays.
//
// `.mts` so plain node treats it as an ES module without a `"type": "module"` in
// package.json, which would change how every other file loads. `both/shuffle.ts` is a
// plain `.ts`, so the npm script turns off the one warning node still prints for it.
//
// The deck is built and shuffled exactly as the game builds it: ids 0..size-1 through
// `shuffle`. Dealing pops from the end of the array, so everything below is printed in
// deal order — the first card shown is the first card dealt.
import { shuffle } from '../../both/shuffle.ts';

// The per-type counts of `CardLogic._8_deck` and `_12_deck`, copied because cardlogic.ts
// pulls in the Meteor collections and cannot load under plain node.
const DECKS: Record<number, readonly number[]> = {
  84: [6, 18, 18, 6, 18, 12, 6],
  126: [9, 27, 27, 9, 27, 18, 9],
};
const LABELS = ['UT', 'TR', 'TL', 'BU', 'M1', 'M2', 'M3'];
const TURN_LABELS = new Set(['UT', 'TR', 'TL']);

function arg(name: string, fallback: number) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

function labelFor(cardId: number, deck: readonly number[]) {
  let cnt = 0;
  for (let i = 0; i < deck.length; i++) {
    cnt += deck[i];
    if (cardId < cnt) return LABELS[i];
  }
  throw new Error(`Card ${cardId} is past the end of the deck`);
}

// Deal order, in rows of one hand each.
function printDeck(cards: readonly number[], deck: readonly number[]) {
  const inDealOrder = cards.slice().reverse();
  for (let i = 0; i < inDealOrder.length; i += HAND) {
    const row = inDealOrder.slice(i, i + HAND).map((id) => labelFor(id, deck));
    console.log(`${String(i / HAND + 1).padStart(3)}: ${row.join(' ')}`);
  }
}

function printHands(hands: readonly number[][], deck: readonly number[]) {
  hands.forEach((hand, i) => {
    console.log(`  player ${i + 1}: ${hand.map((id) => labelFor(id, deck)).join(' ')}`);
  });
}

// The game's deal: each player takes a whole hand off the top before the next player.
function dealWholeHands(shuffled: readonly number[]) {
  const drawn = shuffled.slice(-PLAYERS * HAND).reverse();
  return Array.from({ length: PLAYERS }, (_, p) => drawn.slice(p * HAND, (p + 1) * HAND));
}

// The table's deal: one card to each player in turn until every hand is full.
function dealAround(shuffled: readonly number[]) {
  const drawn = shuffled.slice(-PLAYERS * HAND).reverse();
  return Array.from({ length: PLAYERS }, (_, p) => drawn.filter((_, i) => i % PLAYERS === p));
}

function turnCount(hand: readonly number[], deck: readonly number[]) {
  return hand.filter((id) => TURN_LABELS.has(labelFor(id, deck))).length;
}

// C(n, k) as a float; the numbers stay small enough for that.
function choose(n: number, k: number) {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

const USAGE = `Usage: meteor npm run deck:shuffle -- [options]

  --deck 84|126   which program deck to build (default 84)
  --players N     how many hands to deal from the front (default 4)
  --hand N        cards per hand; 9 for an undamaged robot (default 9)
  --runs N        how many shuffles to sample for the odds (default 10000)
  --help          print this and exit

Card codes: UT u-turn, TR turn right, TL turn left, BU back up, M1 M2 M3 move 1, 2, 3.`;

if (process.argv.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}

const size = arg('deck', 84);
const runs = arg('runs', 10000);
// Cards per hand: nine for an undamaged robot, fewer with damage.
const HAND = arg('hand', 9);
const PLAYERS = arg('players', 4);
const deck = DECKS[size];
if (!deck) {
  console.error(`No ${size}-card deck; use --deck 84 or --deck 126`);
  process.exit(1);
}
if (!Number.isInteger(HAND) || HAND < 1 || HAND > size) {
  console.error(`--hand must be a whole number from 1 to ${size}`);
  process.exit(1);
}
if (!Number.isInteger(PLAYERS) || PLAYERS < 1 || PLAYERS * HAND > size) {
  console.error(`--players must be a whole number from 1 to ${Math.floor(size / HAND)}`);
  process.exit(1);
}

const fresh = Array.from({ length: size }, (_, i) => i);
console.log(`Fresh ${size}-card deck, deal order:`);
printDeck(fresh, deck);

const shuffled = shuffle(fresh);
console.log(`\nShuffled, deal order:`);
printDeck(shuffled, deck);

console.log(`\n${PLAYERS} player(s), whole hands at once:`);
printHands(dealWholeHands(shuffled), deck);
console.log(`\n${PLAYERS} player(s), one card around the table:`);
printHands(dealAround(shuffled), deck);

// How often a hand is all turns or all moves under each deal, against the odds a perfect
// shuffle gives (hypergeometric: half the deck is turn cards in both sizes).
const wholeHist = new Array(HAND + 1).fill(0);
const aroundHist = new Array(HAND + 1).fill(0);
for (let i = 0; i < runs; i++) {
  const cards = shuffle(fresh);
  for (const hand of dealWholeHands(cards)) wholeHist[turnCount(hand, deck)]++;
  for (const hand of dealAround(cards)) aroundHist[turnCount(hand, deck)]++;
}
const hands = runs * PLAYERS;
const turnsInDeck = deck[0] + deck[1] + deck[2];
const pct = (n: number) => `${((100 * n) / hands).toFixed(2)}%`.padStart(7);
const expected = (k: number) =>
  `${((100 * choose(turnsInDeck, k) * choose(size - turnsInDeck, HAND - k)) / choose(size, HAND)).toFixed(2)}%`.padStart(
    7
  );

console.log(`\n${hands} hands of ${HAND} over ${runs} shuffles (turn cards in hand):`);
console.log(`             whole   around  expected`);
for (let k = 0; k <= HAND; k++) {
  console.log(`  ${String(k).padStart(2)} turns: ${pct(wholeHist[k])}  ${pct(aroundHist[k])}  ${expected(k)}`);
}
console.log(`  all turns: ${pct(wholeHist[HAND])}  ${pct(aroundHist[HAND])}  ${expected(HAND)}`);
console.log(`  all moves: ${pct(wholeHist[0])}  ${pct(aroundHist[0])}  ${expected(0)}`);
