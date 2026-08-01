import type { ConnectionState } from '@/lib/connection';

export type ConnectionView = 'connected' | 'unreachable' | 'disconnected' | 'unpaired';

/**
 * connectionView resolves what the Settings connection section renders.
 *
 * The ordering matters: whether a token is stored is checked first, so a paired
 * device can never fall into the `unpaired` view. That is the whole guarantee
 * behind "never show a token or code once connected" — see showsCodeInput, the
 * only place that decides a secret-bearing field is drawn at all.
 */
export function connectionView(input: {
  hasToken: boolean;
  connection: ConnectionState;
}): ConnectionView {
  if (!input.hasToken) return 'unpaired';
  switch (input.connection) {
    case 'disconnected':
      return 'disconnected';
    case 'unreachable':
      return 'unreachable';
    default:
      return 'connected';
  }
}

/** showsCodeInput gates the pairing-code field. Never true for a paired device. */
export function showsCodeInput(view: ConnectionView): boolean {
  return view === 'unpaired';
}
