import type { CaptureSettings } from '@/lib/settings';

export type CaptureSession = {
  id: string;
  filename: string;
  size_bytes: number;
  received_bytes: number;
  status: string;
  job_id?: string;
  error?: string;
};

export type CaptureStatus = {
  device_id: string;
  receiving: number;
  queued: number;
  failed: number;
  sessions: CaptureSession[];
};

type StartResponse = CaptureSession;

const uploadChunkBytes = 4 << 20;

export class CaptureAPIError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CaptureAPIError';
  }
}

export async function getCaptureStatus(settings: CaptureSettings): Promise<CaptureStatus> {
  if (!settings.baseURL || !settings.deviceToken) {
    throw new CaptureAPIError('Connect this device in Settings first.', 0);
  }
  const response = await fetch(`${settings.baseURL}/api/capture/status`, {
    headers: { Authorization: `Bearer ${settings.deviceToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
    throw new CaptureAPIError(message, response.status);
  }
  return (await response.json()) as CaptureStatus;
}

export async function uploadPhoto(
  settings: CaptureSettings,
  asset: { uri: string; filename: string },
  onProgress: (completed: number, total: number) => void,
): Promise<CaptureSession> {
  if (!settings.baseURL || !settings.deviceToken) {
    throw new CaptureAPIError('Connect this device in Settings first.', 0);
  }
  const fileResponse = await fetch(asset.uri);
  if (!fileResponse.ok) throw new CaptureAPIError('Could not read the selected photo.', fileResponse.status);
  const blob = await fileResponse.blob();
  const start = await deviceRequest<StartResponse>(settings, '/api/capture/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: asset.filename, size_bytes: blob.size }),
  });
  let offset = start.received_bytes;
  while (offset < blob.size) {
    const end = Math.min(offset + uploadChunkBytes, blob.size);
    const response = await fetch(`${settings.baseURL}/api/capture/uploads/${start.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${settings.deviceToken}`,
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': String(offset),
      },
      body: await blob.slice(offset, end).arrayBuffer(),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = typeof body.error === 'string' ? body.error : `Upload failed (${response.status})`;
      throw new CaptureAPIError(message, response.status);
    }
    offset = Number(response.headers.get('Upload-Offset'));
    if (!Number.isFinite(offset) || offset <= 0 || offset > blob.size) {
      throw new CaptureAPIError('Server returned an invalid upload receipt.', response.status);
    }
    onProgress(offset, blob.size);
  }
  return deviceRequest<CaptureSession>(settings, `/api/capture/uploads/${start.id}/complete`, { method: 'POST' });
}

async function deviceRequest<T>(settings: CaptureSettings, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${settings.baseURL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${settings.deviceToken}`, ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
    throw new CaptureAPIError(message, response.status);
  }
  return (await response.json()) as T;
}
