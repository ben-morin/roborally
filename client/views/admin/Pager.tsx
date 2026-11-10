// The admin lists' pager: First and Previous on the left, "Page 2 of 3" in the middle, Next
// and Last on the right. Absent when everything fits on one page.
import type { ReactNode } from 'react';
import { ChevronLeft } from '../icons/ChevronLeft.tsx';
import { ChevronRight } from '../icons/ChevronRight.tsx';
import { ChevronsLeft } from '../icons/ChevronsLeft.tsx';
import { ChevronsRight } from '../icons/ChevronsRight.tsx';

const PAGER = 'mt-4 flex items-center justify-between gap-2';
const COUNT = 'text-xs whitespace-nowrap text-muted';
// Square icon buttons; the label is the accessible name and the tooltip.
const PAGE_BTN =
  'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-control border border-white/22 bg-transparent p-0 text-white hover:border-white/40 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const PAGE_BTN_OFF =
  'inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-control border border-white/22 bg-transparent p-0 text-white opacity-45';

// One pager button, off at either end of the list.
function PageButton({
  label,
  icon,
  to,
  off,
  goTo,
}: {
  label: string;
  icon: ReactNode;
  to: number;
  off: boolean;
  goTo: (page: number) => void;
}) {
  return off ? (
    <button type="button" className={PAGE_BTN_OFF} aria-label={label} title={label} disabled>
      {icon}
    </button>
  ) : (
    <button
      type="button"
      className={PAGE_BTN}
      aria-label={label}
      title={label}
      onClick={() => goTo(to)}
    >
      {icon}
    </button>
  );
}

export interface PagerProps {
  /** The navigation landmark's name, e.g. "User pages". */
  label: string;
  page: number;
  pageCount: number;
  goTo: (page: number) => void;
}

export function Pager({ label, page, pageCount, goTo }: PagerProps) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={label} className={PAGER}>
      <div className="flex gap-2">
        <PageButton
          label="First page"
          icon={<ChevronsLeft size={18} />}
          to={1}
          off={page === 1}
          goTo={goTo}
        />
        <PageButton
          label="Previous page"
          icon={<ChevronLeft size={18} />}
          to={page - 1}
          off={page === 1}
          goTo={goTo}
        />
      </div>
      <span className={COUNT} aria-live="polite">
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        <PageButton
          label="Next page"
          icon={<ChevronRight size={18} />}
          to={page + 1}
          off={page === pageCount}
          goTo={goTo}
        />
        <PageButton
          label="Last page"
          icon={<ChevronsRight size={18} />}
          to={pageCount}
          off={page === pageCount}
          goTo={goTo}
        />
      </div>
    </nav>
  );
}
