import { Schema, model } from 'mongoose';

export interface IMedia {
  _id: bigint;
  type: string;
  originalLang: string;
}

const mediaSchema = new Schema<IMedia>({
  _id: { type: Schema.Types.Mixed, required: true },
  type: { type: String, required: true },
  originalLang: { type: String }
});

export const mediaModel = model<IMedia>('media', mediaSchema);