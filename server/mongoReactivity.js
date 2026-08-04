import { MongoInternals } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

// Makes oplog/polling the reactivity default, so no entry point depends on remembering a
// settings file. Meteor 3.5 defaults to Change Streams, whose observe driver fails to retire the
// DDP write fence when a write targets a collection carrying a filtered observe that the written
// document does not match: the `updated` message is never sent, so the method's client-side
// callback never fires. Account signup hits this every time — a new user has no `status.online`,
// while both `collections/users.js` and the `onlineUsers` publication observe
// `{'status.online': true}` — and the login spinner never clears.
//
// The mongo package reads `Meteor.settings.packages.mongo.reactivity` per observe (see its
// `_getConfiguredReactivityOrder`), not once at load, so assigning here takes effect as long as
// it happens before the first observe — hence this module is imported ahead of
// `collections/users.js` in the server entry point. Only absent values are filled in, so a
// `--settings` file, `METEOR_SETTINGS`, or `METEOR_REACTIVITY_ORDER` still wins.
//
// Remove this file once the upstream fence bug is fixed and Change Streams can be trusted.
Meteor.settings = Meteor.settings || {};
Meteor.settings.packages = Meteor.settings.packages || {};
Meteor.settings.packages.mongo = Meteor.settings.packages.mongo || {};
Meteor.settings.packages.mongo.reactivity = Meteor.settings.packages.mongo.reactivity || [
  'changeStreams',
  'oplog',
  'polling',
];

// Order the mongo package falls back to when nothing is configured.
const DRIVERS = ['changeStreams', 'oplog', 'polling'];

export function checkReactivity() {
  // Meteor.settings wins over METEOR_REACTIVITY_ORDER; both are read per-cursor
  // by the mongo package at observeChanges time, not at connection time.
  const setting = Meteor.settings?.packages?.mongo?.reactivity;
  const order = setting
    ? [].concat(setting)
    : (process.env.METEOR_REACTIVITY_ORDER?.split(',') ?? DRIVERS);

  console.log('Configured reactivity order:', order.join(' > '));

  const mongo = MongoInternals.defaultRemoteCollectionDriver().mongo;

  // The real driver is chosen per live query, so this stays empty until
  // something is actually being observed.
  const live = Object.values(mongo._observeMultiplexers)
    .map((m) => m._observeDriver?.constructor.name)
    .filter(Boolean);
  console.log('Active observe drivers:', live.length ? live : '(no live observes yet)');
}
