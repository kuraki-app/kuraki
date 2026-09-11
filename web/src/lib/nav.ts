import {
  Images,
  Star,
  FolderOpen,
  CalendarClock,
  MapPin,
  Tags,
  Archive,
  EyeOff,
  Copy,
  Trash2,
  Settings,
  Search,
  type Icon
} from '@lucide/svelte';

export type Register = 'kura' | 'vault';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof Icon;
  /** Which register the page frame renders in. Photo components ignore this. */
  register: Register;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface MobileNavItem extends NavItem {
  search?: boolean;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Library',
    items: [
      { href: '/', label: 'Photos', icon: Images, register: 'kura' },
      { href: '/favorites', label: 'Favorites', icon: Star, register: 'kura' },
      { href: '/albums', label: 'Albums', icon: FolderOpen, register: 'kura' },
      { href: '/memories', label: 'On this day', icon: CalendarClock, register: 'kura' },
      { href: '/places', label: 'Places', icon: MapPin, register: 'kura' },
      { href: '/tags', label: 'Tags', icon: Tags, register: 'kura' }
    ]
  },
  {
    label: 'Organize',
    items: [
      { href: '/archive', label: 'Archive', icon: Archive, register: 'kura' },
      { href: '/hidden', label: 'Hidden', icon: EyeOff, register: 'kura' },
      // Vault frames hosting Kura grids: the decision is operational, but the
      // objects are still memories.
      { href: '/duplicates', label: 'Duplicates', icon: Copy, register: 'vault' },
      { href: '/trash', label: 'Trash', icon: Trash2, register: 'vault' }
    ]
  },
  {
    label: 'Server',
    items: [
      // The four items this group used to hold (Overview/Devices/Activity/
      // Settings) are now nested routes under /settings — see
      // web/src/routes/settings/+layout.svelte for that sub-nav.
      { href: '/settings', label: 'Settings', icon: Settings, register: 'vault' }
    ]
  }
];

const ALL: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Looks up a nav item by href, failing loudly at module load if it is
 *  missing — a clear boot error beats a mystery crash inside a component
 *  the first time a mobile viewport renders. */
function requireNavItem(href: string): NavItem {
  const item = ALL.find((i) => i.href === href);
  if (!item) {
    throw new Error(`nav.ts: MOBILE_TABS references unknown href "${href}" — check NAV_GROUPS`);
  }
  return item;
}

/** Mirrors the native app's four system tabs. Secondary library views live in
 * Settings on a phone instead of competing with the primary destinations. */
export const MOBILE_TABS: MobileNavItem[] = [
  requireNavItem('/'),
  requireNavItem('/albums'),
  requireNavItem('/settings'),
  { href: '/?search=1', label: 'Search', icon: Search, register: 'kura', search: true }
];

export function isMobileActive(item: MobileNavItem, pathname: string, search: string): boolean {
  if (item.search) return pathname === '/' && search === '1';
  if (item.href === '/') return pathname === '/' && search !== '1';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function registerFor(pathname: string): Register {
  // Longest match wins, so /albums/[id] resolves to /albums and not /.
  const match = ALL.filter((i) => isActive(i.href, pathname)).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
  return match?.register ?? 'kura';
}
