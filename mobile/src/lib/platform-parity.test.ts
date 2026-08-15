import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_DIR = new URL('..', import.meta.url).pathname;

/**
 * `@expo/ui/swift-ui` is iOS-only, and Kuraki ships an Android APK (the server
 * serves it at /download/android). A screen built on it is not merely unstyled
 * on Android — it is inert, in two different ways:
 *
 *   - `TextFieldView` exists in the Android module but emits `onValueChange`,
 *     while the swift-ui JS wrapper listens for `onTextChange`. The field
 *     renders and accepts keystrokes that never reach JS.
 *   - `PickerView` is not registered on Android at all (the module has only
 *     `DateTimePickerView`), so `requireNativeView` has nothing to resolve.
 *
 * That combination is what made Search unusable on Android: every keystroke was
 * swallowed, so the debounce never armed and no request was ever issued. Neither
 * `tsc` nor `expo lint` can see it — the types come from the swift-ui build and
 * are perfectly valid on both platforms.
 *
 * The rule is therefore mechanical rather than stylistic: rendering code uses
 * React Native primitives, which behave the same on both platforms. If a screen
 * genuinely wants a native iOS control, it must pair it with an Android branch
 * behind `Platform.OS` and this guard's allowlist — not import the iOS module
 * and hope.
 */
const IOS_ONLY = '@expo/ui/swift-ui';

/** Directories holding rendering code, which is where the rule applies. */
const RENDERING_DIRS = ['app', 'components'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Matches a real import of the module or any of its subpaths ('/modifiers'). */
function importsIOSOnlyUI(source: string): boolean {
  return new RegExp(`from\\s+['"]${IOS_ONLY}(/[^'"]*)?['"]`).test(source);
}

describe('cross-platform rendering', () => {
  it('no screen or component imports the iOS-only @expo/ui/swift-ui module', () => {
    const offenders = RENDERING_DIRS.flatMap((dir) => sourceFiles(join(SRC_DIR, dir)))
      .filter((file) => importsIOSOnlyUI(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC_DIR.length));

    expect(offenders).toEqual([]);
  });

  it('recognises an import of the module and its subpaths', () => {
    // Guards the guard: a matcher that quietly stopped matching would report a
    // clean sweep forever, which is the failure mode that lets this regress.
    expect(importsIOSOnlyUI(`import { Host } from '${IOS_ONLY}';`)).toBe(true);
    expect(importsIOSOnlyUI(`import { pickerStyle } from '${IOS_ONLY}/modifiers';`)).toBe(true);
    expect(importsIOSOnlyUI(`import { View } from 'react-native';`)).toBe(false);
    // A mention in prose is not an import — the fixed screen still explains why
    // it does not use the module, and must not trip its own guard.
    expect(importsIOSOnlyUI(`// ${IOS_ONLY} sizes each host to its content`)).toBe(false);
  });
});
