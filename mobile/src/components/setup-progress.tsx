import { StyleSheet, View } from 'react-native';

import MotionProgress from '@/components/motion-progress';
import { Space, useTokens } from '@/constants/theme';

export default function SetupProgress({ step, total }: { step: number; total: number }) {
  const tokens = useTokens();

  return (
    <View style={styles.frame}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Setup progress"
        accessibilityValue={{ min: 1, max: total, now: step }}
        style={[styles.track, { backgroundColor: tokens.secondary }]}>
        <MotionProgress fraction={step / total} color={tokens.stamp} style={styles.fill} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    paddingHorizontal: Space.four,
    paddingTop: Space.three,
    paddingBottom: Space.one,
  },
  track: { height: 4, borderRadius: 999, overflow: 'hidden' },
  fill: { borderRadius: 999 },
});
