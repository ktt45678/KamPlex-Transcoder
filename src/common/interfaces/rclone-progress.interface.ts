export interface RcloneProgress {
  level: string;
  msg: string;
  source: string;
  stats: Stats;
  time: string;
}

export interface Stats {
  bytes: number;
  checks: number;
  deletedDirs: number;
  deletes: number;
  elapsedTime: number;
  errors: number;
  eta: number;
  fatalError: boolean;
  renames: number;
  retryError: boolean;
  speed: number;
  totalBytes: number;
  totalChecks: number;
  totalTransfers: number;
  transferTime: number;
  transfers: number;
}