// Inert on purpose, like the Tracker shim in test/clientSetup.js: the tracked function runs on
// every render and nothing invalidates. A test that changes Meteor.user() re-renders itself.
export const useTracker = (fn) => fn();
