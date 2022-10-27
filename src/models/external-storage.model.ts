import { Schema, model } from 'mongoose';

interface IExternalStorage {
  _id: string;
  name: string;
  kind: number;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiry: Date;
  folderId: string;
  folderName: string;
  publicUrl: string;
  inStorage: string;
  used: number;
  files: string[];
}

const externalStorageSchema = new Schema<IExternalStorage>({
  _id: { type: String, required: true },
  name: { type: String, required: true, unique: true },
  kind: { type: Number, required: true },
  accessToken: { type: String },
  clientId: { type: String, required: true },
  clientSecret: { type: String, required: true },
  refreshToken: { type: String, required: true },
  expiry: { type: Date },
  folderId: { type: String },
  folderName: { type: String },
  publicUrl: { type: String },
  inStorage: { type: String },
  used: { type: Number, default: 0 },
  files: { type: [String] }
});

export const externalStorageModel = model<IExternalStorage>('externalstorage', externalStorageSchema);