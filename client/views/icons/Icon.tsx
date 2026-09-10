// The frame every icon draws in: a 24-unit grid, stroked in the text colour, sized in
// pixels by the caller. Decorative by default — a caller that wants the icon read out
// gives the surrounding element the label, as the lives readout does.
import type { ReactNode } from 'react';

export interface IconProps {
  // Width and height in CSS pixels.
  size?: number;
  className?: string;
}

interface FrameProps extends IconProps {
  // A stable hook for tests and for anyone reading the DOM: which icon this is.
  name: string;
  fill?: string;
  strokeWidth?: number;
  children: ReactNode;
}

export function Icon({
  name,
  size = 16,
  className,
  fill = 'none',
  strokeWidth = 2,
  children,
}: FrameProps) {
  return (
    <svg
      data-icon={name}
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
