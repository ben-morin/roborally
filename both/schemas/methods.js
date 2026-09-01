import { check } from 'meteor/jam:easy-schema';

// The shape of every method's arguments, in one place.
//
// Methods take positional arguments, so each handler builds a small object out of them and
// hands it to `checkArgs` with the shape below. That is on purpose: P5 turns these methods
// into `createMethod({ schema })`, which takes exactly one named-argument object — so the
// shapes move over as they are instead of being rewritten.
//
// The publications that take a `gameId` use `gameIdOnly` too. They used to pass whatever
// arrived straight into a Mongo query.

// A failed `check` throws a ValidationError: `error: 'validation-error'` (a string),
// `reason: 'Validation failed'` (the same for every failure), and the part worth reading in
// `details: [{ name, type, message }]`. It is `isClientSafe`, so it reaches the browser
// verbatim — where every call site shows `error.reason` and would show that useless generic
// line. So this maps it to the vocabulary the rest of the app already speaks: a numeric
// `Meteor.Error` whose reason names the field that was wrong.
export const checkArgs = (data, schema) => {
  try {
    check(data, schema);
  } catch (error) {
    const details = error.details?.map((d) => d.message).join(', ');
    throw new Meteor.Error(400, details || error.reason || 'Invalid arguments.');
  }
};

// Six methods and the three game publications all take nothing but a game id.
export const gameIdOnly = { gameId: String };

export const schemas = {
  createGame: { name: String },
  joinGame: gameIdOnly,
  leaveGame: gameIdOnly,
  selectBoard: { boardName: String, gameId: String },
  startGame: gameIdOnly,
  playCards: { gameId: String, programRound: Number },
  selectRespawnPosition: { gameId: String, x: Number, y: Number },
  selectRespawnDirection: { gameId: String, direction: Number },
  togglePowerDown: gameIdOnly,
  addMessage: { message: String, gameId: String },
  resendVerificationEmail: { email: String },
  selectCard: { gameId: String, card: Number, index: Number },
  deselectCard: { gameId: String, index: Number },
  deselectAllCards: gameIdOnly,
  // `isEmailAvailable` takes no arguments, so it has no shape here.
};
