import { assertNoPendingRemoval } from '@/lib/cache/mutations';
import { type BackupReceipt, validProof } from '@/lib/backup-ledger';
import {
  localVersion,
  resolveComponents,
  type LibraryAsset,
} from '@/lib/backup-engine';
import { verifyOriginal } from '@/lib/capture-api';
import { hashLocalSource } from '@/lib/media-source';
import { assertActiveConnection, type CaptureSettings } from '@/lib/settings';
import { throwIfAborted } from '@/lib/request';
import type { LocalAsset } from '@/lib/reclaim';

export async function verifyLocalReceipt(
  settings: CaptureSettings,
  asset: LibraryAsset,
  receipt: BackupReceipt,
  signal?: AbortSignal,
): Promise<LocalAsset> {
  throwIfAborted(signal);
  await assertActiveConnection(settings);
  if (
    receipt.localVersion !== localVersion(asset) ||
    !receipt.originals.every(validProof)
  )
    throw new Error(
      'This local item changed. Back it up again before removing it.',
    );
  await assertNoPendingRemoval(
    settings,
    receipt.originals.map((proof) => proof.asset_id),
  );
  const components = await resolveComponents(asset, signal, false);
  if (components.length !== receipt.originals.length)
    throw new Error('Every component needs a verified backup.');
  let size = 0;
  for (let i = 0; i < components.length; i++) {
    throwIfAborted(signal);
    const local = await hashLocalSource(components[i].uri, signal);
    const proof = receipt.originals[i];
    if (
      local.contentHash !== proof.content_hash ||
      local.sizeBytes !== proof.size_bytes
    )
      throw new Error(
        'This local item changed. Back it up again before removing it.',
      );
    await verifyOriginal(settings, proof, signal);
    size += local.sizeBytes;
  }
  throwIfAborted(signal);
  await assertActiveConnection(settings);
  return { id: asset.id, creationTime: asset.creationTime, size };
}
