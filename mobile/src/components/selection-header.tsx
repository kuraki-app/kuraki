import { Stack } from 'expo-router';
import type { SFSymbol } from 'sf-symbols-typescript';

import { useTokens } from '@/constants/theme';

export type SelectionAction = {
  /** Stable key for the list; not shown. */
  key: string;
  /** The menu row's text. Full sentences — a menu row has a line to itself. */
  label: string;
  /** iOS only; Android drops SF Symbols and renders the text. */
  icon: SFSymbol;
  /** Red, and on iOS what the system announces as destructive. */
  destructive?: boolean;
  onPress: () => void;
};

type Props = {
  count: number;
  onCancel: () => void;
  /** Omitted where favouriting makes no sense — the Trash grid. */
  onFavorite?: () => void;
  /** True when every selected asset already is one, so the control reads
   *  "Unfavourite". See `allFavorite` in lib/selection.ts. */
  allFavorite?: boolean;
  /** Omitted on Trash, where the destructive action is Delete forever. */
  onTrash?: () => void;
  /** Everything else, behind the overflow menu. */
  actions: SelectionAction[];
};

/**
 * SelectionHeader is the header a photo grid wears while selecting: ✕ and the
 * count on the left, the actions on the right.
 *
 * It replaces the whole resting header rather than adding to it. The two are
 * mutually exclusive *by construction* at every call site — a ternary, never
 * two toolbars left to fight — because expo-router's toolbars are last-one-wins
 * per placement, and relying on render order for correctness would make the
 * header depend on where in a JSX tree something happens to sit.
 *
 * Favourite and Trash are promoted out of the overflow menu because they are
 * the two things a selection is usually for; everything rarer stays behind ⋯.
 *
 * Every item carries both an `Icon` and a `Label`: iOS shows the symbol and
 * keeps the label for VoiceOver, and Android — which silently drops SF Symbols
 * — falls back to the text on its own, so nothing here branches on platform.
 */
export default function SelectionHeader({
  count,
  onCancel,
  onFavorite,
  allFavorite = false,
  onTrash,
  actions,
}: Props) {
  const tokens = useTokens();

  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          accessibilityLabel="Stop selecting"
          tintColor={tokens.foreground}
          hidesSharedBackground
          onPress={onCancel}>
          <Stack.Toolbar.Icon sf="xmark" />
        </Stack.Toolbar.Button>
        {/* The count is a disabled item rather than the screen title: the title
            belongs to the view the grid is showing, and swapping it would make
            leaving selection look like navigating somewhere else. */}
        <Stack.Toolbar.Button disabled tintColor={tokens.foreground} hidesSharedBackground>
          <Stack.Toolbar.Label>{selectionTitle(count)}</Stack.Toolbar.Label>
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <Stack.Toolbar placement="right">
        {onFavorite ? (
          <Stack.Toolbar.Button
            accessibilityLabel={allFavorite ? 'Remove from favourites' : 'Add to favourites'}
            disabled={count === 0}
            tintColor={tokens.foreground}
            hidesSharedBackground
            onPress={onFavorite}>
            <Stack.Toolbar.Icon sf={allFavorite ? 'heart.fill' : 'heart'} />
            <Stack.Toolbar.Label>{allFavorite ? 'Unfavourite' : 'Favourite'}</Stack.Toolbar.Label>
          </Stack.Toolbar.Button>
        ) : null}
        {onTrash ? (
          <Stack.Toolbar.Button
            accessibilityLabel="Move to trash"
            disabled={count === 0}
            tintColor={tokens.destructive}
            hidesSharedBackground
            onPress={onTrash}>
            <Stack.Toolbar.Icon sf="trash" />
            <Stack.Toolbar.Label>Trash</Stack.Toolbar.Label>
          </Stack.Toolbar.Button>
        ) : null}
        {/* Disabled rather than hidden while nothing is chosen: a control that
            appears the moment the first tile is picked reads as the header
            moving under the user's thumb. */}
        <Stack.Toolbar.Menu
          accessibilityLabel="More actions for the selected photos"
          disabled={count === 0}
          tintColor={tokens.foreground}
          hidesSharedBackground>
          <Stack.Toolbar.Icon sf="ellipsis.circle" />
          <Stack.Toolbar.Label>More</Stack.Toolbar.Label>
          {actions.map((action) => (
            <Stack.Toolbar.MenuAction
              key={action.key}
              icon={action.icon}
              destructive={action.destructive}
              onPress={action.onPress}>
              {action.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    </>
  );
}

/**
 * selectionTitle is the count beside the ✕.
 *
 * Zero is a real state — Select can be on with nothing chosen — and "0
 * selected" reads as a failure rather than an invitation.
 */
export function selectionTitle(count: number): string {
  return count === 0 ? 'Select photos' : `${count} selected`;
}
