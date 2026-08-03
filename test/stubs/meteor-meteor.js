// Resolves `import { Meteor } from 'meteor/meteor'` (server/mongoReactivity.js) to the
// same object every other module sees as the `Meteor` global, so a mutation through the
// import — mongoReactivity assigns Meteor.settings.packages.mongo.reactivity — is
// visible to code that reads the global.
export const Meteor = globalThis.Meteor;
