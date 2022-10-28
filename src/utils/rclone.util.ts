import { DateTime } from 'luxon';
import child_process from 'child_process';

import { IStorage } from '../resources/video/interfaces/storage.interface';

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
  } else {
    newConfig += `drive_id = ${storage.folderId}\n`;
    newConfig += 'drive_type = business\n\n';
  }
  return newConfig;
}

export async function downloadFile(configPath: string, rcloneDir: string, remote: string, folder: string, file: string,
  saveFolder: string, logFn: (args: string[]) => void) {
  const args: string[] = [
    '--ignore-checksum',
    '--config', `"${configPath}"`,
    'copy', `${remote}:${folder}/${file}`,
    saveFolder
  ];
  logFn(args);
  //console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
  return new Promise<void>((resolve, reject) => {
    const rclone = child_process.spawn(`${rcloneDir}/rclone`, args, { shell: true });
    rclone.stderr.setEncoding('utf8');
    rclone.stderr.on('data', (data) => {
      reject(data);
    });

    rclone.on('close', () => {
      resolve();
    });
  });
}

export async function deletePath(configPath: string, rcloneDir: string, remote: string, path: string, logFn: (args: string[]) => void) {
  const args: string[] = [
    '--config', `"${configPath}"`,
    'purge', `${remote}:${path}`
  ];
  logFn(args);
  //console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
  return new Promise<void>((resolve, reject) => {
    const rclone = child_process.spawn(`${rcloneDir}/rclone`, args, { shell: true });
    rclone.stderr.setEncoding('utf8');
    rclone.stderr.on('data', (data) => {
      reject(data);
    });

    rclone.on('close', () => {
      resolve();
    });
  });
}

export async function deleteRemote(configPath: string, rcloneDir: string, remote: string, logFn: (args: string[]) => void) {
  const args: string[] = [
    '--config', `"${configPath}"`,
    'config', 'delete',
    remote
  ];
  logFn(args);
  //console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
  return new Promise<void>((resolve, reject) => {
    const rclone = child_process.spawn(`${rcloneDir}/rclone`, args, { shell: true });
    rclone.stderr.setEncoding('utf8');
    rclone.stderr.on('data', (data) => {
      reject(data);
    });

    rclone.on('close', () => {
      resolve();
    });
  });
}