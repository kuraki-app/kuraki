import type { components } from './api.gen';

type S = components['schemas'];

export type Asset = S['apitypes.Asset'];
export type AssetList = S['apitypes.AssetList'];
export type User = S['apitypes.User'];
export type SetupStatus = S['apitypes.SetupStatus'];
export type Album = S['apitypes.Album'];
export type Tag = S['apitypes.Tag'];
export type SavedSearch = S['apitypes.SavedSearch'];
export type PlaceGroup = S['apitypes.PlaceGroup'];
export type Job = S['apitypes.Job'];
// /api/jobs lists Job; /api/jobs/{id} returns Job + per-file errors.
export type JobDetail = S['apitypes.JobDetail'];
export type JobError = S['apitypes.JobError'];
export type MediaIssue = S['apitypes.MediaIssue'];
export type LibraryStats = S['apitypes.LibraryStats'];
export type ChangesResponse = S['apitypes.ChangesResponse'];
export type ChangeEntry = S['apitypes.ChangeEntry'];
export type SettingInfo = S['apitypes.SettingInfo'];
export type SettingsResponse = S['apitypes.SettingsResponse'];
export type SettingsPatchResponse = S['apitypes.SettingsPatchResponse'];
export type DeviceInfo = S['apitypes.DeviceInfo'];
export type UserSummary = S['apitypes.UserSummary'];
export type UserList = S['apitypes.UserList'];
export type UserCreate = S['apitypes.UserCreate'];
export type UserPatch = S['apitypes.UserPatch'];
export type UserDeleteBlocked = S['apitypes.UserDeleteBlocked'];
export type ExternalLibrary = S['apitypes.ExternalLibrary'];

// not in contract: /api/duplicates returns an untyped map (domain-package struct, kept out of swag scope)
export type DuplicateRun = {
  id: string;
  /** queued | running | done | error (duplicates.Run) */
  status: string;
  error?: string;
  total: number;
  processed: number;
  group_count: number;
};

// not in contract: /api/duplicates returns an untyped map (domain-package struct, kept out of swag scope)
export type DupAsset = {
  id: string;
  filename: string;
  size_bytes: number;
  taken_at?: string;
  thumbnail_url?: string;
};

// not in contract: /api/integrity returns an untyped map (domain-package struct, kept out of swag scope)
export type IntegrityRun = {
  started_at: string;
  finished_at?: string;
  checked: number;
  ok: number;
  problems: number;
  status: 'running' | 'clean' | 'problems' | 'error';
};

// not in contract: /api/backup returns an untyped map (domain-package struct, kept out of swag scope)
export type BackupRun = {
  started_at: string;
  finished_at?: string;
  destination?: string;
  bytes: number;
  status: 'running' | 'ok' | 'error';
  error?: string;
};

// not in contract: /api/backup returns an untyped map (domain-package struct, kept out of swag scope)
export type BackupStatus = {
  enabled: boolean;
  last: BackupRun | null;
};
