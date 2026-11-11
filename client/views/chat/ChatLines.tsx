// Chat lines, grouped: a player's run of lines under one name and one age, and each system
// line on its own. The chat panel and the games manager's last lines both draw these.
import type { ChatDoc } from '../../../collections/chat.ts';
import { groupChat } from '../../lib/chat.ts';
import { RelativeTime } from '../layout/RelativeTime.tsx';
import { UserName } from '../users/UserName.tsx';

// The text, then the age at the right. A message's first line starts at the left edge with
// the name; its wrapped lines and every follow-on message hang at one indent, whatever the name.
const GROUP = 'flex items-baseline gap-x-2 px-2.5 py-0.75';
const TEXT = 'min-w-0 flex-1 space-y-0.5';
// A pasted link has no break point; without `wrap-anywhere` it runs into the age.
// Muted on the whole line; the name inside it sets its own color.
const FIRST = 'pl-4 -indent-4 wrap-anywhere text-muted';
const FOLLOW = 'pl-4 wrap-anywhere text-muted';
const AUTHOR = 'font-semibold text-white';
const OWN_AUTHOR = 'font-semibold text-teal';
const AGE = 'shrink-0 pl-0.5 text-xs text-muted tabular-nums';
// `system` is contract: the browser journey matches `.messages .system`.
const SYSTEM_LINE = 'system flex items-baseline gap-x-2 px-2.5 py-0.75 text-muted';
const SYSTEM_MESSAGE = 'min-w-0 flex-1 pl-4 -indent-4 wrap-anywhere';

export interface ChatLinesProps {
  lines: readonly ChatDoc[];
  /** Whose name shows teal; the games manager passes nobody. */
  viewerId?: string | null;
}

export function ChatLines({ lines, viewerId }: ChatLinesProps) {
  return (
    <>
      {groupChat(lines).map((group) => {
        const [head, ...rest] = group;
        return head.author ? (
          <div key={head._id} className={GROUP}>
            <div className={TEXT}>
              <div className={FIRST}>
                <UserName
                  userId={head.userId}
                  name={head.author}
                  className={head.userId === viewerId ? OWN_AUTHOR : AUTHOR}
                />{' '}
                <span aria-hidden="true">·</span> {head.message}
              </div>
              {rest.map((line) => (
                <div key={line._id} className={FOLLOW}>
                  {line.message}
                </div>
              ))}
            </div>
            <RelativeTime className={AGE} timestamp={head.submitted} short />
          </div>
        ) : (
          <div key={head._id} className={SYSTEM_LINE}>
            <div className={SYSTEM_MESSAGE}>
              {/* A middot where a player line has its name. */}
              <span className={AUTHOR} aria-hidden="true">
                ·
              </span>{' '}
              {head.message}
            </div>
            <RelativeTime className={AGE} timestamp={head.submitted} short />
          </div>
        );
      })}
    </>
  );
}
