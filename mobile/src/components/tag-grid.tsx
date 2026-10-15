import FilteredGrid from '@/components/filtered-grid';
export default function TagGrid({ tag }: { tag: string }) {
  return (
    <FilteredGrid
      kind="tag"
      id={tag}
      emptyMessage="No photos with this tag yet."
    />
  );
}
