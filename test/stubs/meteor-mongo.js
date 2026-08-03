// Resolves `meteor/mongo` for server/mongoReactivity.js. checkReactivity() only reads
// the driver class name of each live observe multiplexer; there are none outside a real
// Meteor server, which is exactly the "(no live observes yet)" case it already handles.
export const MongoInternals = {
  defaultRemoteCollectionDriver: () => ({ mongo: { _observeMultiplexers: {} } }),
};

export const Mongo = {
  get Collection() {
    return globalThis.Meteor.Collection;
  },
};
