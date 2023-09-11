import { Schema } from 'mongoose';

export interface IMediaStorageStream {
  _id: bigint;
  type: number;
  name: string;
  quality: number;
  codec: number;
  channels: number;
  mimeType: string;
  size: number;
}

export const mediaStorageStreamSchema = new Schema<IMediaStorageStream>({
  _id: { type: Schema.Types.Mixed, required: true },
  type: { type: Number, required: true },
  name: { type: String, required: true },
  quality: { type: Number, required: true },
  codec: { type: Number, required: false },
  channels: { type: Number, required: false },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true }
});

//export const mediaStorageStreamModel = model<IMediaStorageStream>('mediastorage', mediaStorageStreamSchema);