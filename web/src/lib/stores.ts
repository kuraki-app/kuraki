import { writable } from 'svelte/store';
import { toast as sonner } from 'svelte-sonner';
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

// Notifications go through shadcn-svelte's Sonner toaster (rendered once in the
// root layout). showToast stays the single call site the rest of the app uses.
export function showToast(message: string) {
  sonner(message);
}
