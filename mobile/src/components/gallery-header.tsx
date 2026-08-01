import { Button, Host, Menu, Section } from '@expo/ui/swift-ui';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { registerStyle } from '@/design/registers';
import {
  GALLERY_VIEWS,
  GROUP_OPTIONS,
  galleryTitle,
  type GalleryView,
  type GroupBy,
} from '@/lib/gallery';

const reg = registerStyle('kura');
const heading = { fontFamily: reg.heading };

type Props = {
  view: GalleryView;
  groupBy: GroupBy;
  onChangeView: (view: GalleryView) => void;
  onChangeGroupBy: (groupBy: GroupBy) => void;
};

/**
 * GalleryHeader is one row: the title of whatever is on screen, and a filter
 * button on the right.
 *
 * The button opens a real SwiftUI `Menu` (@expo/ui) rather than a hand-rolled
 * popover — it gets the system's own presentation, dismissal, haptics and
 * accessibility for free. A tap opens it because `onPrimaryAction` is left
 * unset; supplying one would demote opening to a long-press.
 *
 * The three views replaced a row of segment buttons that, together with the
 * search field beneath it, was taking most of a phone screen before any photo
 * was visible.
 */
export default function GalleryHeader({ view, groupBy, onChangeView, onChangeGroupBy }: Props) {
  return (
    <View style={styles.row}>
      <ThemedText type="title" style={heading}>
        {galleryTitle(view)}
      </ThemedText>
      <Host matchContents style={styles.menu}>
        <Menu
          label=""
          systemImage={groupBy === 'off' ? 'line.3.horizontal.decrease' : 'line.3.horizontal.decrease.circle.fill'}>
          <Section title="View">
            {GALLERY_VIEWS.map((v) => (
              <Button
                key={v.key}
                label={v.label}
                systemImage={v.key === view ? 'checkmark' : undefined}
                onPress={() => onChangeView(v.key)}
              />
            ))}
          </Section>
          <Section title="Group by">
            {GROUP_OPTIONS.map((g) => (
              <Button
                key={g.key}
                label={g.label}
                systemImage={g.key === groupBy ? 'checkmark' : undefined}
                onPress={() => onChangeGroupBy(g.key)}
              />
            ))}
          </Section>
        </Menu>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    minHeight: 44,
  },
  menu: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
});
