// One page on, on the admin user list's pager.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

export function ChevronRight(props: IconProps) {
  return (
    <Icon name="chevron-right" {...props}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}
