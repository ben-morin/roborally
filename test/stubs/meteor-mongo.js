// Resolves `meteor/mongo` for the six collection modules. They construct through
// `Mongo.Collection` rather than the `Meteor.Collection` alias, because jam:easy-schema
// wraps only the former — see collections/games.ts.
export const Mongo = {
  get Collection() {
    return globalThis.Meteor.Collection;
  },
};
