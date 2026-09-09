// An in-memory keychain.
//
// This was three no-op stubs that always returned null, which meant anything
// storing a credential could not be tested at all: a test could write a token
// and read back nothing, so a bug that deleted the wrong token looked identical
// to correct behaviour. Keeping the values makes the store behave the way the
// code assumes it does.
const items = new Map<string, string>();

export const AFTER_FIRST_UNLOCK = 'AFTER_FIRST_UNLOCK';
export const WHEN_UNLOCKED = 'WHEN_UNLOCKED';

export const getItemAsync = async (key: string): Promise<string | null> => items.get(key) ?? null;

export const setItemAsync = async (key: string, value: string): Promise<void> => {
  items.set(key, value);
};

export const deleteItemAsync = async (key: string): Promise<void> => {
  items.delete(key);
};

/** Test-only: start from an empty keychain. */
export const __reset = (): void => {
  items.clear();
};
