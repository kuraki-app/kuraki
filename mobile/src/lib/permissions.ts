/**
 * The state a single permission is in, as the Permissions screen reports it.
 *
 * `limited` is the one worth naming separately. On iOS a user can grant access
 * to *selected photos*; the permission response then says `granted: true`, so
 * every ordinary check passes while the media library returns only the handful
 * of items that were picked. Automatic backup looks like it is working and
 * quietly skips almost the entire camera roll. Folding that into `granted`
 * would hide exactly the case a permissions screen exists to reveal.
 */
export type PermissionStatus = 'granted' | 'limited' | 'denied' | 'undetermined' | 'unavailable';

/** The shape both expo-media-library and expo-notifications return. */
export type PermissionResponse = {
  granted: boolean;
  canAskAgain: boolean;
  /** iOS only: 'all' | 'limited' | 'none'. */
  accessPrivileges?: string;
};

/**
 * classifyPermission turns a permission response into what to tell the user.
 *
 * `denied` means denied *and* unaskable — the system will not show a dialog
 * again, so the only route left is the Settings app. `undetermined` means it
 * has never been asked, or the OS still allows asking, so an in-app button can
 * still do the job.
 */
export function classifyPermission(response: PermissionResponse | null): PermissionStatus {
  if (!response) return 'unavailable';
  if (response.granted) {
    return response.accessPrivileges === 'limited' ? 'limited' : 'granted';
  }
  return response.canAskAgain ? 'undetermined' : 'denied';
}

/** What the row's button should do, if anything. */
export type PermissionAction = 'grant' | 'system' | 'none';

/**
 * permissionAction decides how a permission can be changed from here.
 *
 * `limited` deliberately routes to the Settings app rather than offering an
 * in-app grant: iOS treats the permission as already answered, so asking again
 * re-opens the photo picker instead of widening access to the whole library.
 */
export function permissionAction(status: PermissionStatus): PermissionAction {
  switch (status) {
    case 'undetermined':
      return 'grant';
    case 'denied':
    case 'limited':
      return 'system';
    case 'granted':
    case 'unavailable':
      return 'none';
  }
}
