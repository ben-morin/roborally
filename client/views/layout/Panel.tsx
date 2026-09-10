// One navy panel: the surface every section of a page sits on. The class is defined in
// client/stylesheets/tailwind.css because it carries `--panel-bg`, which the card panel's
// countdown recolours through `:has()`.
import type { ReactNode } from 'react';

export interface PanelProps {
  children: ReactNode;
  // The board panel: 16px padding instead of 24, so the board keeps its width.
  tight?: boolean;
  className?: string;
}

export function Panel({ children, tight = false, className = '' }: PanelProps) {
  return (
    <section className={`panel${tight ? ' panel-tight' : ''} ${className}`.trim()}>
      {children}
    </section>
  );
}
