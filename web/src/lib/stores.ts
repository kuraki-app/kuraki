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

// The file input and the whole upload pipeline live in the root layout, because
// the drop target is the entire window. Any page can ask for the picker by
// bumping this — the layout is the only subscriber. Without it, the timeline's
// empty state could describe where the Upload button is but could not BE one,
// which is the difference between an instruction and an invitation.
export const uploadRequest = writable(0);
export function requestUpload() {
  uploadRequest.update((n) => n + 1);
}
