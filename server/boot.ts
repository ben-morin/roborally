// When this process came up, stamped once from `Meteor.startup` in server/cron.ts before
// the cron scheduler starts. It lives here rather than on the entry point because two
// unrelated things read it and neither should have to import the entry point:
//
// - `Clean up abandoned games` sits out a grace after boot, because mizzao:user-status
//   marks every user offline in its own startup hook and clients need seconds to reconnect.
// - the board nudge in server/resume.ts treats a game whose last claim predates boot as one
//   no driver in this process can be holding.
//
// Zero until it is stamped. That is the value the nudge wants if it somehow runs first — no
// real `lastStepAt` is earlier than the epoch, so it declines rather than resuming a game
// blind. The abandoned-game grace is unaffected: the scheduler starts later in the same
// startup block, so no job has ever seen the zero.
let bootedAt = 0;

export function markBooted(at = Date.now()) {
  bootedAt = at;
}

export function bootedAtMs() {
  return bootedAt;
}
