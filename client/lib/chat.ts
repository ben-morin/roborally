// The chat's grouping: back-to-back lines from one player share one name and one age.
// No React, no Meteor, no DOM — ChatPanel is wiring over this.

/** What grouping reads from a chat line; a system line has no author. */
export interface ChatLine {
  submitted: number;
  author?: string;
  userId?: string;
}

// The longest a group runs, so the one age it shows is never far off for its last line.
export const GROUP_SPAN_MS = 5 * 60_000;

/** The lines in their order, cut into groups: one player's run of lines, or one system line. */
export function groupChat<T extends ChatLine>(lines: readonly T[]): T[][] {
  const groups: T[][] = [];
  let current: T[] | undefined;
  for (const line of lines) {
    const head = current?.[0];
    // By account where the lines have one, so a rename mid-chat does not split a run;
    // by name only for an old line stored without one.
    const samePlayer =
      head?.author !== undefined &&
      line.author !== undefined &&
      (head.userId !== undefined || line.userId !== undefined
        ? head.userId === line.userId
        : head.author === line.author);
    const joins = samePlayer && line.submitted - head.submitted <= GROUP_SPAN_MS;
    if (current && joins) {
      current.push(line);
    } else {
      current = [line];
      groups.push(current);
    }
  }
  return groups;
}
