import { DateTime } from 'luxon';
import child_process from 'child_process';

import { IStorage } from '../resources/video/interfaces/storage.interface';

export function createRcloneConfig(storage: IStorage, clientId: string, clientSecret: string) {
  const token = JSON.stringify({
    access_token: storage.accessToken,
    token_type: 'Bearer',
    refresh_token: storage.refreshToken,
    expiry: DateTime.fromJSDate(storage.expiry).toISO()
  });
  let newConfig = `[${storage._id}]\n`;
  newConfig += 'type = drive\n';
  newConfig += `client_id = ${clientId}\n`;
  newConfig += `client_secret = ${clientSecret}\n`;
  newConfig += `token = ${token}\n`;
  newConfig += `root_folder_id = ${storage.folderId}\n\n`;
  return newConfig;
}

export async function downloadFile(configPath: string, rcloneDir: string, remote: string, folder: string, file: string, saveFolder: string) {
  const args: string[] = [
    '--ignore-checksum',
    '--config', `"${configPath}"`,
    'copy', `${remote}:${folder}/${file}`,
    saveFolder
  ];
  console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
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

export async function deletePath(configPath: string, rcloneDir: string, remote: string, path: string) {
  const args: string[] = [
    '--config', `"${configPath}"`,
    'purge', `${remote}:${path}`
  ];
  console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
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