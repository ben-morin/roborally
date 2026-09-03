import type { Infer, Pattern } from 'meteor/jam:easy-schema';
import type { Mongo } from 'meteor/mongo';

type UndefinedKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];

// `Infer` keeps every key and types an `Optional(X)` field as `X | undefined`; the
// documents leave the key out. This makes those keys optional, so an insert literal
// without them type-checks and a read of them is `X | undefined`.
export type Doc<S extends Pattern> = Omit<Infer<S>, UndefinedKeys<Infer<S>>> &
  Partial<Pick<Infer<S>, UndefinedKeys<Infer<S>>>>;

// @types/meteor's `Modifier<T>` is `T | { $set?, $inc?, … }` — a whole-document
// replacement counts. `advanceAsync` only ever builds the operator form.
export type UpdateModifier<T> = Exclude<Mongo.Modifier<T>, T>;
