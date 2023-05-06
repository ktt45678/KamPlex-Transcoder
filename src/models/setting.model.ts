import { Schema, model } from 'mongoose';

interface ISetting {
  _id: bigint;
  defaultStreamCodecs: number;
  streamAudioParams: string;
  streamAudio2Params: string;
  streamH264Params: string;
  streamVP9Params: string;
  streamAV1Params: string;
  streamQualityList: number[];
  streamEncodingSettings: IEncodingSetting[];
}

interface IEncodingSetting {
  quality: number;
  crf: number;
  cq: number;
  maxrate: number;
  bufsize: number;
  useLowerRate: boolean;
}

const encodingSettingSchema = new Schema<IEncodingSetting>({
  quality: { type: Number, required: true },
  crf: { type: Number },
  cq: { type: Number },
  maxrate: { type: Number },
  bufsize: { type: Number },
  useLowerRate: { type: Boolean }
});

const settingSchema = new Schema<ISetting>({
  _id: { type: Schema.Types.Mixed, required: true },
  defaultStreamCodecs: { type: Number },
  streamAudioParams: { type: String },
  streamAudio2Params: { type: String },
  streamH264Params: { type: String },
  streamVP9Params: { type: String },
  streamAV1Params: { type: String },
  streamQualityList: { type: [Number] },
  streamEncodingSettings: { type: [encodingSettingSchema] }
});

export const settingModel = model<ISetting>('setting', settingSchema);