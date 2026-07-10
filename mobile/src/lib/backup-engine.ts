import * as MediaLibrary from 'expo-media-library';

import { CaptureAPIError, uploadFile } from '@/lib/capture-api';
import { loadBackupState, saveBackupState, type BackupState, type FailedItem } from '@/lib/backup-store';
import { loadCaptureSettings } from '@/lib/settings';

// expo-media-library ships a legacy and a next-generation API under one module;
// the exported query functions still use the legacy plain-object Asset, so we
// derive that shape from the function return rather than the newer class type.
type LibraryAsset = Awaited<ReturnType<typeof MediaLibrary.getAssetsAsync>>['assets'][number];

export type PermissionState = 'unknown' | 'granted' | 'denied';

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
  message: string;
};

type Listener = (progress: BackupProgress) => void;

const pageSize = 100;

/**
 * BackupEngine performs automatic camera-roll backup. It is a singleton so the
 * queue keeps running while the user moves between screens, and so a completed
 * item is recorded exactly once. Uploads go through the same resumable capture
 * API and the server's content-hash deduplication as every other import, so a
 * restart or a retry can never create a duplicate asset.
 */
class BackupEngine {
  private state: BackupState = { auto: false, doneIds: [], failed: [], lastSuccess: null };
  private done = new Set<string>();
  private loaded = false;
  private running = false;
  private controller: AbortController | null = null;
  private permission: PermissionState = 'unknown';
  private currentFile = '';
  private currentPercent = 0;
  private pending = 0;
  private message = '';
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    void this.ensureLoaded().then(() => listener(this.snapshot()));
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): BackupProgress {
    return {
      running: this.running,
      auto: this.state.auto,
      permission: this.permission,
      pending: this.pending,
      done: this.done.size,
      failed: this.state.failed,
      currentFile: this.currentFile,
      currentPercent: this.currentPercent,
      lastSuccess: this.state.lastSuccess,
      message: this.message,
    };
  }

  async setAuto(auto: boolean): Promise<void> {
    await this.ensureLoaded();
    this.state.auto = auto;
    await this.persist();
    this.emit();
    if (auto) void this.run();
  }

  stop(): void {
    this.controller?.abort();
  }

  /** run scans for new photos/videos and uploads everything not yet backed up. */
  async run(): Promise<void> {
    await this.ensureLoaded();
    if (this.running) return;

    const settings = await loadCaptureSettings();
    if (!settings.baseURL || !settings.deviceToken) {
      this.message = 'Connect this device in Settings first.';
      this.emit();
      return;
    }
    if (!(await this.ensurePermission())) {
      this.message = 'Allow photo access to back up automatically.';
      this.emit();
      return;
    }

    this.running = true;
    this.message = 'Looking for new photos…';
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.emit();

    try {
      const fresh = await this.collectNewAssets(signal);
      this.pending = fresh.length;
      this.message = fresh.length ? `${fresh.length} to back up` : 'Everything is backed up.';
      this.emit();

      for (const asset of fresh) {
        if (signal.aborted) break;
        await this.backupOne(settings, asset, signal);
        this.pending = Math.max(0, this.pending - 1);
        this.emit();
      }
      if (!signal.aborted) this.message = this.state.failed.length ? 'Some items need attention.' : 'All caught up.';
    } catch (cause) {
      if (!isAbort(cause)) this.message = cause instanceof Error ? cause.message : 'Backup failed.';
    } finally {
      this.running = false;
      this.currentFile = '';
      this.currentPercent = 0;
      this.controller = null;
      this.emit();
    }
  }

  private async backupOne(
    settings: Awaited<ReturnType<typeof loadCaptureSettings>>,
    asset: LibraryAsset,
    signal: AbortSignal,
  ): Promise<void> {
    this.currentFile = asset.filename;
    this.currentPercent = 0;
    this.emit();
    try {
      const uri = await this.resolveUri(asset);
      await uploadFile(
        settings,
        { uri, filename: asset.filename },
        (completed, total) => {
          this.currentPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
          this.emit();
        },
        signal,
      );
      this.done.add(asset.id);
      this.state.doneIds = [...this.done];
      this.state.failed = this.state.failed.filter((f) => f.localId !== asset.id);
      this.state.lastSuccess = { filename: asset.filename, at: Date.now() };
      await this.persist();
    } catch (cause) {
      if (isAbort(cause)) throw cause;
      const error = cause instanceof CaptureAPIError ? cause.message : 'Upload failed.';
      this.recordFailure({ localId: asset.id, filename: asset.filename, error, at: Date.now() });
      await this.persist();
    }
  }

  /** collectNewAssets pages the library newest-first, keeping only un-backed items. */
  private async collectNewAssets(signal: AbortSignal): Promise<LibraryAsset[]> {
    const fresh: LibraryAsset[] = [];
    let after: string | undefined;
    for (;;) {
      if (signal.aborted) break;
      const page = await MediaLibrary.getAssetsAsync({
        first: pageSize,
        after,
        mediaType: ['photo', 'video'],
        sortBy: [['creationTime', false]],
      });
      for (const asset of page.assets) {
        if (!this.done.has(asset.id)) fresh.push(asset);
      }
      if (!page.hasNextPage) break;
      after = page.endCursor;
    }
    return fresh;
  }

  private async resolveUri(asset: LibraryAsset): Promise<string> {
    // On iOS a bare `ph://` URI is not directly readable; resolve a local file.
    if (asset.uri.startsWith('file://')) return asset.uri;
    const info = await MediaLibrary.getAssetInfoAsync(asset);
    return info.localUri ?? asset.uri;
  }

  private recordFailure(item: FailedItem): void {
    const failed = this.state.failed.filter((f) => f.localId !== item.localId);
    failed.unshift(item);
    this.state.failed = failed.slice(0, 100);
  }

  private async ensurePermission(): Promise<boolean> {
    const result = await MediaLibrary.requestPermissionsAsync();
    this.permission = result.granted ? 'granted' : 'denied';
    return result.granted;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.state = await loadBackupState();
    this.done = new Set(this.state.doneIds);
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await saveBackupState(this.state);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

export const backupEngine = new BackupEngine();
