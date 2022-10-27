export class IStorage {
  _id: string;
  name: string;
  clientId: string;
  clientSecret: string;
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