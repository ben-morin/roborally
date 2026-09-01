import { Match } from 'meteor/check';
import { EasySchema } from 'meteor/jam:easy-schema';

// Package-wide settings for jam:easy-schema, plus the one custom type the app's schemas
// need. Nothing here is app data; the schemas themselves live with their collections.
//
// `configure` is read when a collection attaches its schema, and that happens in the
// collection's module body — so this module must load before any collection does. Both
// entry points import it high up, next to the other load-order-sensitive import
// (`both/logging.js`).

// jam:easy-schema 1.7.1 cannot express "null" the way its own README does. The docs say
// `AnyOf(Date, null)`, and the runtime check accepts that, but the generator that turns a
// schema into Mongo's `$jsonSchema` reads `.condition` off every branch — including the
// bare `null` — and throws. The throw is caught and only `console.error`-ed, so the
// collection silently ends up with NO database validator: it fails open, and the only
// evidence is one line in the server log.
//
// A named `Match.Where` sidesteps it. The generator looks a matcher's `.name` up in its
// type map, so `Null` resolves through the `additionalBsonTypes` entry below and compiles
// to `{ bsonType: 'null' }` — tight at both layers. Without the `.name` it would compile
// to `{}`, which accepts anything.
//
// So: wherever a schema means "this value may be null", it says `AnyOf(X, Null)`, never
// `AnyOf(X, null)`. When upstream fixes the generator, swap `Null` back to `null` field by
// field and drop the `Null` entry below.
export const Null = Match.Where((x) => x === null);
Null.name = 'Null';

EasySchema.configure({
  // The production database holds games from before the schemas existed. `moderate` still
  // validates every insert, but skips updates to documents that were already
  // non-conforming, so a legacy game cannot become unwritable. The app-level check runs on
  // every write regardless, so nothing is actually let through — only the database's
  // second opinion is relaxed. Revisit `strict` once a release has aged.
  validationLevel: 'moderate',
  additionalBsonTypes: {
    // Routes the `Null` matcher above.
    Null: 'null',
    // easy-schema maps `Number` to bson `double`, but the driver stores an
    // integer-valued JS number as `int` — so `timer: 0`, `damage: 0`, `boardId` and every
    // count would be refused by the database validator. The `number` alias matches int,
    // long and double alike. (Trade-off: the generator's min/max tables have no entry for
    // `number`, so fluent `min()`/`max()` on a Number field would not compile to a
    // database qualifier. Nothing uses those yet.)
    Number: 'number',
  },
});
