import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import mongoose from 'mongoose';
import { stdout } from 'process';
import child_process from 'child_process';
import path from 'path';
import FFprobe from 'ffprobe-client';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

import { externalStorageModel } from '../../models/external-storage.model';
import { IVideoData, IJobData, IStorage, ISourceInfo, ISourceAudioInfo, IEncodeVideoAudioArgs, IEncodingSetting } from './interfaces';
import { StatusCode } from '../../enums/status-code.enum';
import { StreamCodec } from '../../enums/stream-codec.enum';
import { RejectCode } from '../../enums/reject-code.enum';
import { ProgressCode } from '../../enums/progress-code.enum';
import { findInFile, appendToFile, fileExists, deleteFolder } from '../../utils/file-helper.util';
import { createRcloneConfig, downloadFile, deletePath } from '../../utils/rclone.util';
import { generateSprites } from '../../utils/thumbnail.util';
import { parseProgress, progressPercent } from '../../utils/ffmpeg-helper.util';
import { StringCrypto } from '../../utils/string-crypto.util';
import { createSnowFlakeId } from '../../utils/snowflake-id.util';
import { divideFromString } from '../../utils/string-helper.util';
import { ENCODING_QUALITY, AUDIO_PARAMS, AUDIO_2ND_PARAMS, VIDEO_H264_PARAMS, VIDEO_VP9_PARAMS, VIDEO_AV1_PARAMS } from '../../config';
import { RcloneFile } from '../../common/interfaces';

@Injectable()
export class VideoService {
  private AudioParams: string[];
  private Audio2ndParams: string[];
  private VideoH264Params: string[];
  private VideoVP9Params: string[];
  private VideoAV1Params: string[];
  private CanceledJobIds: (string | number)[];
  private thumbnailFolder: string;

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
    this.thumbnailFolder = 'thumbnails';
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
    const encodingSettings = job.data.encodingSettings;

    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const transcodeDir = `${this.configService.get<string>('TRANSCODE_DIR')}/${job.id}`;
    const ffmpegDir = this.configService.get<string>('FFMPEG_DIR');

    //await deleteFile(rcloneConfigFile);
    const configExists = await findInFile(rcloneConfigFile, `[${job.data.storage}]`);
    if (!configExists) {
      this.logger.info(`Config for remote "${job.data.storage}" not found, generating...`);
      await mongoose.connect(this.configService.get<string>('DATABASE_URL'));
      let externalStorage = await externalStorageModel.findOne({ _id: job.data.storage }).lean().exec();
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
      await deleteFolder(transcodeDir);
      throw new Error(this.generateStatusJson(StatusCode.DOWNLOAD_FAILED, job.data));
    }
    let videoInfo: FFprobe.FFProbeResult;
    this.logger.info(`Processing input file: ${inputFile}`);
    try {
      videoInfo = await FFprobe(inputFile, { path: `${ffmpegDir}/ffprobe` });
    } catch (e) {
      this.logger.error(e);
      await deleteFolder(transcodeDir);
      await job.discard();
      throw new Error(this.generateStatusJson(StatusCode.PROBE_FAILED, job.data));
    }

    const videoTrack = videoInfo.streams.find(s => s.codec_type === 'video');
    if (!videoTrack) {
      this.logger.error('Video track not found');
      await deleteFolder(transcodeDir);
      await job.discard();
      throw new Error(this.generateStatusJson(StatusCode.NO_VIDEO_TRACK, job.data));
    }

    const audioTracks = videoInfo.streams.filter(s => s.codec_type === 'audio');
    if (!audioTracks.length) {
      this.logger.error('Audio track not found');
      await deleteFolder(transcodeDir);
      await job.discard();
      throw new Error(this.generateStatusJson(StatusCode.NO_AUDIO_TRACK, job.data));
    }

    const runtime = videoInfo.format.duration ? Math.trunc(+videoInfo.format.duration) : 0;
    const videoDuration = videoTrack.duration ? Math.trunc(+videoTrack.duration) : 0;
    const videoFps = Math.ceil(divideFromString(videoTrack.r_frame_rate));
    const videoBitrate = videoTrack.bit_rate ? Math.round(+videoTrack.bit_rate / 1000) : 0; // Bitrate in Kbps

    const allQualityList = this.calculateQuality(videoTrack.height, qualityList);
    this.logger.info(`All quality: ${allQualityList.length ? allQualityList.join(', ') : 'None'}`);
    if (!allQualityList.length) {
      await deleteFolder(transcodeDir);
      await job.discard();
      throw new Error(this.generateStatusJson(StatusCode.LOW_QUALITY_VIDEO, job.data));
    }

    // Check already encoded files
    this.logger.info('Checking already encoded files');
    let alreadyEncodedFiles = await this.findUploadedFiles(job.data.storage, job.data._id, job.id);
    const availableQualityList = allQualityList.filter(quality =>
      !alreadyEncodedFiles.find(file => file.Name === `${parsedInput.name}_${quality}.mp4`));
    this.logger.info(`Avaiable quality: ${availableQualityList.length ? availableQualityList.join(', ') : 'None'}`);
    if (!availableQualityList.length) {
      await deleteFolder(transcodeDir);
      await job.discard();
      throw new Error(this.generateStatusJson(StatusCode.LOW_QUALITY_VIDEO, job.data));
    }

    const srcWidth = videoTrack.width || 0;
    const srcHeight = videoTrack.height || 0;

    this.logger.info(`Video resolution: ${srcWidth}x${srcHeight}`);

    await job.progress({
      code: ProgressCode.UPDATE_SOURCE,
      sourceId: job.data._id,
      quality: srcHeight,
      runtime: runtime,
      media: job.data.media,
      episode: job.data.episode,
      storage: job.data.storage
    });

    this.logger.info('Processing audio');
    const audioInputForVideo = [];
    const audioMapForVideo = [];

    const audioNormalTrack = audioTracks.find(a => a.channels <= 2);
    const audioSurroundTrack = audioTracks.find(a => a.channels > 2);

    const firstAudioTrack = audioNormalTrack || audioSurroundTrack;
    const secondAudioTrack = audioSurroundTrack;

    this.logger.info(`Audio track index ${firstAudioTrack.index}`);
    try {
      const audioDuration = firstAudioTrack.duration ? Math.trunc(+firstAudioTrack.duration) : 0;
      await this.encodeAudio(inputFile, parsedInput, { audioDuration }, firstAudioTrack.index, audioParams, job);
    } catch (e) {
      this.logger.error(JSON.stringify(e));
      await deleteFolder(transcodeDir);
      if (e === RejectCode.JOB_CANCEL) {
        this.logger.info(`Received cancel signal from job id: ${job.id}`);
        return this.generateStatus(StatusCode.CANCELLED_ENCODING, job.data);
      }
      throw new Error(this.generateStatusJson(StatusCode.ENCODE_AUDIO_FAILED, job.data));
    }
    audioInputForVideo.push('-i', `"${parsedInput.dir}/${parsedInput.name}_audio_${firstAudioTrack.index}.mp4"`);
    audioMapForVideo.push('-map', '1:a:0');

    // Encode second audio track
    if (secondAudioTrack != null) {
      this.logger.info(`Audio track index ${secondAudioTrack.index}`);
      try {
        const audioDuration = secondAudioTrack.duration ? Math.trunc(+secondAudioTrack.duration) : 0;
        await this.encodeAudio(inputFile, parsedInput, { audioDuration }, secondAudioTrack.index, audio2ndParams, job);
      } catch (e) {
        this.logger.error(JSON.stringify(e));
        await deleteFolder(transcodeDir);
        if (e === RejectCode.JOB_CANCEL) {
          this.logger.info(`Received cancel signal from job id: ${job.id}`);
          return this.generateStatus(StatusCode.CANCELLED_ENCODING, job.data);
        }
        throw new Error(this.generateStatusJson(StatusCode.ENCODE_AUDIO_FAILED, job.data));
      }
      audioInputForVideo.push('-i', `"${parsedInput.dir}/${parsedInput.name}_audio_${secondAudioTrack.index}.mp4"`);
      audioMapForVideo.push('-map', '2:a:0');
    }

    const encodeVideoAudioArgs: IEncodeVideoAudioArgs = { inputs: audioInputForVideo, maps: audioMapForVideo };

    try {
      const sourceInfo: ISourceInfo = { videoDuration, videoFps, videoBitrate };
      if (codec === StreamCodec.H264_AAC) {
        this.logger.info('Video codec: H264');
        await this.encodeByCodec(inputFile, parsedInput, encodeVideoAudioArgs, sourceInfo,
          availableQualityList, encodingSettings, StreamCodec.H264_AAC, videoH264Params, job);
      }
      else if (codec === StreamCodec.VP9_AAC) {
        this.logger.info('Video codec: VP9');
        await this.encodeByCodec(inputFile, parsedInput, encodeVideoAudioArgs, sourceInfo,
          availableQualityList, encodingSettings, StreamCodec.VP9_AAC, videoVP9Params, job);
      }
      else if (codec === StreamCodec.AV1_AAC) {
        this.logger.info('Video codec: AV1');
        await this.encodeByCodec(inputFile, parsedInput, encodeVideoAudioArgs, sourceInfo,
          availableQualityList, encodingSettings, StreamCodec.AV1_AAC, videoAV1Params, job);
      }
      // Generate preview thumbnail
      this.logger.info(`Generating preview thumbnail: ${inputFile}`);
      await generateSprites({
        source: inputFile,
        output: `${parsedInput.dir}/${this.thumbnailFolder}`,
        duration: videoDuration,
        ffmpegDir,
        jobId: job.id,
        canceledJobIds: this.CanceledJobIds
      });
      const rcloneMoveThumbArgs = this.createRcloneMoveThumbArgs(parsedInput, job.data.storage, job.data._id);
      await this.uploadMedia(rcloneMoveThumbArgs, job.id);

      // Check uploaded files
      this.logger.info('Checking uploaded files');
      let uploadedFiles = await this.findUploadedFiles(job.data.storage, job.data._id, job.id);
      let listAttempt = 1;
      const totalExpectedFiles = availableQualityList.length + 1;
      const maxTries = 5;
      while (uploadedFiles.length < totalExpectedFiles && listAttempt < maxTries) {
        uploadedFiles = await this.findUploadedFiles(job.data.storage, job.data._id, job.id);
        listAttempt++;
      }
      this.logger.info(`${uploadedFiles.length}/${totalExpectedFiles} files uploaded`);
    } catch (e) {
      this.logger.error(JSON.stringify(e));
      if (e === RejectCode.JOB_CANCEL) {
        this.logger.info(`Received cancel signal from job id: ${job.id}`);
        await job.discard();
        return this.generateStatus(StatusCode.CANCELLED_ENCODING, job.data);
      }
      throw new Error(this.generateStatusJson(StatusCode.ENCODE_VIDEO_FAILED, job.data));
    } finally {
      this.logger.info('Cleaning up');
      await deleteFolder(transcodeDir);
      this.logger.info('Completed');
    }
    return this.generateStatus(StatusCode.FINISHED_ENCODING, job.data);
  }

  addToCanceled(job: Job<IJobData>) {
    if (job.data.id)
      this.CanceledJobIds.push(job.data.id);
    else if (job.data.ids)
      this.CanceledJobIds.push(...job.data.ids);
    return job.data;
  }

  private async encodeAudio(inputFile: string, parsedInput: path.ParsedPath, sourceInfo: ISourceAudioInfo, audioTrackIndex: number,
    audioParams: string[], job: Job<IVideoData>) {
    const { audioDuration } = sourceInfo;
    const audioArgs = this.createAudioEncodingArgs(inputFile, parsedInput, audioParams, audioTrackIndex);
    await this.encodeMedia(audioArgs, audioDuration, job.id);
  }

  private async encodeByCodec(inputFile: string, parsedInput: path.ParsedPath, audioArgs: IEncodeVideoAudioArgs,
    sourceInfo: ISourceInfo, qualityList: number[], encodingSettings: IEncodingSetting[], codec: number, videoParams: string[],
    job: Job<IVideoData>) {
    const { videoDuration } = sourceInfo;
    for (let i = 0; i < qualityList.length; i++) {
      this.logger.info(`Processing video quality: ${qualityList[i]}`);
      const streamId = await createSnowFlakeId();
      const perQualitySettings = encodingSettings.find(s => s.quality === qualityList[i]);
      try {
        if (codec === StreamCodec.H264_AAC) {
          const videoArgs = this.createVideoEncodingArgs(inputFile, parsedInput, audioArgs, qualityList[i], videoParams,
            sourceInfo, perQualitySettings);
          const rcloneMoveArgs = this.createRcloneMoveArgs(`${parsedInput.dir}/${parsedInput.name}_${qualityList[i]}.mp4`,
            `${job.data.storage}:${job.data._id}/${streamId}`);
          await this.encodeMedia(videoArgs, videoDuration, job.id);
          await this.uploadMedia(rcloneMoveArgs, job.id);
        } else {
          // Pass 1 params
          const videoPass1Args = this.createTwoPassesVideoEncodingArgs(inputFile, parsedInput, audioArgs, qualityList[i], videoParams,
            sourceInfo, 1, perQualitySettings);
          // Pass 2 params
          const videoPass2Args = this.createTwoPassesVideoEncodingArgs(inputFile, parsedInput, audioArgs, qualityList[i], videoParams,
            sourceInfo, 2, perQualitySettings);
          const rcloneMoveArgs = this.createRcloneMoveArgs(`${parsedInput.dir}/${parsedInput.name}_${qualityList[i]}.mp4`,
            `${job.data.storage}:${job.data._id}/${streamId}`);
          await this.encodeMedia(videoPass1Args, videoDuration, job.id);
          await this.encodeMedia(videoPass2Args, videoDuration, job.id);
          await this.uploadMedia(rcloneMoveArgs, job.id);
        }
      } catch (e) {
        const rcloneDir = this.configService.get<string>('RCLONE_DIR');
        const rcloneConfig = this.configService.get<string>('RCLONE_CONFIG_FILE');
        this.logger.error(JSON.stringify(e));
        this.logger.info('Removing unprocessed file');
        try {
          await deletePath(rcloneConfig, rcloneDir, job.data.storage, `${job.data._id}/${streamId}`, (args => {
            this.logger.info('rclone ' + args.join(' '));
          }));
        } catch (e) {
          this.logger.error(JSON.stringify(e));
        }
        throw e;
      }
      await job.progress({
        code: ProgressCode.ADD_STREAM_VIDEO,
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

  private createVideoEncodingArgs(inputFile: string, parsedInput: path.ParsedPath, audioArgs: IEncodeVideoAudioArgs,
    quality: number, videoParams: string[], sourceInfo: ISourceInfo, encodingSetting?: IEncodingSetting) {
    const gopSize = (sourceInfo.videoFps ? sourceInfo.videoFps * 2 : 48).toString();
    const args: string[] = [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      ...audioArgs.inputs,
      ...videoParams,
      '-g', gopSize,
      '-keyint_min', gopSize
    ];
    if (encodingSetting)
      this.resolveEncodingSettings(args, encodingSetting, sourceInfo);
    args.push(
      '-map', '0:v:0',
      ...audioArgs.maps,
      '-map_metadata', '-1',
      '-vf', `scale=-2:${quality}`,
      '-movflags', '+faststart',
      '-f', 'mp4', `"${parsedInput.dir}/${parsedInput.name}_${quality}.mp4"`
    );
    return args;
  }

  private createTwoPassesVideoEncodingArgs(inputFile: string, parsedInput: path.ParsedPath, audioArgs: IEncodeVideoAudioArgs,
    quality: number, videoParams: string[], sourceInfo: ISourceInfo, pass: number = 1, encodingSetting?: IEncodingSetting) {
    const gopSize = (sourceInfo.videoFps ? sourceInfo.videoFps * 2 : 48).toString();
    if (pass === 1) {
      const outputName = process.platform === 'win32' ? 'NUL' : '/dev/null';
      const args = [
        '-hide_banner', '-y',
        '-progress', 'pipe:1',
        '-loglevel', 'error',
        '-i', `"${inputFile}"`,
        ...videoParams,
        '-g', gopSize,
        '-keyint_min', gopSize
      ];
      if (encodingSetting)
        this.resolveEncodingSettings(args, encodingSetting, sourceInfo);
      args.push(
        '-map', '0:v:0',
        '-map_metadata', '-1',
        '-vf', `scale=-2:${quality}`,
        '-movflags', '+faststart',
        '-passlogfile', `"${parsedInput.dir}/${parsedInput.name}_2pass.log"`,
        '-pass', '1', '-an',
        '-f', 'null', outputName
      );
      return args;
    }
    const args = [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      ...audioArgs.inputs,
      ...videoParams,
      '-g', gopSize,
      '-keyint_min', gopSize
    ];
    if (encodingSetting)
      this.resolveEncodingSettings(args, encodingSetting, sourceInfo);
    args.push(
      '-map', '0:v:0',
      ...audioArgs.maps,
      '-map_metadata', '-1',
      '-vf', `scale=-2:${quality}`,
      '-movflags', '+faststart',
      '-passlogfile', `"${parsedInput.dir}/${parsedInput.name}_2pass.log"`,
      '-pass', '2',
      '-f', 'mp4', `"${parsedInput.dir}/${parsedInput.name}_${quality}.mp4"`
    );
    return args;
  }

  private resolveEncodingSettings(args: string[], encodingSetting: IEncodingSetting, sourceInfo: ISourceInfo) {
    encodingSetting.crf && args.push('-crf', encodingSetting.crf.toString());
    if (encodingSetting.useLowerRate && sourceInfo.videoBitrate > 0 && sourceInfo.videoBitrate < encodingSetting.maxrate) {
      encodingSetting.maxrate && args.push('-maxrate', `${sourceInfo.videoBitrate}K`);
      encodingSetting.bufsize && args.push('-bufsize', `${sourceInfo.videoBitrate * 2}K`);
    } else {
      encodingSetting.maxrate && args.push('-maxrate', `${encodingSetting.maxrate}K`);
      encodingSetting.bufsize && args.push('-bufsize', `${encodingSetting.bufsize}K`);
    }
  }

  private createRclonePipeArgs(parsedInput: path.ParsedPath, quality: number, remote: string, parentFolder: string, streamId: string) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      '--low-level-retries', '5',
      'rcat', `"${remote}:${parentFolder}/${streamId}/${parsedInput.name}_${quality}.mp4"`
    ];
    return args;
  }

  private createRcloneMoveArgs(source: string, dest: string, include?: string) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      '--low-level-retries', '5',
      'move', `"${source}"`, `"${dest}"`
    ];
    if (include) {
      args.push('--include', include);
    }
    return args;
  }

  private createRcloneMoveThumbArgs(parsedInput: path.ParsedPath, remote: string, parentFolder: string) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      '--low-level-retries', '5',
      'move',
      `"${parsedInput.dir}/${this.thumbnailFolder}"`,
      `"${remote}:${parentFolder}/${this.thumbnailFolder}"`
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
        const progress = parseProgress(data);
        const percent = progressPercent(progress.outTimeMs, videoDuration * 1000000);
        stdout.write(`Encoding: ${percent}% - frame: ${progress.frame || 'N/A'} - fps: ${progress.fps || 'N/A'} - bitrate: ${progress.bitrate} - time: ${progress.outTime}\r`);
      });

      ffmpeg.stderr.setEncoding('utf8');
      ffmpeg.stderr.on('data', (data) => {
        stdout.write(data);
      });

      const cancelledJobChecker = this.createCancelJobChecker(jobId, () => {
        isCancelled = true;
        ffmpeg.stdin.write('q');
        ffmpeg.stdin.end();
      });

      ffmpeg.on('exit', (code: number) => {
        stdout.write('\n');
        clearInterval(cancelledJobChecker);
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

  private uploadMedia(args: string[], jobId: string | number) {
    return new Promise<void>((resolve, reject) => {
      let isCancelled = false;

      this.logger.info('rclone ' + args.join(' '));
      const rclone = child_process.spawn(`${this.configService.get<string>('RCLONE_DIR')}/rclone`, args, { shell: true });

      rclone.stderr.setEncoding('utf8');
      rclone.stderr.on('data', (data) => {
        stdout.write(data);
      });

      const cancelledJobChecker = this.createCancelJobChecker(jobId, () => {
        isCancelled = true;
        rclone.kill('SIGINT'); // Stop key
      });

      rclone.on('exit', (code: number) => {
        stdout.write('\n');
        clearInterval(cancelledJobChecker);
        if (isCancelled) {
          reject(RejectCode.JOB_CANCEL);
        } else if (code !== 0) {
          reject(`Rclone exited with status code: ${code}`);
        } else {
          resolve();
        }
      });
    });
  }

  private createCancelJobChecker(jobId: string | number, exec: () => void, ms: number = 5000) {
    return setInterval(() => {
      const index = this.CanceledJobIds.findIndex(j => +j === +jobId);
      if (index === -1) return;
      this.CanceledJobIds = this.CanceledJobIds.filter(id => +id > +jobId);
      // Exec callback
      exec();
    }, ms)
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
        const progress = parseProgress(data);
        const percent = progressPercent(progress.outTimeMs, videoDuration * 1000000);
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

  private findUploadedFiles(remote: string, parentFolder: string, jobId: string | number) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      'lsjson', `${remote}:${parentFolder}`,
      '--recursive', '--files-only'
    ];
    return new Promise<RcloneFile[]>((resolve, reject) => {
      let isCancelled = false;
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

      const cancelledJobChecker = this.createCancelJobChecker(jobId, () => {
        isCancelled = true;
        rclone.kill('SIGINT');
      }, 500);

      rclone.on('exit', (code: number) => {
        clearInterval(cancelledJobChecker);
        if (isCancelled) {
          reject(RejectCode.JOB_CANCEL);
        } else if (code !== 0) {
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

  private generateStatusJson(code: string, jobData: IVideoData) {
    const status = this.generateStatus(code, jobData);
    const statusJson = JSON.stringify(status);
    this.logger.error(`Error: ${code} - ${statusJson}`);
    return statusJson;
  }

  private generateStatus(code: string, jobData: IVideoData) {
    return {
      code: code,
      ...jobData
    }
  }
}