import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import mongoose from 'mongoose';
import { stdout } from 'process';
import child_process from 'child_process';
import path from 'path';
import FFprobe from 'ffprobe';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

import { externalStorageModel } from '../../models/external-storage.model';
import { IEncodeVideoAudioArgs, IVideoData, IJobData, IStorage } from './interfaces';
import { Progress } from './entities/progress.entity';
import { StatusCode } from '../../enums/status-code.enum';
import { StreamCodec } from '../../enums/stream-codec.enum';
import { RejectCode } from '../../enums/reject-code.enum';
import { findInFile, appendToFile, deleteFile, fileExists, deleteFolder } from '../../utils/file-helper.util';
import { createRcloneConfig, downloadFile, deletePath } from '../../utils/rclone.util';
import { StringCrypto } from '../../utils/string-crypto.util';
import { createSnowFlakeId } from '../../utils/snowflake-id.util';
import { ENCODING_QUALITY, AUDIO_PARAMS, AUDIO_2ND_PARAMS, VIDEO_H264_PARAMS, VIDEO_VP9_PARAMS, VIDEO_AV1_PARAMS } from '../../config';

@Injectable()
export class VideoService {
  private AudioParams: string[];
  private Audio2ndParams: string[];
  private VideoH264Params: string[];
  private VideoVP9Params: string[];
  private VideoAV1Params: string[];
  private CanceledJobIds: (string | number)[];

  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private configService: ConfigService) {
    const audioParams = this.configService.get<string>('AUDIO_PARAMS');
    this.AudioParams = audioParams ? audioParams.split(' ') : AUDIO_PARAMS;
    const audio2ndParams = this.configService.get<string>('AUDIO_2ND_PARAMS');
    this.Audio2ndParams = audio2ndParams ? audio2ndParams.split(' ') : AUDIO_2ND_PARAMS;
    const videoH264Params = this.configService.get<string>('VIDEO_H264_PARAMS');
    this.VideoH264Params = videoH264Params ? videoH264Params.split(' ') : VIDEO_H264_PARAMS;
    const videoVP9Params = this.configService.get<string>('VIDEO_VP9_PARAMS');
    this.VideoVP9Params = videoVP9Params ? videoVP9Params.split(' ') : VIDEO_VP9_PARAMS;
    const videoAV1Params = this.configService.get<string>('VIDEO_AV1_PARAMS');
    this.VideoAV1Params = videoAV1Params ? videoAV1Params.split(' ') : VIDEO_AV1_PARAMS;
    this.CanceledJobIds = [];
  }

  async transcode(job: Job<IVideoData>, codec: number = 1) {
    const cancelIndex = this.CanceledJobIds.findIndex(j => +j === +job.id);
    if (cancelIndex > -1) {
      this.CanceledJobIds = this.CanceledJobIds.filter(id => +id > +job.id);
      this.logger.info(`Received cancel signal from job id: ${job.id}`);
      return this.generateStatus(StatusCode.CANCELLED_ENCODING, job.data);
    }

    const audioParams = job.data.audioParams != undefined ? job.data.audioParams.split(' ') : this.AudioParams;
    const audio2ndParams = job.data.audio2Params != undefined ? job.data.audio2Params.split(' ') : this.Audio2ndParams;
    const videoH264Params = job.data.h264Params != undefined ? job.data.h264Params.split(' ') : this.VideoH264Params;
    const videoVP9Params = job.data.vp9Params != undefined ? job.data.vp9Params.split(' ') : this.VideoVP9Params;
    const videoAV1Params = job.data.av1Params != undefined ? job.data.av1Params.split(' ') : this.VideoAV1Params;
    const qualityList = Array.isArray(job.data.qualityList) && job.data.qualityList.length ? job.data.qualityList : ENCODING_QUALITY;

    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const transcodeDir = `${this.configService.get<string>('TRANSCODE_DIR')}/${job.id}`;
    const ffmpegDir = this.configService.get<string>('FFMPEG_DIR');

    //await deleteFile(rcloneConfigFile);
    const configExists = await findInFile(rcloneConfigFile, `[${job.data.storage}]`);
    if (!configExists) {
      this.logger.info(`Config for remote "${job.data.storage}" not found, generating...`);
      await mongoose.connect(this.configService.get<string>('DATABASE_URL'));
      let externalStorage = await externalStorageModel.findById(job.data.storage).lean().exec();
      await mongoose.disconnect();
      if (!externalStorage)
        throw new Error(this.generateStatusJson(StatusCode.STORAGE_NOT_FOUND, job.data));
      externalStorage = await this.decryptToken(externalStorage);
      const newConfig = createRcloneConfig(externalStorage);
      await appendToFile(rcloneConfigFile, newConfig);
      this.logger.info(`Generated config for remote "${job.data.storage}"`);
    }

    const inputFile = `${transcodeDir}/${job.data.filename}`;
    const parsedInput = path.parse(inputFile);
    this.logger.info(`Downloading file from media id: ${job.data._id}`);
    try {
      const rcloneDir = this.configService.get<string>('RCLONE_DIR');
      const rcloneConfig = this.configService.get<string>('RCLONE_CONFIG_FILE');
      const isFileExists = await fileExists(inputFile);
      if (!isFileExists)
        await downloadFile(rcloneConfig, rcloneDir, job.data.storage, job.data._id, job.data.filename, transcodeDir, (args => {
          this.logger.info('rclone ' + args.join(' '));
        }));
    } catch (e) {
      this.logger.error(e);
      await deleteFile(inputFile);
      throw new Error(this.generateStatusJson(StatusCode.DOWNLOAD_FAILED, job.data));
    }
    let videoInfo: FFprobe.FFProbeResult;
    this.logger.info(`Processing input file: ${inputFile}`);
    try {
      videoInfo = await FFprobe(inputFile, { path: `${ffmpegDir}/ffprobe` });
    } catch (e) {
      this.logger.error(e);
      await deleteFile(inputFile);
      throw new Error(this.generateStatusJson(StatusCode.PROBE_FAILED, job.data));
    }

    const videoTrack = videoInfo.streams.find(s => s.codec_type === 'video');
    if (!videoTrack) {
      this.logger.error('Video track not found');
      await deleteFile(inputFile);
      throw new Error(this.generateStatusJson(StatusCode.NO_VIDEO_TRACK, job.data));
    }

    const audioTracks = videoInfo.streams.filter(s => s.codec_type === 'audio');
    if (!audioTracks) {
      this.logger.error('Audio track not found');
      await deleteFile(inputFile);
      throw new Error(this.generateStatusJson(StatusCode.NO_AUDIO_TRACK, job.data));
    }

    const videoDuration = videoTrack.duration ? Math.trunc(videoTrack.duration * 1000000) : 0;
    const availableQualityList = this.calculateQuality(videoTrack.height, qualityList);
    this.logger.info(`Avaiable quality: ${availableQualityList.length ? availableQualityList.join(', ') : 'None'}`);
    if (!availableQualityList.length) {
      await deleteFile(inputFile);
      throw new Error(this.generateStatusJson(StatusCode.LOW_QUALITY_VIDEO, job.data));
    }

    this.logger.info('Processing audio');
    const audioInputForVideo = [];
    const audioMapForVideo = [];

    const audioNormalTrack = audioTracks.find(a => a.channels <= 2);
    const audioSurroundTrack = audioTracks.find(a => a.channels > 2);

    const firstAudioTrackIndex = audioNormalTrack?.index || audioSurroundTrack?.index;
    const secondAudioTrackIndex = audioSurroundTrack?.index;

    this.logger.info(`Audio track index ${firstAudioTrackIndex}`);
    const audioArgs = this.createAudioEncodingArgs(inputFile, parsedInput, audioParams, firstAudioTrackIndex);
    try {
      await this.encodeMedia(audioArgs, videoDuration, job.id);
    } catch (e) {
      this.logger.error(e);
      await deleteFolder(transcodeDir);
      // await Promise.all([
      //   deleteFile(inputFile),
      //   deleteFile(`${parsedInput.dir}/${parsedInput.name}_audio_normal.mp4`)
      // ]);
      if (e === RejectCode.JOB_CANCEL) {
        this.logger.info(`Received cancel signal from job id: ${job.id}`);
        return this.generateStatus(StatusCode.CANCELLED_ENCODING, job.data);
      }
      throw new Error(this.generateStatusJson(StatusCode.ENCODE_AUDIO_FAILED, job.data));
    }
    audioInputForVideo.push('-i', `"${parsedInput.dir}/${parsedInput.name}_audio_${firstAudioTrackIndex}.mp4"`);
    audioMapForVideo.push('-map', '1:a:0');

    // Encode second audio track
    if (secondAudioTrackIndex != null) {
      this.logger.info(`Audio track index ${secondAudioTrackIndex}`);
      const audio2ndArgs = this.createAudioEncodingArgs(inputFile, parsedInput, audio2ndParams, secondAudioTrackIndex);
      try {
        await this.encodeMedia(audio2ndArgs, videoDuration, job.id);
      } catch (e) {
        this.logger.error(e);
        await deleteFolder(transcodeDir);
        if (e === RejectCode.JOB_CANCEL) {
          this.logger.info(`Received cancel signal from job id: ${job.id}`);
          return this.generateStatus(StatusCode.CANCELLED_ENCODING, job.data);
        }
        throw new Error(this.generateStatusJson(StatusCode.ENCODE_AUDIO_FAILED, job.data));
      }
      audioInputForVideo.push('-i', `"${parsedInput.dir}/${parsedInput.name}_audio_${secondAudioTrackIndex}.mp4"`);
      audioMapForVideo.push('-map', '2:a:0');
    }

    const encodeVideoAudioArgs: IEncodeVideoAudioArgs = { inputs: audioInputForVideo, maps: audioMapForVideo };

    try {
      if (codec === StreamCodec.H264_AAC) {
        this.logger.info('Video codec: H264');
        await this.encodeByCodec(inputFile, parsedInput, encodeVideoAudioArgs, videoDuration, availableQualityList, StreamCodec.H264_AAC, videoH264Params, job);
      }
      else if (codec === StreamCodec.VP9_AAC) {
        this.logger.info('Video codec: VP9');
        await this.encodeByCodec(inputFile, parsedInput, encodeVideoAudioArgs, videoDuration, availableQualityList, StreamCodec.VP9_AAC, videoVP9Params, job);
      }
      else if (codec === StreamCodec.AV1_AAC) {
        this.logger.info('Video codec: AV1');
        await this.encodeByCodec(inputFile, parsedInput, encodeVideoAudioArgs, videoDuration, availableQualityList, StreamCodec.AV1_AAC, videoAV1Params, job);
      }
      // Check uploaded files
      this.logger.info('Checking uploaded files');
      let uploadedFiles = await this.findUploadedFiles(job.data.storage, job.data._id);
      let listAttempt = 1;
      const totalExpectedFiles = availableQualityList.length + 1;
      const maxTries = 5;
      while (uploadedFiles.length < totalExpectedFiles && listAttempt < maxTries) {
        uploadedFiles = await this.findUploadedFiles(job.data.storage, job.data._id);
        listAttempt++;
      }
      this.logger.info(`${uploadedFiles.length}/${totalExpectedFiles} files uploaded`);
    } catch (e) {
      this.logger.error(e);
      if (e === RejectCode.JOB_CANCEL) {
        this.logger.info(`Received cancel signal from job id: ${job.id}`);
        return this.generateStatus(StatusCode.CANCELLED_ENCODING, job.data);
      }
      throw new Error(this.generateStatusJson(StatusCode.ENCODE_VIDEO_FAILED, job.data));
    } finally {
      this.logger.info('Cleaning up');
      await deleteFolder(transcodeDir);
      // await Promise.all([
      //   deleteFile(inputFile),
      //   deleteFile(`${parsedInput.dir}/${parsedInput.name}_audio_normal.mp4`),
      //   deleteFile(`${parsedInput.dir}/${parsedInput.name}_2pass.log`)
      // ]);
      this.logger.info('Completed');
    }
    //await new Promise(r => setTimeout(r, 10000));
    return this.generateStatus(StatusCode.FINISHED_ENCODING, job.data);
  }

  addToCanceled(job: Job<IJobData>) {
    if (job.data.id)
      this.CanceledJobIds.push(job.data.id);
    else if (job.data.ids)
      this.CanceledJobIds.push(...job.data.ids);
    return job.data;
  }

  private async encodeByCodec(inputFile: string, parsedInput: path.ParsedPath, audioArgs: IEncodeVideoAudioArgs, videoDuration: number, qualityList: number[], codec: number, videoParams: string[], job: Job<IVideoData>) {
    for (let i = 0; i < qualityList.length; i++) {
      this.logger.info(`Processing video quality: ${qualityList[i]}`);
      const streamId = await createSnowFlakeId();
      try {
        if (codec === StreamCodec.H264_AAC) {
          const videoArgs = this.createVideoEncodingArgs(inputFile, parsedInput, audioArgs, qualityList[i], videoParams);
          const rcloneMoveArgs = this.createRcloneMoveArgs(parsedInput, qualityList[i], job.data.storage, job.data._id, streamId);
          await this.encodeMedia(videoArgs, videoDuration, job.id);
          await this.uploadMedia(rcloneMoveArgs);
        } else {
          const videoPass1Args = this.createTwoPassesVideoEncodingArgs(inputFile, parsedInput, audioArgs, qualityList[i], videoParams, 1);
          const videoPass2Args = this.createTwoPassesVideoEncodingArgs(inputFile, parsedInput, audioArgs, qualityList[i], videoParams, 2);
          const rcloneMoveArgs = this.createRcloneMoveArgs(parsedInput, qualityList[i], job.data.storage, job.data._id, streamId);
          await this.encodeMedia(videoPass1Args, videoDuration, job.id);
          await this.encodeMedia(videoPass2Args, videoDuration, job.id);
          await this.uploadMedia(rcloneMoveArgs);
        }
      } catch (e) {
        const rcloneDir = this.configService.get<string>('RCLONE_DIR');
        const rcloneConfig = this.configService.get<string>('RCLONE_CONFIG_FILE');
        this.logger.info('Removing unprocessed file');
        try {
          await deletePath(rcloneConfig, rcloneDir, job.data.storage, `${job.data._id}/${streamId}`, (args => {
            this.logger.info('rclone ' + args.join(' '));
          }));
        } catch (e) {
          this.logger.error(e);
        }
        this.logger.error(e);
        throw e;
      }
      await job.progress({
        sourceId: job.data._id,
        streamId: streamId,
        fileName: `${parsedInput.name}_${qualityList[i]}.mp4`,
        codec: codec,
        quality: qualityList[i],
        media: job.data.media,
        episode: job.data.episode,
        storage: job.data.storage
      });
    }
  }

  private createAudioEncodingArgs(inputFile: string, parsedInput: path.ParsedPath, audioParams: string[], audioIndex: number) {
    const args: string[] = [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      '-vn',
      ...audioParams,
      '-map', `0:${audioIndex}`,
      '-f', 'mp4', `"${parsedInput.dir}/${parsedInput.name}_audio_${audioIndex}.mp4"`
    ];
    return args;
  }

  private createVideoEncodingArgs(inputFile: string, parsedInput: path.ParsedPath, audioArgs: IEncodeVideoAudioArgs, quality: number, videoParams: string[]) {
    const args: string[] = [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      ...audioArgs.inputs,
      ...videoParams,
      '-map', '0:v:0',
      ...audioArgs.maps,
      '-map_metadata', '-1',
      '-vf', `scale=-2:${quality}`,
      '-movflags', '+faststart',
      '-f', 'mp4', `"${parsedInput.dir}/${parsedInput.name}_${quality}.mp4"`
    ];
    return args;
  }

  private createTwoPassesVideoEncodingArgs(inputFile: string, parsedInput: path.ParsedPath, audioArgs: IEncodeVideoAudioArgs, quality: number, videoParams: string[], audioIndex: number, pass: number = 1) {
    if (pass === 1) {
      const outputName = process.platform === 'win32' ? 'NUL' : '/dev/null';
      return [
        '-hide_banner', '-y',
        '-progress', 'pipe:1',
        '-loglevel', 'error',
        '-i', `"${inputFile}"`,
        '-map', '0:v:0',
        ...videoParams,
        '-map_metadata', '-1',
        '-vf', `scale=-2:${quality}`,
        '-movflags', '+faststart',
        '-passlogfile', `"${parsedInput.dir}/${parsedInput.name}_2pass.log"`,
        '-pass', '1', '-an',
        '-f', 'null', outputName
      ];
    }
    return [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      ...audioArgs.inputs,
      ...videoParams,
      '-map', '0:v:0',
      ...audioArgs.maps,
      '-map_metadata', '-1',
      '-vf', `scale=-2:${quality}`,
      '-movflags', '+faststart',
      '-passlogfile', `"${parsedInput.dir}/${parsedInput.name}_2pass.log"`,
      '-pass', '2',
      '-f', 'mp4', `"${parsedInput.dir}/${parsedInput.name}_${quality}.mp4"`
    ];
  }

  private createRclonePipeArgs(parsedInput: path.ParsedPath, quality: number, remote: string, parentFolder: string, streamId: string) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      'rcat', `"${remote}:${parentFolder}/${streamId}/${parsedInput.name}_${quality}.mp4"`
    ];
    return args;
  }

  private createRcloneMoveArgs(parsedInput: path.ParsedPath, quality: number, remote: string, parentFolder: string, streamId: string) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      'move',
      `"${parsedInput.dir}/${parsedInput.name}_${quality}.mp4"`,
      `"${remote}:${parentFolder}/${streamId}"`
    ];
    return args;
  }

  private encodeMedia(args: string[], videoDuration: number, jobId: string | number) {
    return new Promise<void>((resolve, reject) => {
      let isCancelled = false;

      this.logger.info('ffmpeg ' + args.join(' '));
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

      const cancelCheck = setInterval(() => {
        const index = this.CanceledJobIds.findIndex(j => +j === +jobId);
        if (index === -1) return;

        this.CanceledJobIds = this.CanceledJobIds.filter(id => +id > +jobId);
        isCancelled = true;
        ffmpeg.kill('SIGINT'); // Stop key
      }, 5000)

      ffmpeg.on('exit', (code: number) => {
        stdout.write('\n');
        clearInterval(cancelCheck);
        if (isCancelled) {
          reject(RejectCode.JOB_CANCEL);
        } else if (code !== 0) {
          reject(`FFmpeg exited with status code: ${code}`);
        } else {
          resolve();
        }
      });
    });
  }

  private uploadMedia(args: string[]) {
    return new Promise<void>((resolve, reject) => {
      this.logger.info('rclone ' + args.join(' '));
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
      this.logger.info('ffmpeg ' + ffmpegArgs.join(' ') + ' | ' + 'rclone ' + rcloneArgs.join(' '));
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

  private findUploadedFiles(remote: string, parentFolder: string) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      'lsjson', `${remote}:${parentFolder}`,
      '--recursive', '--files-only'
    ];
    return new Promise<any[]>((resolve, reject) => {
      this.logger.info('rclone ' + args.join(' '));
      const rclone = child_process.spawn(`${this.configService.get<string>('RCLONE_DIR')}/rclone`, args, { shell: true });

      let listJson = '';

      rclone.stdout.setEncoding('utf8');
      rclone.stdout.on('data', (data) => {
        listJson += data;
      });

      rclone.stderr.setEncoding('utf8');
      rclone.stderr.on('data', (data) => {
        stdout.write(data);
      });

      rclone.on('exit', (code: number) => {
        stdout.write('\n');
        if (code !== 0) {
          reject(`Error listing files, rclone exited with status code: ${code}`);
        } else {
          const fileData = JSON.parse(listJson);
          resolve(fileData);
        }
      });
    });
  }

  private calculateQuality(height: number, qualityList: number[]) {
    const availableQualityList = [];
    if (!height) return availableQualityList;
    for (let i = 0; i < qualityList.length; i++) {
      if (height >= qualityList[i]) {
        availableQualityList.push(qualityList[i]);
      }
    }
    // Use the lowest quality when there is no suitable one
    if (!availableQualityList.length)
      availableQualityList.push(Math.min(...qualityList));
    return availableQualityList;
  }

  private async decryptToken(storage: IStorage) {
    const stringCrypto = new StringCrypto(this.configService.get<string>('CRYPTO_SECRET_KEY'));
    storage.clientSecret = await stringCrypto.decrypt(storage.clientSecret);
    if (storage.accessToken)
      storage.accessToken = await stringCrypto.decrypt(storage.accessToken);
    storage.refreshToken = await stringCrypto.decrypt(storage.refreshToken);
    return storage;
  }

  private parseProgress(data: string) {
    const tLines = data.split('\n');
    if (tLines.length < 5)
      this.logger.info(data);
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
    this.logger.info(status);
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