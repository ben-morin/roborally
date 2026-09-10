// A register or play phase still to come, on the announce strip.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

export function Circle(props: IconProps) {
  return (
    <Icon name="circle" strokeWidth={2.2} {...props}>
      <circle cx="12" cy="12" r="9" />
    </Icon>
  );
}
