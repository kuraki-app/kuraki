import type { LibraryAsset } from '@/lib/library-api';
import type { MemoryGroup as SharedMemoryGroup } from '../../../shared/memories';
export { memoryGroups } from '../../../shared/memories';
export type MemoryGroup = SharedMemoryGroup<LibraryAsset>;
