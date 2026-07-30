import type { FailedItem } from '@/lib/backup-store';

// expo-media-library has no usable web implementation for its Next API (the
// Query/Asset/Album classes extend undefined native constructors). Camera-roll
// auto-backup is native-only; manual picks still work through Image Picker.
export type PermissionState = 'unknown' | 'granted' | 'denied';

export type BackupAlbum = { id: string; title: string; assetCount: number };

export type BackupProgress = {
  running: boolean;
  auto: boolean;
  permission: PermissionState;
  pending: number;
  done: number;
  failed: FailedItem[];
  currentFile: string;
  currentPercent: number;
  lastSuccess: { filename: string; at: number } | null;
  albumIds: string[];
  wifiOnly: boolean;
  message: string;
};

type Listener = (progress: BackupProgress) => void;

const unsupported = 'Camera-roll backup runs on the iOS/Android app, not the web preview.';

class BackupEngine {
  private listeners = new Set<Listener>();
  private albumIds: string[] = [];
  private auto = false;
  private wifiOnly = true;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): BackupProgress {
    return {
      running: false,
      auto: this.auto,
      permission: 'denied',
      pending: 0,
      done: 0,
      failed: [],
      currentFile: '',
      currentPercent: 0,
      lastSuccess: null,
      albumIds: this.albumIds,
      wifiOnly: this.wifiOnly,
      message: unsupported,
    };
  }

  async listAlbums(): Promise<BackupAlbum[]> {
    return [];
  }

  async setAlbums(ids: string[]): Promise<void> {
    this.albumIds = ids;
    this.emit();
  }

  async setAuto(auto: boolean): Promise<void> {
    this.auto = auto;
    this.emit();
  }

  async setWifiOnly(value: boolean): Promise<void> {
    this.wifiOnly = value;
    this.emit();
  }

  async isAuto(): Promise<boolean> {
    return this.auto;
  }

  stop(): void {}

  async run(_options: { background?: boolean } = {}): Promise<void> {
    this.emit();
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }
}

export const backupEngine = new BackupEngine();
