package config

import "sync/atomic"

// Store holds a live, resolved Config that can be refreshed after a setting
// is saved, without its callers needing to know about the database or the
// environment — only Refresh's caller does. It performs no I/O itself: the
// caller loads rows and hands them in.
//
// Two snapshots are kept: Booted() is frozen at process start and never
// changes, giving RestartPending something honest to diff against; the
// atomic pointer is Current(), which Refresh replaces wholesale. This is
// safe for keys with apply:"restart" too — their consumers (queue.New,
// httpapi.Deps) copied the value once at construction and never re-read the
// Store, so updating Current() for them changes only what the UI reports
// as "configured", never what is actually running until a restart.
type Store struct {
	envFlagsCfg Config // Default() + env + CLI flags; DB never touches this
	bootedCfg   Config // envFlagsCfg layered with DB rows as of process start
	envPresent  map[string]bool
	current     atomic.Pointer[Config]
}

// NewStore resolves the initial snapshot from envFlagsCfg (already
// Default()+env+flags, e.g. from config.Load) layered with rows (the DB's
// server_settings as of boot) and envPresent (config.EnvPresent(getenv)).
func NewStore(envFlagsCfg Config, envPresent map[string]bool, rows map[string]string) *Store {
	booted := ApplyDB(envFlagsCfg, rows, envPresent)
	s := &Store{envFlagsCfg: envFlagsCfg, bootedCfg: booted, envPresent: envPresent}
	s.current.Store(&booted)
	return s
}

// Current returns the live, most-recently-refreshed config.
func (s *Store) Current() Config { return *s.current.Load() }

// Booted returns the config exactly as resolved at process start. Frozen —
// never updated by Refresh — so restart-mode keys have a stable baseline to
// diff a save against.
func (s *Store) Booted() Config { return s.bootedCfg }

// EnvPresent returns the KURAKI_* presence set this Store was built with.
func (s *Store) EnvPresent() map[string]bool { return s.envPresent }

// Refresh re-applies rows on top of envFlagsCfg (env/flags still win over any
// row) and stores the result as the new Current(). Returns the new snapshot
// so the caller can build a response from it without a second Current() call.
func (s *Store) Refresh(rows map[string]string) Config {
	next := ApplyDB(s.envFlagsCfg, rows, s.envPresent)
	s.current.Store(&next)
	return next
}
