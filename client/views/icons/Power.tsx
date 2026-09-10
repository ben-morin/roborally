// The power-down card another player has announced.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

export function Power(props: IconProps) {
  return (
    <Icon name="power" strokeWidth={2.4} {...props}>
      <path d="M12 3v9" />
      <path d="M6.6 6.6a8 8 0 1 0 10.8 0" />
    </Icon>
  );
}
