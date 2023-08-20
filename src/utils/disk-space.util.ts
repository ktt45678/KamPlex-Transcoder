import fs from 'fs';
import disk from 'diskusage';

export async function getFreeSpace(path: string) {
  try {
    const { free } = await disk.check(path);
    return free;
  } catch {
    return 0;
  }
}

export async function hasFreeSpaceToCopyFile(filePath: string) {
  try {
    const { size } = await fs.promises.stat(filePath);
    const freeSpace = await getFreeSpace('.');
    if ((size * 2) >= (freeSpace - 1048576)) // freeSpace - 1MB
      return false;
    return true;
  } catch (err) {
    return false;
  }
}