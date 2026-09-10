// The register or play phase in progress, on the announce strip.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

export function ArrowRightCircle(props: IconProps) {
  return (
    <Icon name="arrow-right-circle" strokeWidth={2.2} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8M12.5 8.5 16 12l-3.5 3.5" />
    </Icon>
  );
}
