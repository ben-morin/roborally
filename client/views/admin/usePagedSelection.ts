// An admin list's paging, tied to its selection. The list keeps the page the admin chose
// together with the selection it was chosen under. A selection made anywhere else — a
// shared link, a just-added row — opens on that row's page instead; derived here rather
// than set from an effect, so the list never renders the wrong page first.
import { useState } from 'react';
import { pageOf, paginate } from '../../lib/paging.ts';

export function usePagedSelection<T extends { _id: string }>(
  shown: readonly T[],
  selectedId: string | null,
  onSelect: (id: string) => void
) {
  const [chosen, setChosen] = useState<{ page: number; selection: string | null }>({
    page: 1,
    selection: null,
  });
  const selectedIndex = selectedId ? shown.findIndex((item) => item._id === selectedId) : -1;
  const wanted =
    chosen.selection !== selectedId && selectedIndex >= 0 ? pageOf(selectedIndex) : chosen.page;
  const { items, page, pageCount } = paginate(shown, wanted);

  const goTo = (target: number) => setChosen({ page: target, selection: selectedId });
  const pick = (id: string) => {
    setChosen({ page, selection: id });
    onSelect(id);
  };

  return { items, page, pageCount, goTo, pick };
}
