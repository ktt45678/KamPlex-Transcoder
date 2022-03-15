export class IStorage {
  _id: string;
  name: string;
  refreshToken: string;
  accessToken: string;
  expiry: Date;
  folderId: string;
  kind: number;
  folderName: string;
  publicUrl: string;
  inStorage: string;
  used: number;
  files: string[];
}