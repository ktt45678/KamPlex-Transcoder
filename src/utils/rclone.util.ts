import { DateTime } from 'luxon';
import child_process from 'child_process';
import path from 'path';

import { IStorage } from '../resources/video/interfaces/storage.interface';
import { RcloneCommandOptions, RcloneFile } from '../common/interfaces';
import { escapeRegExp } from './string-helper.util';

export function createRcloneConfig(storage: IStorage) {
  const token = JSON.stringify({
    access_token: storage.accessToken,
    token_type: 'Bearer',
    refresh_token: storage.refreshToken,
    expiry: DateTime.fromJSDate(storage.expiry).toISO()
  });
  let newConfig = `[${storage._id}]\n`;
  if (storage.kind === 3) {
    newConfig += 'type = drive\n';
  }
  else {
    newConfig += 'type = onedrive\n';
  }
  newConfig += `client_id = ${storage.clientId}\n`;
  newConfig += `client_secret = ${storage.clientSecret}\n`;
  newConfig += `token = ${token}\n`;
  if (storage.kind === 3) {
    newConfig += `root_folder_id = ${storage.folderId}\n\n`;
  }
  if (storage.kind === 6) {
    const [driveId, folderId] = storage.folderId.split('#');
    folderId && (newConfig += `root_folder_id = ${storage.folderId}\n`);
    newConfig += `drive_id = ${driveId}\n`;
    newConfig += 'drive_type = business\n\n';
  }
  return newConfig;
}

export function downloadFile(configPath: string, rcloneDir: string, remote: string, folder: string, file: string,
  saveFolder: string, useFilter: boolean, logFn: (args: string[]) => void) {
  const filePath = path.posix.join(folder, file);
  const copyArgs = useFilter ?
    [`"${remote}:${folder}"`, saveFolder, '--include', `"${escapeRegExp(file)}"`] :
    [`"${remote}:${filePath}"`, saveFolder];
  const args: string[] = [
    '--ignore-checksum',
    '--config', `"${configPath}"`,
    '--low-level-retries', '5',
    'copy', ...copyArgs
  ];
  logFn(args);
  //console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
  return new Promise<void>((resolve, reject) => {
    const rclone = child_process.spawn(`"${rcloneDir}/rclone"`, args, { shell: true });
    let errorMessage = '';
    rclone.stderr.setEncoding('utf8');
    rclone.stderr.on('data', (data) => {
      errorMessage += data + '\n';
    });

    rclone.on('exit', (code) => {
      if (code === 0 || code === 9)
        resolve();
      else
        reject({ code: code, message: errorMessage })
    });
  });
}

export async function readRemoteFile(configPath: string, rcloneDir: string, remote: string, folder: string, file: string,
  logFn: (args: string[]) => void) {
  const filePath = path.posix.join(folder, file);
  const args: string[] = [
    '--config', `"${configPath}"`,
    'cat', `${remote}:${filePath}`
  ];
  logFn(args);
  return new Promise<string>((resolve, reject) => {
    const rclone = child_process.spawn(`"${rcloneDir}/rclone"`, args, { shell: true });
    let fileContent = '';
    let errorMessage = '';
    rclone.stdout.setEncoding('utf8');
    rclone.stdout.on('data', (data) => {
      fileContent += data;
    });
    rclone.stderr.setEncoding('utf8');
    rclone.stderr.on('data', (data) => {
      errorMessage += data + '\n';
    });

    rclone.on('exit', (code) => {
      if (code !== 0)
        reject({ code: code, message: errorMessage })
      else
        resolve(fileContent);
    });
  });
}

export async function deletePath(configPath: string, rcloneDir: string, remote: string, path: string, logFn: (args: string[]) => void) {
  const args: string[] = [
    '--config', `"${configPath}"`,
    'purge', `${remote}:${path}`
  ];
  logFn(args);
  const pathExist = await isPathExist(configPath, rcloneDir, remote, path);
  if (!pathExist) return;
  //console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
  return new Promise<void>((resolve, reject) => {
    const rclone = child_process.spawn(`"${rcloneDir}/rclone"`, args, { shell: true });
    let errorMessage = '';
    rclone.stderr.setEncoding('utf8');
    rclone.stderr.on('data', (data) => {
      errorMessage += data + '\n';
    });

    rclone.on('exit', (code) => {
      if (code === 0 || code === 9)
        resolve();
      else
        reject({ code: code, message: errorMessage })
    });
  });
}

export async function emptyPath(configPath: string, rcloneDir: string, remote: string, path: string, logFn: (args: string[]) => void,
  options: RcloneCommandOptions = {}) {
  const args: string[] = [
    '--config', `"${configPath}"`,
    'delete', `${remote}:${path}`,
    '--rmdirs'
  ];
  options.include && args.push('--include', options.include);
  options.exclude && args.push('--exclude', options.exclude);
  logFn(args);
  const pathExist = await isPathExist(configPath, rcloneDir, remote, path);
  if (!pathExist) return;
  return new Promise<void>((resolve, reject) => {
    const rclone = child_process.spawn(`"${rcloneDir}/rclone"`, args, { shell: true });
    let errorMessage = '';
    rclone.stderr.setEncoding('utf8');
    rclone.stderr.on('data', (data) => {
      errorMessage += data + '\n';
    });

    rclone.on('exit', (code) => {
      if (code === 0 || code === 9)
        resolve();
      else
        reject({ code: code, message: errorMessage })
    });
  });
}

export function deleteRemote(configPath: string, rcloneDir: string, remote: string, logFn: (args: string[]) => void) {
  const args: string[] = [
    '--config', `"${configPath}"`,
    'config', 'delete',
    remote
  ];
  logFn(args);
  //console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
  return new Promise<void>((resolve, reject) => {
    const rclone = child_process.spawn(`"${rcloneDir}/rclone"`, args, { shell: true });
    let errorMessage = '';
    rclone.stderr.setEncoding('utf8');
    rclone.stderr.on('data', (data) => {
      errorMessage += data + '\n';
    });

    rclone.on('exit', (code) => {
      if (code === 0 || code === 9)
        resolve();
      else
        reject({ code: code, message: errorMessage })
    });
  });
}

export function listRemoteJson(configPath: string, rcloneDir: string, remote: string, folder: string,
  options: RcloneCommandOptions = {}) {
  const args: string[] = [
    '--config', `"${configPath}"`,
    'lsjson', `${remote}:${folder}`
  ];
  options.dirsOnly && args.push('--dirs-only');
  options.filesOnly && args.push('--files-only');
  options.recursive && args.push('--recursive');
  options.include && args.push('--include', options.include);
  options.exclude && args.push('--exclude', options.exclude);
  //console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
  return new Promise<RcloneFile[]>((resolve, reject) => {
    const rclone = child_process.spawn(`"${rcloneDir}/rclone"`, args, { shell: true });
    let listJson = '';
    let errorMessage = '';
    rclone.stdout.setEncoding('utf8');
    rclone.stdout.on('data', (data) => {
      listJson += data;
    });
    rclone.stderr.setEncoding('utf8');
    rclone.stderr.on('data', (data) => {
      errorMessage += data + '\n';
    });

    rclone.on('exit', (code: number) => {
      if (code !== 0) {
        reject({ code: code, message: errorMessage });
      } else {
        const fileData = JSON.parse(listJson);
        resolve(fileData);
      }
    });
  });
}

export function isPathExist(configPath: string, rcloneDir: string, remote: string, path: string) {
  const args: string[] = [
    '--config', `"${configPath}"`,
    '--low-level-retries', '1',
    'lsd', `${remote}:${path}`
  ];
  //console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
  return new Promise<boolean>((resolve) => {
    const rclone = child_process.spawn(`"${rcloneDir}/rclone"`, args, { shell: true });
    rclone.on('exit', (code: number) => {
      if (code !== 0) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

export function mkdirRemote(configPath: string, rcloneDir: string, remote: string, path: string) {
  const args: string[] = [
    '--config', `"${configPath}"`,
    '--low-level-retries', '5',
    'mkdir', `${remote}:${path}`
  ];
  //console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
  return new Promise<boolean>((resolve) => {
    const rclone = child_process.spawn(`"${rcloneDir}/rclone"`, args, { shell: true });
    rclone.on('exit', (code: number) => {
      if (code !== 0) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}
