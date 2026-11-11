// The crown over the ranking's first place.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

export function Crown(props: IconProps) {
  return (
    <Icon name="crown" strokeWidth={1.8} {...props}>
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" />
    </Icon>
  );
}
