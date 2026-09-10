/** Row-aligned windows keep a single busy day/month from mounting the library. */
export function gridGeometry(width: number, minimum: number, gap: number) {
  const columns = Math.max(1, Math.floor((width + gap) / (minimum + gap)));
  return { columns, tile: Math.max(0, (width - gap * (columns - 1)) / columns) };
}

export function gridWindows<T>(items: T[], columns: number, tile: number, gap: number) {
  const size = columns * 6;
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => {
    const slice = items.slice(index * size, (index + 1) * size);
    const rows = Math.ceil(slice.length / columns);
    return { index, items: slice, height: rows * tile + Math.max(0, rows - 1) * gap };
  });
}
