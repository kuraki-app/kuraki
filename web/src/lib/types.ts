export type Asset = {
  id: string;
  filename: string;
  mime_type: string;
  media_type: 'image' | 'video';
  width: number;
  height: number;
  size_bytes: number;
  taken_at?: string;
  taken_day?: string;
  taken_month?: string;
  camera_make: string;
  camera_model: string;
  gps_lat?: number;
  gps_lon?: number;
  duration_ms: number;
  favorite: boolean;
  rating: number;
  archived: boolean;
  hidden: boolean;
  stack_id?: string;
  stack_size: number;
  description?: string;
  place_city?: string;
  place_country?: string;
  original_url: string;
  thumbnail_url?: string;
  preview_url?: string;
  view_url: string;
  web_viewable: boolean;
  created_at: string;
};

export type AssetList = {
  assets: Asset[];
  next_cursor?: string;
};

export type User = {
  id: string;
  username: string;
};

export type SetupStatus = {
  setup_required: boolean;
  user?: User;
};

export type Album = {
  id: string;
  name: string;
  asset_count?: number;
  created_at?: string;
};

export type DupAsset = {
  id: string;
  filename: string;
  size_bytes: number;
  taken_at?: string;
  thumbnail_url?: string;
};

export type Tag = { id: string; name: string; parent_id?: string };
export type SavedSearch = { id: string; name: string; query: Record<string, string>; created_at?: string };

export type PlaceGroup = {
  city: string;
  country: string;
  count: number;
  cover_asset_id: string;
  cover_thumb_url: string;
};

export type Job = {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  total: number;
  imported: number;
  duplicates: number;
  skipped: number;
  errors: number;
  attempts: number;
  error?: string;
  errors_detail?: { filename: string; error: string }[];
  created_at: string;
  updated_at: string;
};

export type MediaIssue = {
  asset_id: string;
  filename: string;
  media_type: 'image' | 'video';
  kind: string;
  message: string;
  created_at: string;
};

export type IntegrityRun = {
  started_at: string;
  finished_at?: string;
  checked: number;
  ok: number;
  problems: number;
  status: 'running' | 'clean' | 'problems' | 'error';
};

export type BackupRun = {
  started_at: string;
  finished_at?: string;
  destination?: string;
  bytes: number;
  status: 'running' | 'ok' | 'error';
  error?: string;
};

export type BackupStatus = {
  enabled: boolean;
  last: BackupRun | null;
};

export type LibraryStats = {
  total: number;
  images: number;
  videos: number;
  favorites: number;
  trashed: number;
  albums: number;
  places: number;
  total_bytes: number;
  by_year: { year: string; count: number }[];
};
