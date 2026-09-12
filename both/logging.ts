// Production is quiet: the server narrates every deal, turn and presence change through
// console.log. DEBUG_LOG=true in the server's environment turns that back on for one
// container without a rebuild. The browser bundle has no environment, so the client stays
// quiet regardless.
const debugLog = Meteor.isServer && process.env.DEBUG_LOG === 'true';
if (Meteor.isProduction && !debugLog) {
  console.log = () => {};
}
