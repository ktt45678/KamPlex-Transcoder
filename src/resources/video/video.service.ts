import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import mongoose from 'mongoose';
import { stdout } from 'process';
import child_process from 'child_process';
import path from 'path';
import FFprobe from 'ffprobe';

import { externalStorageModel } from '../../models/external-storage.model';
import { IVideoData } from './interfaces/video-data.interface';
import { IStorage } from './interfaces/storage.interface';
import { Progress } from './entities/progress.entity';
import { StatusCode } from '../../enums/status-code.enum';
import { StreamCodec } from '../../enums/stream-codec.enum';
import { findInFile, appendToFile, deleteFile } from '../../utils/file-helper.util';
import { createRcloneConfig, downloadFile, deletePath } from '../../utils/rclone.util';
import { StringCrypto } from '../../utils/string-crypto.util';
import { SnowFlakeId } from '../../utils/snowflake-id.util';
import { ENCODING_QUALITY, AUDIO_PARAMS, VIDEO_H264_PARAMS, VIDEO_VP9_PARAMS, VIDEO_AV1_PARAMS } from '../../config';

@Injectable()
export class VideoService {
  AudioParams: string[];
  VideoH264Params: string[];
  VideoVP9Params: string[];
  VideoAV1Params: string[];
  SnowFlakeId: SnowFlakeId;

  constructor(private configService: ConfigService) {
    const audioParams = this.configService.get<string>('AUDIO_PARAMS');
    this.AudioParams = audioParams ? audioParams.split(' ') : AUDIO_PARAMS;
    const videoH264Params = this.configService.get<string>('VIDEO_H264_PARAMS');
    this.VideoH264Params = videoH264Params ? videoH264Params.split(' ') : VIDEO_H264_PARAMS;
    const videoVP9Params = this.configService.get<string>('VIDEO_VP9_PARAMS');
    this.VideoVP9Params = videoVP9Params ? videoVP9Params.split(' ') : VIDEO_VP9_PARAMS;
    const videoAV1Params = this.configService.get<string>('VIDEO_AV1_PARAMS');
    this.VideoAV1Params = videoAV1Params ? videoAV1Params.split(' ') : VIDEO_AV1_PARAMS;
    this.SnowFlakeId = new SnowFlakeId();
  }

  async transcode(job: Job<IVideoData>, codec: number) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const transcodeDir = this.configService.get<string>('TRANSCODE_DIR');
    const ffmpegDir = this.configService.get<string>('FFMPEG_DIR');
    await deleteFile(rcloneConfigFile);
    const configExists = await findInFile(rcloneConfigFile, `[${job.data.storage}]`);
    if (!configExists) {
      await mongoose.connect(this.configService.get<string>('DATABASE_URL'));
      let externalStorage = await externalStorageModel.findById(job.data.storage).lean().exec();
      await mongoose.disconnect();
      if (!externalStorage)
        throw new Error(this.generateStatusJson(StatusCode.STORAGE_NOT_FOUND, job.data));
      externalStorage = await this.decryptToken(externalStorage);
      const newConfig = createRcloneConfig(externalStorage, this.configService.get<string>('GDRIVE_CLIENT_ID'), this.configService.get<string>('GDRIVE_CLIENT_SECRET'));
      await appendToFile(rcloneConfigFile, newConfig);
    }
    const inputFile = `${transcodeDir}/${job.data.filename}`;
    const parsedInput = path.parse(inputFile);
    console.log(`Downloading file from job id: ${job.data._id}`);
    try {
      const rcloneDir = this.configService.get<string>('RCLONE_DIR');
      const rcloneConfig = this.configService.get<string>('RCLONE_CONFIG_FILE');
      await downloadFile(rcloneConfig, rcloneDir, job.data.storage, job.data._id, job.data.filename, transcodeDir);
    } catch (e) {
      console.error(e);
      await deleteFile(inputFile);
      throw new Error(this.generateStatusJson(StatusCode.DOWNLOAD_FAILED, job.data));
    }
    let videoInfo: FFprobe.FFProbeResult;
    console.log(`Processing input file: ${inputFile}`);
    try {
      videoInfo = await FFprobe(inputFile, { path: `${ffmpegDir}/ffprobe` });
    } catch (e) {
      console.error(e);
      await deleteFile(inputFile);
      throw new Error(this.generateStatusJson(StatusCode.PROBE_FAILED, job.data));
    }
    const videoTrack = videoInfo.streams.find(s => s.codec_type === 'video');
    if (!videoTrack) {
      console.error('Video track not found');
      await deleteFile(inputFile);
      throw new Error(this.generateStatusJson(StatusCode.NO_VIDEO_TRACK, job.data));
    }
    const videoDuration = videoTrack.duration ? Math.trunc(videoTrack.duration * 1000000) : 0;
    const qualityList = this.calculateQuality(videoTrack.height);
    console.log(`Avaiable quality: ${qualityList.length ? qualityList.join(', ') : 'None'}`);
    if (!qualityList.length) {
      await deleteFile(inputFile);
      throw new Error(this.generateStatusJson(StatusCode.LOW_QUALITY_VIDEO, job.data));
    }
    console.log('Processing audio');
    const audioArgs = this.createAudioEncodingArgs(inputFile, parsedInput);
    try {
      await this.encodeMedia(audioArgs, videoDuration);
    } catch (e) {
      console.error(e);
      await Promise.all([
        deleteFile(inputFile),
        deleteFile(`${parsedInput.dir}/${parsedInput.name}_audio${parsedInput.ext}`)
      ]);
      throw new Error(this.generateStatusJson(StatusCode.ENCODE_AUDIO_FAILED, job.data));
    }
    try {
      if (codec === StreamCodec.H264_AAC) {
        console.log('Video codec: H264');
        await this.encodeByCodec(inputFile, parsedInput, videoDuration, qualityList, StreamCodec.H264_AAC, this.VideoH264Params, job);
      }
      else if (codec === StreamCodec.VP9_AAC) {
        console.log('Video codec: VP9');
        await this.encodeByCodec(inputFile, parsedInput, videoDuration, qualityList, StreamCodec.VP9_AAC, this.VideoVP9Params, job);
      }
      else if (codec === StreamCodec.AV1_AAC) {
        console.log('Video codec: AV1');
        await this.encodeByCodec(inputFile, parsedInput, videoDuration, qualityList, StreamCodec.AV1_AAC, this.VideoAV1Params, job);
      }
    } catch (e) {
      console.error(e);
      throw new Error(this.generateStatusJson(StatusCode.ENCODE_VIDEO_FAILED, job.data));
    } finally {
      console.log('Cleaning up');
      await Promise.all([
        deleteFile(inputFile),
        deleteFile(`${parsedInput.dir}/${parsedInput.name}_audio${parsedInput.ext}`)
      ]);
      console.log('Completed');
    }
    return this.generateStatus(StatusCode.FINISHED_ENCODING, job.data);
  }

  private async encodeByCodec(inputFile: string, parsedInput: path.ParsedPath, videoDuration: number, qualityList: number[], codec: number, videoParams: string[], job: Job<IVideoData>) {
    for (let i = 0; i < qualityList.length; i++) {
      console.log(`Processing video quality: ${qualityList[i]}`);
      const streamId = await this.SnowFlakeId.createAsync();
      const videoArgs = this.createVideoEncodingArgs(inputFile, parsedInput, qualityList[i], videoParams);
      const rcloneMoveArgs = this.createRcloneMoveArgs(parsedInput, qualityList[i], job.data.storage, job.data._id, streamId);
      try {
        await this.encodeMedia(videoArgs, videoDuration);
        await this.uploadMedia(rcloneMoveArgs);
      } catch (e) {
        const rcloneDir = this.configService.get<string>('RCLONE_DIR');
        const rcloneConfig = this.configService.get<string>('RCLONE_CONFIG_FILE');
        console.log('Removing unprocessed file');
        try {
          await deletePath(rcloneConfig, rcloneDir, job.data.storage, `${job.data._id}/${streamId}`);
        } catch (e) {
          console.error(e);
        }
        console.error(e);
        throw e;
      }
      await job.progress({
        sourceId: job.data._id,
        streamId: streamId,
        fileName: `${parsedInput.name}_${qualityList[i]}${parsedInput.ext}`,
        codec: codec,
        quality: qualityList[i],
        media: job.data.media,
        episode: job.data.episode,
        storage: job.data.storage
      });
    }
  }

  private createAudioEncodingArgs(inputFile: string, parsedInput: path.ParsedPath) {
    const args: string[] = [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      '-vn',
      ...this.AudioParams,
      '-f', 'mp4', `"${parsedInput.dir}/${parsedInput.name}_audio${parsedInput.ext}"`
    ];
    return args;
  }

  private createVideoEncodingArgs(inputFile: string, parsedInput: path.ParsedPath, quality: number, videoParams: string[]) {
    const args: string[] = [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      '-i', `"${parsedInput.dir}/${parsedInput.name}_audio${parsedInput.ext}"`,
      ...videoParams,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-map_metadata', '-1',
      '-vf', `scale=-2:${quality}`,
      '-movflags', '+faststart',
      '-f', 'mp4', `"${parsedInput.dir}/${parsedInput.name}_${quality}${parsedInput.ext}"`
    ];
    return args;
  }

  private createRclonePipeArgs(parsedInput: path.ParsedPath, quality: number, remote: string, parentFolder: string, streamId: string) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      'rcat', `"${remote}:${parentFolder}/${streamId}/${parsedInput.name}_${quality}${parsedInput.ext}"`
    ];
    return args;
  }

  private createRcloneMoveArgs(parsedInput: path.ParsedPath, quality: number, remote: string, parentFolder: string, streamId: string) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      'move',
      `"${parsedInput.dir}/${parsedInput.name}_${quality}${parsedInput.ext}"`,
      `"${remote}:${parentFolder}/${streamId}`
    ];
    return args;
  }

  private encodeMedia(args: string[], videoDuration: number) {
    return new Promise<void>((resolve, reject) => {
      console.log('\x1b[36m%s\x1b[0m', 'ffmpeg ' + args.join(' '));
      const ffmpeg = child_process.spawn(`${this.configService.get<string>('FFMPEG_DIR')}/ffmpeg`, args, { shell: true });

      ffmpeg.stdout.setEncoding('utf8');
      ffmpeg.stdout.on('data', async (data: string) => {
        const progress = this.parseProgress(data);
        const percent = this.progressPercent(progress.outTimeMs, videoDuration);
        stdout.write(`Encoding: ${percent}% - frame: ${progress.frame || 'N/A'} - fps: ${progress.fps || 'N/A'} - bitrate: ${progress.bitrate} - time: ${progress.outTime}\r`);
      });

      ffmpeg.stderr.setEncoding('utf8');
      ffmpeg.stderr.on('data', (data) => {
        stdout.write(data);
      });

      ffmpeg.on('exit', (code: number) => {
        stdout.write('\n');
        if (code !== 0) {
          reject(`FFmpeg exited with status code: ${code}`);
        } else {
          resolve();
        }
      });
    });
  }

  private uploadMedia(args: string[]) {
    return new Promise<void>((resolve, reject) => {
      console.log('\x1b[36m%s\x1b[0m', 'rclone ' + args.join(' '));
      const rclone = child_process.spawn(`${this.configService.get<string>('RCLONE_DIR')}/rclone`, args, { shell: true });

      rclone.stderr.setEncoding('utf8');
      rclone.stderr.on('data', (data) => {
        stdout.write(data);
      });

      rclone.on('exit', (code: number) => {
        stdout.write('\n');
        if (code !== 0) {
          reject(`Rclone exited with status code: ${code}`);
        } else {
          resolve();
        }
      });
    });
  }

  private pipeEncodeMedia(ffmpegArgs: string[], rcloneArgs: string[], videoDuration: number) {
    return new Promise<void>((resolve, reject) => {
      const ffmpegDir = this.configService.get<string>('FFMPEG_DIR');
      const rcloneDir = this.configService.get<string>('RCLONE_DIR');
      console.log('\x1b[36m%s\x1b[0m', 'ffmpeg ' + ffmpegArgs.join(' ') + ' | ' + 'rclone ' + rcloneArgs.join(' '));
      const ffmpeg = child_process.spawn(`${ffmpegDir}/ffmpeg`, ffmpegArgs, { shell: true });
      const rclone = child_process.spawn(`${rcloneDir}/rclone`, rcloneArgs, { shell: true });

      ffmpeg.stdout.pipe(rclone.stdin);

      ffmpeg.stderr.setEncoding('utf8');
      ffmpeg.stderr.on('data', (data) => {
        const progress = this.parseProgress(data);
        const percent = this.progressPercent(progress.outTimeMs, videoDuration);
        stdout.write(`Encoding: ${percent}% - frame: ${progress.frame || 'N/A'} - fps: ${progress.fps || 'N/A'} - bitrate: ${progress.bitrate} - time: ${progress.outTime}\r`);
      });

      ffmpeg.on('exit', (code: number) => {
        stdout.write('\n');
        setTimeout(() => {
          if (code !== 0) {
            reject(code);
          } else {
            resolve();
          }
        }, 5000);
      });
    });
  }

  private calculateQuality(height: number) {
    const qualityList = [];
    if (!height) return qualityList;
    for (let i = 0; i < ENCODING_QUALITY.length; i++) {
      if (height >= ENCODING_QUALITY[i]) {
        qualityList.push(ENCODING_QUALITY[i]);
      }
    }
    // Use the lowest quality when there is no suitable one
    if (!qualityList.length)
      qualityList.push(Math.min(...ENCODING_QUALITY));
    return qualityList;
  }

  private async decryptToken(storage: IStorage) {
    const stringCrypto = new StringCrypto(this.configService.get<string>('CRYPTO_SECRET_KEY'));
    if (storage.accessToken)
      storage.accessToken = await stringCrypto.decrypt(storage.accessToken);
    storage.refreshToken = await stringCrypto.decrypt(storage.refreshToken);
    return storage;
  }

  private parseProgress(data: string) {
    const tLines = data.split('\n');
    if (tLines.length < 5)
      console.log(data);
    const progress = new Progress();
    for (var i = 0; i < tLines.length; i++) {
      const key = tLines[i].split('=');
      switch (key[0]) {
        case 'frame':
          progress.frame = Number(key[1]);
          break;
        case 'fps':
          progress.fps = Number(key[1]);
          break;
        case 'bitrate':
          progress.bitrate = key[1];
          break;
        case 'total_size':
          progress.totalSize = Number(key[1]);
          break;
        case 'out_time_us':
          progress.outTimeUs = Number(key[1]);
          break;
        case 'out_time_ms':
          progress.outTimeMs = Number(key[1]);
          break;
        case 'out_time':
          progress.outTime = key[1];
          break;
        case 'dup_frames':
          progress.dupFrames = Number(key[1]);
          break;
        case 'drop_frames':
          progress.dropFrames = Number(key[1]);
          break;
        case 'speed':
          progress.speed = key[1].trim();
          break;
        case 'progress':
          progress.progress = key[1];
          break;
      }
    }
    return progress;
  }

  private generateStatusJson(code: string, jobData: IVideoData) {
    const status = this.generateStatus(code, jobData);
    console.log(status);
    return JSON.stringify(status);
  }

  private generateStatus(code: string, jobData: IVideoData) {
    return {
      code: code,
      ...jobData
    }
  }

  private progressPercent(current: number, videoDuration: number) {
    return videoDuration ? Math.trunc(current / videoDuration * 100) : 0;
  }
}