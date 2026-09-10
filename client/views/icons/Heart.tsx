// One life: filled while the player still has it, outlined once it is spent.
import { Icon } from './Icon.tsx';
import type { IconProps } from './Icon.tsx';

const SHAPE =
  'M12 21s-6.7-4.4-9.3-8.6C.6 8.9 2.4 4.5 6.2 4.1c2-.2 3.9.8 5.8 2.9 1.9-2.1 3.8-3.1 5.8-2.9 3.8.4 5.6 4.8 3.5 8.3C18.7 16.6 12 21 12 21z';

export function Heart({ filled, ...props }: IconProps & { filled: boolean }) {
  return (
    <Icon
      name={filled ? 'heart' : 'heart-outline'}
      fill={filled ? 'currentColor' : 'none'}
      {...props}
    >
      <path d={SHAPE} />
    </Icon>
  );
}
