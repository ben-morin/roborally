// The footer's tutorial-video link.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

export function Play(props: IconProps) {
  return (
    <Icon name="play" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="4" />
      <path d="m10 9 5 3-5 3z" fill="currentColor" />
    </Icon>
  );
}
