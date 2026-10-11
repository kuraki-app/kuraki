import { DatabaseSync } from 'node:sqlite';

// Real SQLite semantics at the native-module boundary; no mocked SQL outcomes.
const databases = new Map<string, DatabaseSync>();
function parameters(args: unknown[]): (string | number | null)[] {
  return (Array.isArray(args[0]) ? args[0] : args) as (
    string | number | null
  )[];
}
export async function openDatabaseAsync(name: string) {
  let db = databases.get(name);
  if (!db) {
    db = new DatabaseSync(':memory:');
    databases.set(name, db);
  }
  const database = db;
  return {
    execAsync: async (sql: string) => database.exec(sql),
    runAsync: async (sql: string, ...args: unknown[]) =>
      database.prepare(sql).run(...parameters(args)),
    getAllAsync: async (sql: string, ...args: unknown[]) =>
      database.prepare(sql).all(...parameters(args)),
    getFirstAsync: async (sql: string, ...args: unknown[]) =>
      database.prepare(sql).get(...parameters(args)),
    withTransactionAsync: async (fn: () => Promise<void>) => {
      database.exec('BEGIN');
      try {
        await fn();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
export function resetDatabases() {
  for (const database of databases.values()) database.close();
  databases.clear();
}
export function databaseNames() {
  return [...databases.keys()];
}
