// The shape a game name must have, and nothing else: no Meteor, no database, so a form's
// `maxLength` holds the same limit the server checks.

export const GAME_NAME_MAX = 40;

/** `null` when the trimmed name has the right shape, otherwise the message to show. */
export function gameNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name cannot be empty.';
  if (trimmed.length > GAME_NAME_MAX) {
    return `Name must be at most ${GAME_NAME_MAX} characters long.`;
  }
  return null;
}
