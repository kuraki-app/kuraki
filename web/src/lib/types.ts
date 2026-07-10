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
  place_city?: string;
  place_country?: string;
  original_url: string;
  thumbnail_url?: string;
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

export type PlaceGroup = {
  city: string;
  country: string;
  count: number;
  cover_asset_id: string;
  cover_thumb_url: string;
};
