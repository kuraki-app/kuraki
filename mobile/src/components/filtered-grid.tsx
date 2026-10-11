import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import PhotoGrid from '@/components/photo-grid';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { fetchLibrary, type LibraryAsset } from '@/lib/library-api';
import { loadCaptureSettings, type CaptureSettings } from '@/lib/settings';
import { isAbort } from '@/lib/request';

/** A filtered list owns its request generation, pagination lock and retry state. */
export default function FilteredGrid({
  kind,
  id,
  emptyMessage,
}: {
  kind: 'trip' | 'tag';
  id: string;
  emptyMessage: string;
}) {
  const [settings, setSettings] = useState<CaptureSettings | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const paging = useRef(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    operation.current = controller;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      setAssets([]);
      setCursor(undefined);
      void (async () => {
        try {
          const connection = await loadCaptureSettings();
          const page = await fetchLibrary(
            connection,
            { [kind]: id },
            undefined,
            controller.signal,
          );
          if (current !== generation.current || controller.signal.aborted)
            return;
          setSettings(connection);
          setAssets(page.assets);
          setCursor(page.next_cursor);
        } catch (cause) {
          if (current === generation.current && !isAbort(cause))
            setError(
              cause instanceof Error ? cause.message : 'Could not load photos.',
            );
        } finally {
          if (current === generation.current) setLoading(false);
        }
      })();
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
      generation.current=current+1;
      paging.current = false;
    };
  }, [kind, id, attempt]);
  const loadMore = useCallback(async () => {
    if (!settings || !cursor || paging.current || loading) return;
    paging.current = true;
    const current = generation.current;
    try {
      const page = await fetchLibrary(
        settings,
        { [kind]: id },
        cursor,
        operation.current?.signal,
      );
      if (current !== generation.current) return;
      setAssets((previous) => {
        const seen = new Set(previous.map((a) => a.id));
        return [...previous, ...page.assets.filter((a) => !seen.has(a.id))];
      });
      setCursor(page.next_cursor === cursor ? undefined : page.next_cursor);
      setError('');
    } catch (cause) {
      if (current === generation.current && !isAbort(cause))
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not load more photos.',
        );
    } finally {
      if (current === generation.current) paging.current = false;
    }
  }, [settings, cursor, kind, id, loading]);
  return (
    <ThemedView style={{ flex: 1 }}>
      {error ? (
        <View style={{ padding: 16 }}>
          <ThemedText>{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAttempt((n) => n + 1)}
            style={{ paddingVertical: 12 }}
          >
            <ThemedText>Try again</ThemedText>
          </Pressable>
        </View>
      ) : null}
      <PhotoGrid
        assets={assets}
        settings={settings}
        loading={loading}
        onEndReached={() => void loadMore()}
        hasMore={!!cursor}
        emptyMessage={emptyMessage}
      />
    </ThemedView>
  );
}
