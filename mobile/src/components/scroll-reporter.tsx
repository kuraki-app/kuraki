import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { IDLE_MS, nextPillState, type PillState } from '@/lib/tab-bar';

// The tab bar reacts to scrolling that happens inside a screen, so the two need
// a channel that does not couple them. Screens call report(); the bar reads
// usePillState(). Screens that should never collapse the pill (Settings,
// Search) simply never call report.
type Reporter = { report: (e: { dy: number; atTop: boolean }) => void };

const ReporterContext = createContext<Reporter>({ report: () => {} });
const PillContext = createContext<PillState>('expanded');

export function ScrollReporterProvider({ children }: { children: ReactNode }) {
  const [pill, setPill] = useState<PillState>('expanded');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending debounce must not fire after unmount, which would set state on a
  // dead tree during a fast route change.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const report = useCallback((e: { dy: number; atTop: boolean }) => {
    setPill((current) => nextPillState(current, { ...e, idle: false }));
    if (timer.current) clearTimeout(timer.current);
    // Scrolling emits no "stopped" event, so idle is a debounce on the last one.
    timer.current = setTimeout(() => {
      setPill((current) => nextPillState(current, { dy: 0, atTop: false, idle: true }));
    }, IDLE_MS);
  }, []);

  const reporter = useMemo(() => ({ report }), [report]);

  return (
    <ReporterContext.Provider value={reporter}>
      <PillContext.Provider value={pill}>{children}</PillContext.Provider>
    </ReporterContext.Provider>
  );
}

export function useScrollReporter(): Reporter {
  return useContext(ReporterContext);
}

export function usePillState(): PillState {
  return useContext(PillContext);
}
