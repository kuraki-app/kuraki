import { File, FileMode, Paths } from 'expo-file-system';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { abortable, throwIfAborted } from '@/lib/request';

function removeTemporary(file: File): void {
  try {
    file.delete();
  } catch {
    /* own temporary cleanup only */
  }
}

export type MediaSource = {
  size: number;
  readChunk: (offset: number, length: number) => Promise<ArrayBuffer>;
  close: () => Promise<void>;
};

/** Content-provider/cloud sources are spooled by native streaming I/O, never a Blob. */
export async function openSource(
  uri: string,
  signal?: AbortSignal,
): Promise<MediaSource> {
  throwIfAborted(signal);
  let file: File;
  let temporary = false;
  if (/^https?:\/\//.test(uri)) {
    file = new File(
      Paths.cache,
      `kuraki-source-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    temporary = true;
    try {
      await File.downloadFileAsync(uri, file, { signal });
    } catch (error) {
      removeTemporary(file);
      throw error;
    }
  } else {
    file = new File(uri);
    if (uri.startsWith('content://')) {
      const copy = new File(
        Paths.cache,
        `kuraki-source-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      const copying = file.copy(copy);
      void copying
        .finally(() => {
          if (signal?.aborted) removeTemporary(copy);
        })
        .catch(() => {});
      try {
        await abortable(copying, signal);
        throwIfAborted(signal);
      } catch (error) {
        removeTemporary(copy);
        throw error;
      }
      file = copy;
      temporary = true;
    } else if (!uri.startsWith('file://'))
      throw new Error(
        'This item is not available on the device. Download it and try again.',
      );
  }
  try {
    throwIfAborted(signal);
    const size = file.size;
    if (!Number.isSafeInteger(size) || size <= 0 || size > 20 * 2 ** 30)
      throw new Error(
        'This item is empty, unavailable, or larger than the server supports.',
      );
    const handle = file.open(FileMode.ReadOnly);
    return {
      size,
      async readChunk(offset, length) {
        throwIfAborted(signal);
        handle.offset = offset;
        const bytes = handle.readBytes(length);
        if (bytes.byteLength !== length)
          throw new Error(
            'The local item changed while it was being read. Retry its backup.',
          );
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      },
      async close() {
        handle.close();
        if (temporary) removeTemporary(file);
      },
    };
  } catch (error) {
    if (temporary) removeTemporary(file);
    throw error;
  }
}

/** Reclamation checks the current local bytes against the server's BLAKE3 proof. */
export async function hashLocalSource(
  uri: string,
  signal?: AbortSignal,
): Promise<{ contentHash: string; sizeBytes: number }> {
  const source = await openSource(uri, signal);
  try {
    const hash = blake3.create();
    for (let offset = 0; offset < source.size; offset += 256 * 1024) {
      throwIfAborted(signal);
      hash.update(
        new Uint8Array(
          await source.readChunk(
            offset,
            Math.min(256 * 1024, source.size - offset),
          ),
        ),
      );
      if (offset % (4 * 1024 * 1024) === 0)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { contentHash: bytesToHex(hash.digest()), sizeBytes: source.size };
  } finally {
    await source.close();
  }
}
