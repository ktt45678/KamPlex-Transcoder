import fs from 'fs';
import readline from 'readline';

export async function findInFile(filePath: string, keyword: string) {
  const isFileExists = await fileExists(filePath);
  if (!isFileExists)
    return false;
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    if (line === keyword) {
      rl.close();
      fileStream.destroy();
      return true;
    }
  }
  rl.close();
  fileStream.destroy();
  return false;
}

export async function readAllLines(filePath: string) {
  const lines = [];
  const isFileExists = await fileExists(filePath);
  if (!isFileExists)
    return lines;
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    lines.push(line);
  }
  rl.close();
  fileStream.destroy();
  return lines;
}

export function appendToFile(filePath: string, content: string) {
  return fs.promises.appendFile(filePath, content);
}

export async function fileExists(filePath: string) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function renameFile(filePath: string, newPath: string) {
  const isFileExists = await fileExists(filePath);
  if (isFileExists)
    await fs.promises.rename(filePath, newPath);
}

export async function deleteFile(filePath: string) {
  const isFileExists = await fileExists(filePath);
  if (isFileExists)
    await fs.promises.unlink(filePath);
}

export async function deleteFolder(folderPath: string) {
  if (fileExists(folderPath))
    return fs.promises.rm(folderPath, { recursive: true, force: true, maxRetries: 3 });
}