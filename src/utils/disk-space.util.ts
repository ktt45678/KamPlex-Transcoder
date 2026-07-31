import fs from 'fs';
import path from 'path';
import checkDiskSpace from 'check-disk-space';

export class DiskSpaceUtil {
  async getFreeSpace(path: string) {
    try {
      const { free } = await checkDiskSpace(path);
      return free;
    } catch {
      return 0;
    }
  }

  async hasFreeSpaceForSize(size: number, folder: string, reserve: number = 1073741824) {
    if (!size)
      return false;
    const freeSpace = await this.getFreeSpace(path.resolve(folder));
    return freeSpace > size + reserve;
  }

  async hasFreeSpaceToCopyFile(filePath: string, copyFolder: string) {
    try {
      const { size } = await fs.promises.stat(filePath);
      const copyFolderAbsolutePath = path.resolve(copyFolder);
      const freeSpace = await this.getFreeSpace(copyFolderAbsolutePath);
      if ((size * 2) >= (freeSpace - 1048576)) // freeSpace - 1MB
        return false;
      return true;
    } catch (err) {
      return false;
    }
  }
}

export const diskSpaceUtil = new DiskSpaceUtil();