// Imported from the `legacy` entry point deliberately. The same functions
// re-exported from the package root are deprecated and documented as
// "will throw in runtime" -- they currently console.warn on every call,
// which is what surfaced a wall of deprecation text inside the Backup UI.
// The legacy entry is Expo's own documented target and is behaviour-identical;
// migrating to the new class-based API is a separate change that needs a
// device to verify, since it rewrites the backup scan path.
import * as MediaLibrary from 'expo-media-library/legacy';

import { CaptureAPIError, uploadFile } from '@/lib/capture-api';
import { loadBackupState, saveBackupState, type BackupState, type FailedItem } from '@/lib/backup-store';
import {
  clearResumableUpload,
  importLegacyDoneIds,
  loadBackedUpIds,
  loadResumableUpload,
  markBackedUp,
  saveResumableUpload,
} from '@/lib/backup-ledger';
import { currentConnection, evaluateNetworkGate, gateMessage } from '@/lib/network';
import { loadCaptureSettings } from '@/lib/settings';
import { loadPrefs, mediaTypesFor } from '@/lib/prefs';

// expo-media-library ships a legacy and a next-generation API under one module;
// the exported query functions still use the legacy plain-object Asset, so we
// derive that shape from the function return rather than the newer class type.
type LibraryAsset = Awaited<ReturnType<typeof MediaLibrary.getAssetsAsync>>['assets'][number];

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

const pageSize = 100;

/**
 * BackupEngine performs automatic camera-roll backup. It is a singleton so the
 * queue keeps running while the user moves between screens, and so a completed
 * item is recorded exactly once. Uploads go through the same resumable capture
 * API and the server's content-hash deduplication as every other import, so a
 * restart or a retry can never create a duplicate asset.
 */
class BackupEngine {
  private state: BackupState = {
    auto: false,
    failed: [],
    lastSuccess: null,
    albumIds: [],
    wifiOnly: true,
    legacyDoneIds: [],
  };
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
      albumIds: this.state.albumIds,
      wifiOnly: this.state.wifiOnly,
      message: this.message,
    };
  }

  /** listAlbums returns the device's albums so the user can choose which to back up. */
  async listAlbums(): Promise<BackupAlbum[]> {
    await this.ensureLoaded();
    if (!(await this.ensurePermission(false))) return [];
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    return albums
      .filter((a) => a.assetCount > 0)
      .map((a) => ({ id: a.id, title: a.title, assetCount: a.assetCount }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async setAlbums(ids: string[]): Promise<void> {
    await this.ensureLoaded();
    this.state.albumIds = ids;
    await this.persist();
    this.emit();
    if (this.state.auto) void this.run();
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

  /**
   * run scans for new photos/videos and uploads everything not yet backed up.
   *
   * `background` marks a headless OS wake, where there is no Activity to attach
   * a permission dialog to and no user to answer it.
   */
  async run(options: { background?: boolean } = {}): Promise<void> {
    await this.ensureLoaded();
    if (this.running) return;

    const settings = await loadCaptureSettings();
    if (!settings.baseURL || !settings.deviceToken) {
      this.message = 'Connect this device in Settings first.';
      this.emit();
      return;
    }
    if (!(await this.ensurePermission(options.background ?? false))) {
      this.message = options.background
        ? 'Photo access is needed. Open Kuraki to grant it.'
        : 'Allow photo access to back up automatically.';
      this.emit();
      return;
    }
    // Automatic backup pushes an entire camera roll, and the OS schedules wakes
    // without regard to which network is attached.
    const gate = evaluateNetworkGate(await currentConnection(), this.state.wifiOnly);
    if (gate !== 'allowed') {
      this.message = gateMessage(gate) ?? 'Waiting for a connection.';
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
        {
          load: () => loadResumableUpload(asset.id),
          save: (upload) => saveResumableUpload(asset.id, upload),
          clear: () => clearResumableUpload(asset.id),
        },
      );
      this.done.add(asset.id);
      await markBackedUp(asset.id);
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

  /**
   * collectNewAssets pages newest-first, keeping only un-backed items. When the
   * user has picked albums, only those are scanned (an asset in several selected
   * albums is uploaded once); otherwise the whole library is scanned.
   */
  private async collectNewAssets(signal: AbortSignal): Promise<LibraryAsset[]> {
    // Which media types the user actually wants backed up. An empty list means
    // both switches are off, and must short-circuit: passing an empty
    // mediaType to the media library matches everything, which would back up
    // precisely what was just turned off.
    const mediaType = mediaTypesFor(await loadPrefs());
    if (mediaType.length === 0) return [];

    const albums = this.state.albumIds;
    const scopes: (string | undefined)[] = albums.length ? albums : [undefined];
    const fresh: LibraryAsset[] = [];
    const seen = new Set<string>();
    for (const album of scopes) {
      let after: string | undefined;
      for (;;) {
        if (signal.aborted) return fresh;
        const page = await MediaLibrary.getAssetsAsync({
          first: pageSize,
          after,
          album,
          mediaType,
          sortBy: [['creationTime', false]],
        });
        for (const asset of page.assets) {
          if (!this.done.has(asset.id) && !seen.has(asset.id)) {
            seen.add(asset.id);
            fresh.push(asset);
          }
        }
        if (!page.hasNextPage) break;
        after = page.endCursor;
      }
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

  /**
   * ensurePermission checks access, and only *asks* in the foreground.
   *
   * requestPermissionsAsync needs a current Activity on Android to attach its
   * dialog to; from a WorkManager wake there is none, so the request either
   * rejects or resolves denied and the task fails with no user-visible reason.
   * A headless wake therefore reads the existing grant and gives up quietly if
   * it is missing -- the next foreground run will ask properly.
   */
  private async ensurePermission(background: boolean): Promise<boolean> {
    const result = background
      ? await MediaLibrary.getPermissionsAsync()
      : await MediaLibrary.requestPermissionsAsync();
    this.permission = result.granted ? 'granted' : 'denied';
    return result.granted;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.state = await loadBackupState();
    // One-time migration off the old AsyncStorage array. Importing before
    // reading the ledger means an interrupted migration is simply retried next
    // launch; INSERT OR IGNORE makes it idempotent.
    if (this.state.legacyDoneIds.length > 0) {
      await importLegacyDoneIds(this.state.legacyDoneIds);
      this.state.legacyDoneIds = [];
      await this.persist();
    }
    this.done = await loadBackedUpIds();
    this.loaded = true;
  }

  /** isAuto reports the persisted automatic-backup preference. */
  async isAuto(): Promise<boolean> {
    await this.ensureLoaded();
    return this.state.auto;
  }

  /** setWifiOnly restricts (or releases) automatic backup to un-metered networks. */
  async setWifiOnly(value: boolean): Promise<void> {
    await this.ensureLoaded();
    this.state.wifiOnly = value;
    await this.persist();
    this.emit();
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
