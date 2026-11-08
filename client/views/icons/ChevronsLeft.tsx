// The first page, on the admin user list's pager.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

export function ChevronsLeft(props: IconProps) {
  return (
    <Icon name="chevrons-left" {...props}>
      <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
    </Icon>
  );
}
