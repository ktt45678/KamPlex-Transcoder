import { User } from './user.interface';

export class IVideoData {
  _id: string;
  filename: string;
  size: number;
  mimeType: string;
  storage: string;
  media: string;
  user: User;
}