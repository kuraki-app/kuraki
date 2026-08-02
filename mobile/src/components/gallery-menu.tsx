import { Button, Host, Menu, Section } from '@expo/ui/swift-ui';
import { StyleSheet } from 'react-native';

import {
  GALLERY_VIEWS,
  GROUP_OPTIONS,
  type GalleryView,
  type GroupBy,
} from '@/lib/gallery';

type Props = {
  view: GalleryView;
  groupBy: GroupBy;
  onChangeView: (view: GalleryView) => void;
  onChangeGroupBy: (groupBy: GroupBy) => void;
};

/**
 * GalleryMenu is the Gallery header's right-hand accessory: view switching and
 * grouping, in a real SwiftUI `Menu` (@expo/ui) rather than a hand-rolled
 * popover -- it gets the system's own presentation, dismissal, haptics and
 * accessibility for free. A tap opens it because `onPrimaryAction` is left
 * unset; supplying one would demote opening to a long-press.
 *
 * This used to be a whole header: a row that also drew the screen title and
 * carried its own `insets.top` padding. The title and the inset now belong to
 * the native stack header, which this mounts into as `headerRight`, so all
 * that is left is the control itself.
 */
export default function GalleryMenu({ view, groupBy, onChangeView, onChangeGroupBy }: Props) {
  return (
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
  );
}

const styles = StyleSheet.create({
  menu: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
});
