import { writable } from 'svelte/store';
import type { User } from './types';

export const session = writable<{ checking: boolean; setupRequired: boolean; user: User | null }>({
  checking: true,
  setupRequired: false,
  user: null
});

// Bumped after uploads so open library views reload.
export const libraryVersion = writable(0);
export function bumpLibrary() {
  libraryVersion.update((n) => n + 1);
}

export const toast = writable('');
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string) {
  toast.set(message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.set(''), 3200);
}
