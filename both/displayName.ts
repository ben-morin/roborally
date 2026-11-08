// The shape a username must have, and nothing else: no Meteor, no database, so the sign-up
// form can check a name before the round trip. Whether a name is free is a server question;
// that is `checkNameAsync` in ./permissions.ts.

export const NAME_MIN = 3;
export const NAME_MAX = 20;

// The winner the end-of-game paths write when nobody won; the game list shows it as
// "won by Nobody", so a player by that name would read as no winner.
const RESERVED = ['nobody'];

/** `null` when the trimmed name has the right shape, otherwise the message to show. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Username is required.';
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    return `Username must be ${NAME_MIN} to ${NAME_MAX} characters long.`;
  }
  if (RESERVED.includes(trimmed.toLowerCase())) return 'That username is reserved.';
  return null;
}
