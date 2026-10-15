import FilteredGrid from '@/components/filtered-grid';
export default function TripGrid({ trip }: { trip: string }) {
  return (
    <FilteredGrid
      kind="trip"
      id={trip}
      emptyMessage="No photos in this trip yet."
    />
  );
}
