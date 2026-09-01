// Resolves `meteor/jam:easy-schema` for the collection modules and (from step 8) the
// method-argument shapes.
//
// This is a deliberate PASS-THROUGH: `check` validates nothing. Rejections are not
// testable out here — the real package's value comes from two implementations that must
// agree (its own runtime check and the Mongo `$jsonSchema` it generates), and neither one
// exists without a Meteor build and a live MongoDB. A half-reimplementation here would
// prove agreement with itself and nothing else. The real validator is exercised in the
// browser, by the one `test/e2e/` assertion that provokes a 400.
//
// What vitest CAN prove is *shape*: which fields a collection declares, and which of them
// are optional. So `Optional` and `AnyOf` return small marker objects that
// test/collections/schemas.test.js can read back.

/** No-op. See the note above: the stub never rejects anything. */
export const check = () => {};

/** Key may be absent. */
export const Optional = (type) => ({ __optional: type });

/** Key is present; its value matches any one of `types`. */
export const AnyOf = (...types) => ({ __anyOf: types });

// String sentinels rather than the real package's internals — a schema only ever puts
// them in a field position, and a readable string is what shows up in a failed
// `toEqual` diff.
export const ID = 'ID';
export const Any = 'Any';
export const Integer = 'Integer';

let config = null;

/** The argument the app passed to `EasySchema.configure`, or null if it never ran. */
export function easySchemaConfig() {
  return config;
}

export const EasySchema = {
  configure(options) {
    config = options;
  },
};
