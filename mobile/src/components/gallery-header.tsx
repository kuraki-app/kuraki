import { Stack } from 'expo-router';

import { useTokens } from '@/constants/theme';
import { backupIndicator, type Indicator } from '@/lib/backup-indicator';
import type { BackupProgress } from '@/lib/backup-engine';
import { GALLERY_VIEWS, galleryTitle, type GalleryView } from '@/lib/gallery';

type Props = {
  view: GalleryView;
  onChangeView: (view: GalleryView) => void;
  /** Null until the engine's first snapshot arrives; the item stays hidden. */
  progress: Pick<BackupProgress, 'running' | 'pending' | 'done' | 'failed'> | null;
  onPressSync: () => void;
  onPressProfile: () => void;
};

/**
 * GalleryHeader is the Gallery's resting header: which view is on screen, what
 * backup is doing, and the way into the profile dialog.
 *
 * The view switcher *is* the title. It replaces a `line.3.horizontal.decrease`
 * button that was called a filter but held three unrelated things — the view,
 * the grouping, and Select. Grouping already had a home in Settings > Photo
 * Grid, so the header copy was a duplicate; Select moved to a long-press; and
 * what was left is the view, which reads better as the title it was already
 * sitting next to than as a funnel icon.
 *
 * Every item carries both an `Icon` and a `Label` so iOS takes the symbol and
 * Android — which silently drops SF Symbols — takes the text.
 */
export default function GalleryHeader({
  view,
  onChangeView,
  progress,
  onPressSync,
  onPressProfile,
}: Props) {
  const tokens = useTokens();
  const indicator: Indicator = progress
    ? backupIndicator(progress)
    : { state: 'hidden', percent: 0 };

  return (
    <>
      {/* The title, as a menu. No icon: an item with a Label and no Icon
          renders as its text, which is what makes this read as a title rather
          than as another button. */}
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Menu
          accessibilityLabel="Choose which photos to show"
          tintColor={tokens.foreground}
          hidesSharedBackground>
          <Stack.Toolbar.Label>{galleryTitle(view)}</Stack.Toolbar.Label>
          {GALLERY_VIEWS.map((v) => (
            // The tick is the system's own (`isOn`) rather than a checkmark
            // placed in the icon slot by hand.
            <Stack.Toolbar.MenuAction key={v.key} isOn={v.key === view} onPress={() => onChangeView(v.key)}>
              {v.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <Stack.Toolbar placement="right">
        {/* Absent, not greyed, when there is nothing to report. Automatic
            backup spends most of its life queued between OS wakes, and an
            indicator that is permanently lit stops being an indicator. */}
        {indicator.state !== 'hidden' ? (
          <Stack.Toolbar.Button
            accessibilityLabel={
              indicator.state === 'syncing'
                ? `Backing up, ${indicator.percent} percent done`
                : 'Backup finished with failures'
            }
            tintColor={indicator.state === 'failed' ? tokens.destructive : tokens.foreground}
            hidesSharedBackground
            onPress={onPressSync}>
            <Stack.Toolbar.Icon
              sf={indicator.state === 'failed' ? 'exclamationmark.arrow.circlepath' : 'arrow.triangle.2.circlepath'}
            />
            <Stack.Toolbar.Label>
              {indicator.state === 'syncing' ? `${indicator.percent}%` : 'Failed'}
            </Stack.Toolbar.Label>
          </Stack.Toolbar.Button>
        ) : null}
        <Stack.Toolbar.Button
          accessibilityLabel="Your library and settings"
          tintColor={tokens.foreground}
          hidesSharedBackground
          onPress={onPressProfile}>
          <Stack.Toolbar.Icon sf="person.crop.circle" />
          <Stack.Toolbar.Label>Profile</Stack.Toolbar.Label>
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
