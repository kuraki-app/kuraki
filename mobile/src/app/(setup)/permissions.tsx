import { router } from 'expo-router';
// The package root variants are deprecated and warn on every call. This
// legacy entry is Expo's documented compatibility path for the current API.
import * as MediaLibrary from 'expo-media-library/legacy';
import { useState } from 'react';

import SetupStep, { SetupButton, SetupNotice } from '@/components/setup-step';
import { markSetupComplete } from '@/lib/settings';

export default function PermissionsStep() {
  const [status, setStatus] = useState<MediaLibrary.PermissionStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestAccess() {
    setBusy(true);
    try {
      const result = await MediaLibrary.requestPermissionsAsync();
      setStatus(result.status);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    await markSetupComplete();
    router.replace('/(app)/(gallery)');
  }

  return (
    <SetupStep
      eyebrow="Last step"
      title="Allow photo access"
      description="Access lets Kuraki find new photos and back them up to your server. You stay in control."
      symbol="photo.badge.plus"
      symbolFallback="04">
      {status !== 'granted' ? (
        <SetupButton
          disabled={busy}
          onPress={() => void requestAccess()}
          label={busy ? 'Requesting…' : 'Allow photo access'}
        />
      ) : null}
      {status ? (
        <SetupNotice tone={status === 'granted' ? 'success' : 'neutral'}>
          {status === 'granted'
            ? 'Photo access is ready.'
            : status === 'undetermined'
              ? 'No response yet. You can allow access later.'
              : 'Photo access is off. Automatic backup will wait until you enable it.'}
        </SetupNotice>
      ) : null}
      <SetupButton
        variant={status === 'granted' ? 'primary' : 'secondary'}
        onPress={() => void finish()}
        label={status === 'granted' ? 'Start using Kuraki' : 'Finish without access'}
      />
    </SetupStep>
  );
}
