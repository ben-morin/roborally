import { check } from 'meteor/jam:easy-schema';

// The shape of every method's arguments, in one place.
//
// A jam:method takes exactly one argument object, and these are its keys. Each method
// declares its shape as `validate: checkArgsWith(schemas.x)`.
//
// `validate`, and not the package's own `schema:` option, because the two take different
// routes: `schema` makes jam:method call easy-schema itself and throw the raw
// ValidationError before a method's pipeline even exists, which is precisely the generic
// error `checkArgs` below exists to translate. `validate` is the seam — a plain function,
// so the mapping stays ours. (The two are mutually exclusive; passing both throws at
// definition time.)
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

// The `validate` a method declares: a function of the one argument object, which throws
// the mapped error above when the shape is wrong. `this` is the method invocation, and is
// deliberately unused — validation never depends on who is calling.
export const checkArgsWith = (schema) => (args) => checkArgs(args, schema);

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
