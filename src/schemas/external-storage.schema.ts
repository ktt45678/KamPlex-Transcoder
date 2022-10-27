import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ExternalStorageDocument = ExternalStorage & Document;

@Schema()
export class ExternalStorage {
  @Prop()
  _id: string;

  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true })
  kind: number;

  @Prop()
  accessToken: string;

  @Prop({ required: true })
  refreshToken: string;

  @Prop()
  expiry: Date;

  @Prop()
  folderId: string;

  @Prop()
  folderName: string;

  @Prop()
  publicUrl: string;

  @Prop()
  inStorage: string;

  @Prop({ default: 0 })
  used: number;

  @Prop()
  files: string[];
}

export const ExternalStorageSchema = SchemaFactory.createForClass(ExternalStorage);
