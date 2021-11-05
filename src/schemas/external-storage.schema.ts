import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

import { SnowFlakeId } from '../utils/snowflake-id.util';

export type ExternalStorageDocument = ExternalStorage & Document;

@Schema()
export class ExternalStorage {
  @Prop({ default: () => new SnowFlakeId().create() })
  _id: string;

  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true })
  kind: string;

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
