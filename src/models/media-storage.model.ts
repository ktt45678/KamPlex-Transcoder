import { Schema, model } from 'mongoose';

interface IMediaStorage {
  _id: bigint;
  type: number;
  name: string;
  path: string;
  quality: number;
  codec: number;
  mimeType: string;
  size: number;
  media: bigint;
  episode: bigint;
  storage: bigint;
}

const mediaStorageSchema = new Schema<IMediaStorage>({
  _id: { type: Schema.Types.Mixed, required: true },
  type: { type: Number, required: true },
  name: { type: String, required: true },
  path: { type: String, required: true },
  quality: { type: Number, required: true },
  codec: { type: Number, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  media: { type: Schema.Types.Mixed, required: true },
  episode: { type: Schema.Types.Mixed },
  storage: { type: Schema.Types.Mixed, required: true }
});

export const mediaStorageModel = model<IMediaStorage>('mediastorage', mediaStorageSchema);