import fs from 'fs';
import path from 'path';
import checkDiskSpace from 'check-disk-space';

export async function getFreeSpace(path: string) {
  try {
    const { free } = await checkDiskSpace(path);
    return free;
  } catch {
    return 0;
  }
}

export async function hasFreeSpaceToCopyFile(filePath: string, copyFolder: string) {
  try {
    const { size } = await fs.promises.stat(filePath);
    const copyFolderAbsolutePath = path.resolve(copyFolder);
    const freeSpace = await getFreeSpace(copyFolderAbsolutePath);
    if ((size * 2) >= (freeSpace - 1048576)) // freeSpace - 1MB
      return false;
    return true;
  } catch (err) {
    return false;
  }
}