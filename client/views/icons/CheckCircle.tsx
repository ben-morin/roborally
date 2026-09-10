// A register or play phase already played, on the announce strip.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

export function CheckCircle(props: IconProps) {
  return (
    <Icon name="check-circle" strokeWidth={2.2} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </Icon>
  );
}
