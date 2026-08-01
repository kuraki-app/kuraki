import { describe, expect, it } from 'vitest';

import type { ConnectionState } from '@/lib/connection';
import { connectionView, showsCodeInput, type ConnectionView } from '@/lib/connection-view';

const states: ConnectionState[] = ['online', 'unreachable', 'disconnected'];

describe('connectionView', () => {
  it('is unpaired only when no token is stored', () => {
    for (const connection of states) {
      expect(connectionView({ hasToken: false, connection })).toBe('unpaired');
    }
  });

  it('maps each connection state once a token exists', () => {
    expect(connectionView({ hasToken: true, connection: 'online' })).toBe('connected');
    expect(connectionView({ hasToken: true, connection: 'unreachable' })).toBe('unreachable');
    expect(connectionView({ hasToken: true, connection: 'disconnected' })).toBe('disconnected');
  });

  it('never reports unpaired while a token is stored', () => {
    // The invariant behind "no secret is ever shown once connected": only the
    // unpaired view renders a code input, so a stored token must exclude it.
    for (const connection of states) {
      expect(connectionView({ hasToken: true, connection })).not.toBe('unpaired');
    }
  });
});

describe('showsCodeInput', () => {
  it('is true only for the unpaired view', () => {
    expect(showsCodeInput('unpaired')).toBe(true);
    for (const v of ['connected', 'unreachable', 'disconnected'] as ConnectionView[]) {
      expect(showsCodeInput(v)).toBe(false);
    }
  });
});
