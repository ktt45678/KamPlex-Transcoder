export interface MediaQueueResult {
  _id: string;

  jobId: number | string;

  filename: string;

  size: number;

  mimeType: string;

  storage: string;

  media: string;

  episode?: string;

  isPrimary: boolean;

  user: string;

  update?: boolean;

  replaceStreams?: string[];

  progress?: Partial<MediaQueueProgress>;

  errorCode?: string;

  keepStreams?: boolean;
}

export interface MediaQueueProgress {
  sourceId: string;

  streamId: string;

  fileName: string;

  codec: number;

  runtime: number;

  quality?: number;

  channels?: number;
}
