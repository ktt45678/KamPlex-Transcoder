export interface RcloneFile {
  Path: string;
  Name: string;
  Size: number;
  MimeType: string;
  ModTime: string;
  IsDir: boolean;
  ID: string;
}

export interface RcloneCommandOptions {
  dirsOnly?: boolean;
  filesOnly?: boolean;
  recursive?: boolean;
  include?: string;
  exclude?: string;
  filter?: string;
}