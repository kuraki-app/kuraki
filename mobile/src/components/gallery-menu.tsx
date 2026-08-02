import { Stack } from 'expo-router';

import { toolbarGlyph } from '@/components/screen-header';
import { useTokens } from '@/constants/theme';
import {
  GALLERY_VIEWS,
  GROUP_OPTIONS,
  type GalleryView,
  type GroupBy,
} from '@/lib/gallery';

type Props = {
  view: GalleryView;
  groupBy: GroupBy;
  selecting: boolean;
  onToggleSelecting: () => void;
  onChangeView: (view: GalleryView) => void;
  onChangeGroupBy: (groupBy: GroupBy) => void;
};

/**
 * GalleryMenu is the Gallery header's filter control: view switching and
 * grouping.
 *
 * It is a real navigation-bar item (`Stack.Toolbar`), not a SwiftUI view
 * embedded into `headerRight`.
 *
 * The embedded version was the bug: a `Host` containing an `@expo/ui` Menu is,
 * to the navigation bar, an arbitrary custom view — so iOS 26 wrapped it in the
 * shared glass background it gives bar items, and the result was a large white
 * disc floating in the corner, sized to the host rather than to a control.
 * Fighting it with a smaller host only shrank the icon inside the same disc.
 * A toolbar item *is* a bar button item, so the system sizes and places it
 * exactly like the back chevron opposite, and `hidesSharedBackground` opts out
 * of the glass so the glyph sits on the header the way this flat palette wants.
 *
 * The checkmarks are the system's own (`isOn`), rather than a `checkmark`
 * symbol placed in the icon slot by hand.
 */
export default function GalleryMenu({
  view,
  groupBy,
  selecting,
  onToggleSelecting,
  onChangeView,
  onChangeGroupBy,
}: Props) {
  const tokens = useTokens();
  // Timeline with no grouping is the resting state; anything else is a filter
  // worth marking, and the outline `.circle` variant marks it at the same
  // weight rather than switching to a heavy fill.
  const filtered = view !== 'timeline' || groupBy !== 'off';

  return (
    <Stack.Toolbar placement="right">
      {/* Multi-select had no entry point but a long-press on a tile, which
          nothing on screen hinted at. */}
      <Stack.Toolbar.Button
        {...toolbarGlyph(selecting ? 'checkmark.circle.fill' : 'checkmark.circle', selecting ? 'Done' : 'Select')}
        accessibilityLabel={selecting ? 'Stop selecting' : 'Select photos'}
        tintColor={tokens.foreground}
        hidesSharedBackground
        onPress={onToggleSelecting}
      />
      <Stack.Toolbar.Menu
        {...toolbarGlyph(
          filtered ? 'line.3.horizontal.decrease.circle' : 'line.3.horizontal.decrease',
          'View',
        )}
        accessibilityLabel="View and grouping options"
        tintColor={tokens.foreground}
        hidesSharedBackground
      >
        {/* `inline` keeps each set as a titled block in one menu instead of a
            submenu the user has to open. */}
        <Stack.Toolbar.Menu title="View" inline>
          {GALLERY_VIEWS.map((v) => (
            <Stack.Toolbar.MenuAction
              key={v.key}
              isOn={v.key === view}
              onPress={() => onChangeView(v.key)}
            >
              {v.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Menu title="Group by" inline>
          {GROUP_OPTIONS.map((g) => (
            <Stack.Toolbar.MenuAction
              key={g.key}
              isOn={g.key === groupBy}
              onPress={() => onChangeGroupBy(g.key)}
            >
              {g.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
