import { User } from './user.interface';

export class IVideoData {
  _id: string;
  filename: string;
  size: number;
  mimeType: string;
  storage: string;
  media: string;
  episode?: string;
  audioParams: string;
  h264Params: string;
  vp9Params: string;
  av1Params: string;
  qualityList: number[];
  isPrimary: boolean;
  user: User;
}