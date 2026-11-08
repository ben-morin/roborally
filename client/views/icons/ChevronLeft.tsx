// One page back, on the admin user list's pager.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

export function ChevronLeft(props: IconProps) {
  return (
    <Icon name="chevron-left" {...props}>
      <path d="m15 18-6-6 6-6" />
    </Icon>
  );
}
