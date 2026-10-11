import * as MediaLibrary from 'expo-media-library/legacy';
import { AppState } from 'react-native';
import { uploadFile, availableOriginals } from '@/lib/capture-api';
import {
  loadBackupState,
  saveBackupState,
  type BackupState,
  type FailedItem,
} from '@/lib/backup-store';
import {
  backedUpCount,
  forgetReceipt,
  loadBackupReceipts,
  markBackedUp,
  importLegacyDoneIds,
  loadResumableUpload,
  saveResumableUpload,
  clearResumableUpload,
  type OriginalProof,
} from '@/lib/backup-ledger';
import { captureTimestamp } from '@/lib/format';
import {
  currentConnection,
  evaluateNetworkGate,
  gateMessage,
  onConnectionChange,
} from '@/lib/network';
import {
  loadCaptureSettings,
  captureSettingsSnapshot,
  connectCaptureSettings,
  libraryKey,
  onCaptureSettingsChange,
  assertActiveConnection,
  type CaptureSettings,
} from '@/lib/settings';
import { notify } from '@/lib/notifications';
import { loadPrefs, mediaTypesFor } from '@/lib/prefs';
import {
  abortable,
  throwIfAborted,
  isAbort,
  RequestError,
} from '@/lib/request';

export type LibraryAsset = Awaited<
  ReturnType<typeof MediaLibrary.getAssetsAsync>
>['assets'][number];
export type PermissionState = 'unknown' | 'granted' | 'limited' | 'denied';
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
export function localVersion(
  asset: Pick<
    LibraryAsset,
    'filename' | 'creationTime' | 'modificationTime' | 'mediaSubtypes'
  >,
): string {
  return JSON.stringify([
    asset.filename,
    asset.creationTime,
    asset.modificationTime,
    asset.mediaSubtypes?.includes('livePhoto') ?? false,
  ]);
}
export type ResolvedComponent = { id: string; uri: string; filename: string };
export async function resolveComponents(
  asset: LibraryAsset,
  signal?: AbortSignal,
  download = true,
): Promise<ResolvedComponent[]> {
  throwIfAborted(signal);
  const live = asset.mediaSubtypes?.includes('livePhoto');
  if (asset.uri.startsWith('file://') && !live)
    return [{ id: asset.id, uri: asset.uri, filename: asset.filename }];
  const info = await abortable(
    MediaLibrary.getAssetInfoAsync(asset, {
      shouldDownloadFromNetwork: download,
    }),
    signal,
  );
  if (info.isNetworkAsset && !download)
    throw new Error(
      'This original is offloaded; it is not taking local space.',
    );
  const uri = info.localUri ?? asset.uri;
  if (!uri.startsWith('file://') && !uri.startsWith('content://'))
    throw new Error(
      'Download this original to the device before backing it up.',
    );
  const result: ResolvedComponent[] = [
    { id: asset.id, uri, filename: asset.filename },
  ];
  if (live) {
    if (!info.pairedVideoAsset)
      throw new Error(
        'The Live Photo motion component is unavailable. No local copy will be offered for removal.',
      );
    const motion = info.pairedVideoAsset;
    let motionUri = motion.uri;
    if (!motion.uri.startsWith('file://')) {
      const motionInfo = await abortable(
        MediaLibrary.getAssetInfoAsync(motion, {
          shouldDownloadFromNetwork: download,
        }),
        signal,
      );
      motionUri = motionInfo.localUri ?? motionInfo.uri;
    }
    if (!motionUri.startsWith('file://') && !motionUri.startsWith('content://'))
      throw new Error(
        'Download the Live Photo motion component before backup.',
      );
    const basename = asset.filename.replace(/\.[^.]+$/, '');
    result.push({
      id: asset.id + ':motion',
      uri: motionUri,
      filename: basename + '.mov',
    });
  }
  return result;
}

export class BackupEngine {
  private state: BackupState = {
    auto: false,
    failed: [],
    lastSuccess: null,
    albumIds: [],
    wifiOnly: true,
    legacyDoneIds: [],
  };
  private initialization: Promise<void> | null = null;
  private pass: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private activeConnection: CaptureSettings | null = null;
  private scope = '';
  private totalDone = 0;
  private permission: PermissionState = 'unknown';
  private currentFile = '';
  private currentPercent = 0;
  private pending = 0;
  private message = '';
  private allowRetry = true;
  private unsubscribeIdentity: () => void;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(progress: BackupProgress) => void>();
  constructor() {
    this.unsubscribeIdentity = onCaptureSettingsChange(() => {
      const next = captureSettingsSnapshot();
      if (
        this.activeConnection &&
        next &&
        next.baseURL === this.activeConnection.baseURL &&
        next.deviceToken === this.activeConnection.deviceToken &&
        (!this.activeConnection.serverID ||
          (next.serverID === this.activeConnection.serverID &&
            next.ownerID === this.activeConnection.ownerID))
      )
        return;
      this.stop();
      this.scope = '';
      this.totalDone = 0;
      this.pending = 0;
      this.state.failed = [];
      this.state.lastSuccess = null;
      this.emit();
    });
  }
  subscribe(listener: (progress: BackupProgress) => void): () => void {
    this.listeners.add(listener);
    void this.ensureLoaded()
      .then(() => listener(this.snapshot()))
      .catch(() => {
        this.message = 'Backup settings could not be opened. Try again.';
        this.emit();
      });
    return () => {
      this.listeners.delete(listener);
    };
  }
  snapshot(): BackupProgress {
    return {
      running: !!this.pass,
      auto: this.state.auto,
      permission: this.permission,
      pending: this.pending,
      done: this.totalDone,
      failed: this.state.failed,
      currentFile: this.currentFile,
      currentPercent: this.currentPercent,
      lastSuccess: this.state.lastSuccess,
      albumIds: this.state.albumIds,
      wifiOnly: this.state.wifiOnly,
      message: this.message,
    };
  }
  private ensureLoaded(): Promise<void> {
    if (!this.initialization) {
      this.initialization = (async () => {
        this.state = await loadBackupState();
        if (this.state.legacyDoneIds.length) {
          await importLegacyDoneIds(this.state.legacyDoneIds);
          this.state.legacyDoneIds = [];
          await this.persist();
        }
      })();
      void this.initialization.catch(() => {
        this.initialization = null;
      });
    }
    return this.initialization;
  }
  private async useLibrary(
    settings: CaptureSettings,
    signal: AbortSignal,
  ): Promise<void> {
    const scope = libraryKey(settings);
    if (scope === this.scope) return;
    const state = await loadBackupState(scope);
    const count = await backedUpCount(scope);
    await assertActiveConnection(settings);
    throwIfAborted(signal);
    this.scope = scope;
    this.state = state;
    this.totalDone = count;
  }
  private emit() {
    const progress = this.snapshot();
    for (const listener of this.listeners) listener(progress);
  }
  private persist(scope = this.scope) {
    return saveBackupState(
      { ...this.state, failed: [...this.state.failed] },
      scope || undefined,
    );
  }
  async isAuto() {
    await this.ensureLoaded();
    return this.state.auto;
  }
  async setAuto(auto: boolean) {
    await this.ensureLoaded();
    this.state.auto = auto;
    await this.persist();
    this.emit();
    if (auto) void this.run();
    else this.stop();
  }
  async setWifiOnly(value: boolean) {
    await this.ensureLoaded();
    this.state.wifiOnly = value;
    await this.persist();
    if (value) this.stop();
    this.emit();
    if (this.state.auto) {
      if (this.pass) await this.pass;
      void this.run();
    }
  }
  async setAlbums(ids: string[]) {
    await this.ensureLoaded();
    this.stop();
    if (this.pass) await this.pass;
    this.state.albumIds = ids;
    this.state.scan = undefined;
    await this.persist();
    this.emit();
    if (this.state.auto) void this.run();
  }
  async listAlbums(): Promise<BackupAlbum[]> {
    await this.ensureLoaded();
    if (!(await this.ensurePermission(false))) return [];
    return (await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true }))
      .filter((a) => a.assetCount > 0)
      .map((a) => ({ id: a.id, title: a.title, assetCount: a.assetCount }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }
  dispose() {
    this.stop();
    this.unsubscribeIdentity();
    this.listeners.clear();
  }
  stop() {
    this.allowRetry = false;
    this.controller?.abort();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
  run(
    options: { background?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    if (this.pass) return this.pass;
    const controller = new AbortController();
    this.controller = controller;
    this.allowRetry = true;
    const stop = () => controller.abort();
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.signal?.aborted) stop();
    const deadline = setTimeout(
      stop,
      options.background ? 90_000 : 10 * 60_000,
    );
    // Claim the pass synchronously, before any permission/settings await.
    const pass = Promise.resolve().then(() =>
      this.runPass(controller.signal, options.background ?? false),
    );
    this.pass = pass.finally(() => {
      clearTimeout(deadline);
      options.signal?.removeEventListener('abort', stop);
      this.controller = null;
      this.pass = null;
      this.activeConnection = null;
      this.currentFile = '';
      this.currentPercent = 0;
      this.emit();
      if (
        this.allowRetry &&
        this.pending > 0 &&
        this.state.auto &&
        !options.background &&
        AppState.currentState === 'active'
      )
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.run();
        }, 15_000);
    });
    this.emit();
    return this.pass;
  }
  private async runPass(
    signal: AbortSignal,
    background: boolean,
  ): Promise<void> {
    let unsubscribe = () => {};
    try {
      await abortable(this.ensureLoaded(), signal);
      throwIfAborted(signal);
      let settings = await loadCaptureSettings();
      this.activeConnection = settings;
      if (!settings.baseURL || !settings.deviceToken) {
        this.message = 'Connect this device in Settings first.';
        return;
      }
      if (!settings.serverID || !settings.ownerID) {
        settings = await connectCaptureSettings(settings, signal);
        if (!settings.serverID || !settings.ownerID)
          throw new Error(
            'Update your Kuraki server to verify completed backups.',
          );
      }
      // Identity resolution may publish a connection epoch; start the media
      // pass only after its authenticated identity is settled.
      throwIfAborted(signal);
      this.activeConnection = settings;
      await this.useLibrary(settings, signal);
      const scope = libraryKey(settings);
      if (
        !(await abortable(this.ensurePermission(background, signal), signal))
      ) {
        this.message = 'Photo access is needed. Open Permissions in Settings.';
        return;
      }
      await this.checkNetwork(signal);
      unsubscribe = onConnectionChange((connection) => {
        if (evaluateNetworkGate(connection, this.state.wifiOnly) !== 'allowed')
          this.controller?.abort();
      });
      this.pending = 0;
      let uploaded = 0;
      let attempts = 0;
      let pageNumber = 0;
      this.message = 'Looking for new photos…';
      this.emit();
      for await (const page of this.assetPages(signal)) {
        const receipts = await loadBackupReceipts(
          scope,
          page.map((a) => a.id),
        );
        const available = await availableOriginals(
          settings,
          [...receipts.values()].flatMap((receipt) => receipt.originals),
          signal,
        );
        for (const asset of page) {
          const receipt = receipts.get(asset.id);
          if (
            receipt &&
            !receipt.originals.every((proof) => available.has(proof.asset_id))
          ) {
            await forgetReceipt(scope, asset.id);
            receipts.delete(asset.id);
          }
        }
        this.totalDone = await backedUpCount(scope);
        let complete = true;
        let pageAttempts = 0;
        const newest = pageNumber++ === 0;
        for (const asset of page) {
          throwIfAborted(signal);
          if (receipts.get(asset.id)?.localVersion === localVersion(asset))
            continue;
          // Reserve work for history even when every recent item fails.
          if (newest && pageAttempts >= 50) continue;
          if (attempts++ >= 100) {
            complete = false;
            break;
          }
          pageAttempts++;
          this.pending++;
          this.currentFile = asset.filename;
          this.currentPercent = 0;
          this.emit();
          try {
            await this.checkNetwork(signal);
            await assertActiveConnection(settings);
            const components = await resolveComponents(asset, signal);
            const proofs: OriginalProof[] = [];
            for (const component of components) {
              const done = await uploadFile(
                settings,
                {
                  uri: component.uri,
                  filename: component.filename,
                  takenAt: captureTimestamp(asset.creationTime),
                },
                (sent, total) => {
                  this.currentPercent = Math.round((sent / total) * 100);
                  this.emit();
                },
                signal,
                {
                  load: () =>
                    loadResumableUpload(
                      component.id,
                      scope,
                      localVersion(asset),
                    ),
                  save: (upload) =>
                    saveResumableUpload(
                      component.id,
                      upload,
                      scope,
                      localVersion(asset),
                    ),
                  clear: () => clearResumableUpload(component.id, scope),
                },
                {
                  requireReceipt: true,
                  beforeChunk: () => this.checkNetwork(signal),
                },
              );
              if (!done.proof)
                throw new Error('The server has not confirmed this original.');
              proofs.push(done.proof);
            }
            throwIfAborted(signal);
            await assertActiveConnection(settings);
            const current = await abortable(
              MediaLibrary.getAssetInfoAsync(asset, {
                shouldDownloadFromNetwork: false,
              }),
              signal,
            );
            if (localVersion(current) !== localVersion(asset))
              throw new Error(
                'This item changed during backup. Retry it before removing a local copy.',
              );
            await markBackedUp(asset.id, scope, {
              localVersion: localVersion(asset),
              originals: proofs,
            });
            throwIfAborted(signal);
            await assertActiveConnection(settings);
            this.pending--;
            uploaded++;
            this.state.failed = this.state.failed.filter(
              (f) => f.localId !== asset.id,
            );
            this.state.lastSuccess = {
              filename: asset.filename,
              at: Date.now(),
            };
            await this.persist(scope);
            const count = await backedUpCount(scope);
            throwIfAborted(signal);
            this.totalDone = count;
          } catch (error) {
            if (isAbort(error) || signal.aborted) throw error;
            if (error instanceof RequestError && error.status === 202) {
              this.state.failed = this.state.failed.filter(
                (f) => f.localId !== asset.id,
              );
            } else {
              this.pending--;
              this.recordFailure({
                localId: asset.id,
                filename: asset.filename,
                error:
                  error instanceof Error ? error.message : 'Upload failed.',
                at: Date.now(),
              });
            }
            await this.persist(scope);
          }
          this.emit();
        }
        if (!complete) break;
        // The generator persists an opaque page cursor only after the entire
        // page has been consumed; an interrupted page is safely retried.
      }
      this.message = this.pending
        ? 'Waiting for the server to confirm originals.'
        : this.state.failed.length
          ? 'Some items need attention.'
          : this.permission === 'limited'
            ? 'Selected photos are backed up. Allow full access to include the rest.'
            : 'All caught up.';
      if (uploaded)
        void notify('backup-complete', {
          title: 'Backup finished',
          body: `${uploaded} originals confirmed on your server.`,
        }).catch(() => {});
    } catch (error) {
      this.message =
        isAbort(error) || signal.aborted
          ? 'Backup paused. Your local originals are unchanged.'
          : error instanceof Error
            ? error.message
            : 'Backup failed.';
    } finally {
      unsubscribe();
      this.emit();
    }
  }
  private async checkNetwork(signal: AbortSignal) {
    throwIfAborted(signal);
    const gate = evaluateNetworkGate(
      await currentConnection(),
      this.state.wifiOnly,
    );
    if (gate !== 'allowed')
      throw new Error(gateMessage(gate) ?? 'Waiting for Wi-Fi.');
    throwIfAborted(signal);
  }
  private async ensurePermission(background: boolean, signal?: AbortSignal) {
    const wanted = mediaTypesFor(await loadPrefs());
    if (!wanted.length) return false;
    throwIfAborted(signal);
    const result = background
      ? await MediaLibrary.getPermissionsAsync(false, wanted)
      : await MediaLibrary.requestPermissionsAsync(false, wanted);
    throwIfAborted(signal);
    this.permission = result.granted
      ? result.accessPrivileges === 'limited'
        ? 'limited'
        : 'granted'
      : 'denied';
    return result.granted;
  }
  private recordFailure(item: FailedItem) {
    this.state.failed = [
      item,
      ...this.state.failed.filter((f) => f.localId !== item.localId),
    ].slice(0, 100);
  }
  private async *assetPages(
    signal: AbortSignal,
  ): AsyncGenerator<LibraryAsset[]> {
    const types = mediaTypesFor(await loadPrefs());
    if (!types.length) return;
    const albums = this.state.albumIds.length
      ? this.state.albumIds
      : [undefined];
    const scope = JSON.stringify([albums, types]);
    let start = this.state.scan?.scope === scope ? this.state.scan : undefined;
    // Always check the newest page, then continue the saved sweep. New photos
    // cannot starve behind a large historical import.
    const newest = await abortable(
      MediaLibrary.getAssetsAsync({
        first: 100,
        album: albums[0],
        mediaType: types,
        sortBy: [['creationTime', false]],
      }),
      signal,
    );
    yield newest.assets;
    throwIfAborted(signal);
    if (!start && newest.hasNextPage)
      start = { scope, album: 0, after: newest.endCursor };
    for (let index = start?.album ?? 0; index < albums.length; index++) {
      let after = index === (start?.album ?? 0) ? start?.after : undefined;
      if (index === 0 && !after && !newest.hasNextPage) continue;
      for (let pages = 0; pages < 20; pages++) {
        throwIfAborted(signal);
        const page = await abortable(
          MediaLibrary.getAssetsAsync({
            first: 100,
            after,
            album: albums[index],
            mediaType: types,
            sortBy: [['creationTime', false]],
          }),
          signal,
        );
        yield page.assets;
        throwIfAborted(signal);
        if (!page.hasNextPage) {
          this.state.scan = { scope, album: index + 1 };
          await this.persist();
          break;
        }
        after = page.endCursor;
        this.state.scan = { scope, album: index, after };
        await this.persist();
        if (pages === 19) return;
      }
    }
    this.state.scan = undefined;
    await this.persist();
  }
}
export const backupEngine = new BackupEngine();
