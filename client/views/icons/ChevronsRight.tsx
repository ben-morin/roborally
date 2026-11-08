// The last page, on the admin user list's pager.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

export function ChevronsRight(props: IconProps) {
  return (
    <Icon name="chevrons-right" {...props}>
      <path d="m6 17 5-5-5-5M13 17l5-5-5-5" />
    </Icon>
  );
}
