export interface IVideoData {
  _id: string;
  filename: string;
  path: string;
  size: number;
  mimeType: string;
  producerUrl: string;
  storage: string;
  media: string;
  episode?: string;
  //audioParams: string;
  //audio2Params: string;
  //h264Params: string;
  //vp9Params: string;
  //av1Params: string;
  //qualityList: number[];
  //encodingSettings: IEncodingSetting[];
  codec: number;
  linkedStorage?: string;
  advancedOptions: IAdvancedOptions;
  isPrimary: boolean;
  user: string;
  update?: boolean;
  replaceStreams?: string[];
}

export interface IEncodingSetting {
  quality: number;
  crf: number;
  h265Crf: number;
  cq: number;
  maxrate: number;
  bufsize: number;
  useLowerRate: boolean;
}

export interface IAdvancedOptions {
  selectAudioTracks?: number[];
  extraAudioTracks?: number[];
  forceVideoQuality?: number[];
  h264Tune?: string;
  queuePriority?: number;
  audioOnly?: boolean;
  videoOnly?: boolean;
  videoCodecs?: number;
  overrideSettings?: IEncodingSetting[];
}