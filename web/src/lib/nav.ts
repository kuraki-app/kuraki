import {
  Images,
  Star,
  FolderOpen,
  CalendarClock,
  MapPin,
  Archive,
  EyeOff,
  Copy,
  Trash2,
  BarChart3,
  Smartphone,
  Activity,
  Settings,
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

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Library',
    items: [
      { href: '/', label: 'Timeline', icon: Images, register: 'kura' },
      { href: '/favorites', label: 'Favorites', icon: Star, register: 'kura' },
      { href: '/albums', label: 'Albums', icon: FolderOpen, register: 'kura' },
      { href: '/memories', label: 'On this day', icon: CalendarClock, register: 'kura' },
      { href: '/places', label: 'Places', icon: MapPin, register: 'kura' }
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
      // Renamed from "Library": /stats is the dashboard ABOUT the library, not
      // the library. The old label collided with the group above.
      { href: '/stats', label: 'Overview', icon: BarChart3, register: 'vault' },
      { href: '/devices', label: 'Devices', icon: Smartphone, register: 'vault' },
      { href: '/activity', label: 'Activity', icon: Activity, register: 'vault' },
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

/** Five is the ceiling: a sixth tab shrinks targets below a thumb hit area.
 *  Four routes here plus the More trigger in MobileNav makes five. */
export const MOBILE_TABS: NavItem[] = [
  requireNavItem('/'),
  requireNavItem('/favorites'),
  requireNavItem('/albums'),
  requireNavItem('/places')
];

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
