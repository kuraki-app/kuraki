import { ScrollView, StyleSheet } from 'react-native';

import { SettingsSection } from '@/components/settings-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing, useTokens } from '@/constants/theme';

/**
 * Free up space is specified but not built — it is its own spec, because it
 * deletes photos from the camera roll and that needs a retention policy and a
 * dependable "this is definitely on the server" check before it deletes
 * anything.
 *
 * The screen exists now so the profile dialog's row goes somewhere and says so.
 * A row that navigates nowhere is worse than one that explains itself, and a
 * row hidden until the feature lands would make the dialog change shape under
 * the user later.
 *
 * The foundation is already here: `loadBackedUpIds()` in lib/backup-ledger.ts
 * is the set of local assets confirmed uploaded, which is exactly the input the
 * deletable-list needs.
 */
export default function FreeUpSpaceSettings() {
  const tokens = useTokens();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.fill, { backgroundColor: tokens.background }]}
      contentContainerStyle={styles.content}>
      <SettingsSection
        title="Not built yet"
        footer="Deleting photos off this device is irreversible, so it is being designed on its own rather than bolted onto the storage panel.">
        <ThemedText type="small" themeColor="mutedForeground">
          This will back up everything outstanding, then offer to remove the local copies of photos
          confirmed to be on your server — with a retention window so recent photos stay on the
          phone.
        </ThemedText>
      </SettingsSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: Spacing.five },
});
