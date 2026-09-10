// Inert on purpose, like the Tracker shim in test/clientSetup.js: the tracked function runs on
// every render and nothing invalidates. A test that changes Meteor.user() re-renders itself.
export const useTracker = (fn) => fn();

// Same deal one level up. The real hook observes the cursor and keeps an array in step with
// it; here the rows are read once, at render, so a test that changes the collection re-renders
// itself. `null` for a factory that declines to build a cursor, as the real hook returns.
export const useFind = (factory) => factory()?.fetch() ?? null;

// Nothing subscribes out here — there is no connection — so the loading getter says the data
// is in. A test drives it the other way with setSubscriptionsLoading(): the lobby's redirect
// effect has to tell "the game has not arrived yet" from "there is no such game", and that is
// the only thing the flag is for.
let loading = false;
export const useSubscribe = () => () => loading;

export function setSubscriptionsLoading(value) {
  loading = value;
}
