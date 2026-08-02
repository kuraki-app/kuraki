/** The two fields selection logic needs off an asset; callers pass LibraryAssets. */
type Selectable = { id: string; favorite: boolean };

/**
 * A grid section, structurally.
 *
 * Deliberately not `PhotoSection`: `SectionList`'s `renderSectionHeader` hands
 * back a `SectionListData<PhotoRow>`, which is the same shape but not the same
 * type, and narrowing it at every call site would put a cast in the UI to
 * satisfy a helper that only ever reads `data`.
 */
type SectionLike = { data: readonly (readonly { id: string }[])[] };

/**
 * allFavorite reports whether every *selected* asset is already a favourite,
 * which is what turns the header's Favourite action into Unfavourite.
 *
 * One control doing both is the same trade Select all/None makes: with trash,
 * favourite and an overflow menu already in the header, a fourth item would
 * cost more than the ambiguity saves.
 *
 * An empty selection is deliberately `false`, not vacuously true — with nothing
 * chosen the button must read "Favourite", because "Unfavourite" implies the
 * app thinks something already is.
 *
 * Ids in the set with no matching asset are ignored rather than treated as
 * unfavourited: a selection can outlive the page it was made on.
 */
export function allFavorite(assets: Selectable[], selected: Set<string>): boolean {
  if (selected.size === 0) return false;
  const chosen = assets.filter((a) => selected.has(a.id));
  if (chosen.length === 0) return false;
  return chosen.every((a) => a.favorite);
}

/** sectionIds flattens a grid section's rows back into asset ids, in order. */
export function sectionIds(section: SectionLike): string[] {
  return section.data.flat().map((a) => a.id);
}

/**
 * sectionAllSelected reports whether a whole date group is selected, so its
 * header control can flip between "Select all" and "None".
 *
 * An empty section is `false`: "None" on a group holding nothing would offer to
 * clear a selection that cannot exist.
 */
export function sectionAllSelected(section: SectionLike, selected: Set<string>): boolean {
  const ids = sectionIds(section);
  if (ids.length === 0) return false;
  return ids.every((id) => selected.has(id));
}
