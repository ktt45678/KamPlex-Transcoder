import fs from 'fs';
import readline from 'readline';

export class FileHelper {
  async findInFile(filePath: string, keyword: string) {
    const isFileExists = await this.fileExists(filePath);
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

  async readAllText(filePath: string, options?: Parameters<typeof fs.promises.readFile>[1]) {
    return fs.promises.readFile(filePath, options);
  }

  async readAllLines(filePath: string) {
    const lines: string[] = [];
    const isFileExists = await this.fileExists(filePath);
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

  appendToFile(filePath: string, content: string) {
    return fs.promises.appendFile(filePath, content);
  }

  async fileExists(filePath: string) {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async statFile(filePath: string) {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat;
    } catch {
      return null;
    }
  }

  async renameFile(filePath: string, newPath: string) {
    const isFileExists = await this.fileExists(filePath);
    if (isFileExists)
      await fs.promises.rename(filePath, newPath);
  }

  async deleteFile(filePath: string) {
    const isFileExists = await this.fileExists(filePath);
    if (isFileExists)
      await fs.promises.unlink(filePath);
  }

  async deleteFolder(folderPath: string) {
    const isFolderExists = await this.fileExists(folderPath);
    if (isFolderExists)
      return fs.promises.rm(folderPath, { recursive: true, force: true, maxRetries: 3 });
  }

  async createDir(path: string) {
    const isPathExists = await this.fileExists(path);
    if (!isPathExists)
      return fs.promises.mkdir(path, { recursive: true });
  }

  listFiles(path: string) {
    return fs.promises.readdir(path, { withFileTypes: true });
  }
}

export const fileHelper = new FileHelper();
