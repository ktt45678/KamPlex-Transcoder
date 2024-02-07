import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import mongoose from 'mongoose';
import { stdout } from 'process';
import child_process from 'child_process';
import path from 'path';
import FFprobe from 'ffprobe-client';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

import { externalStorageModel } from '../../models/external-storage.model';
import { mediaStorageModel } from '../../models/media-storage.model';
import { settingModel } from '../../models/setting.model';
import { mediaModel } from '../../models/media.model';
import { IVideoData, IJobData, IStorage, IEncodingSetting, MediaQueueResult, EncodeAudioOptions, EncodeVideoOptions, VideoSourceInfo, CreateAudioEncodingArgsOptions, CreateVideoEncodingArgsOptions, EncodeAudioByTrackOptions, AdvancedVideoSettings } from './interfaces';
import { AudioCodec, StatusCode, VideoCodec, RejectCode, TaskQueue } from '../../enums';
import { ENCODING_QUALITY, AUDIO_PARAMS, AUDIO_SURROUND_PARAMS, VIDEO_H264_PARAMS, VIDEO_VP9_PARAMS, VIDEO_AV1_PARAMS, AUDIO_SPEED_PARAMS, AUDIO_SURROUND_OPUS_PARAMS } from '../../config';
import { HlsManifest, RcloneFile } from '../../common/interfaces';
import { KamplexApiService } from '../../common/modules/kamplex-api';
import {
  createRcloneConfig, downloadFile, renameFile, deleteFile, deletePath, createSnowFlakeId, divideFromString, findInFile,
  appendToFile, deleteFolder, generateSprites, parseProgress, progressPercent, MediaInfoResult, StringCrypto,
  getMediaInfo, createH264Params, StreamManifest, hasFreeSpaceToCopyFile, trimSlugFilename, statFile, mkdirRemote, listRemoteJson,
  readRemoteFile, emptyPath, fileExists, parseRcloneUploadProgress, findAllRemotes, refreshRemoteTokens, findH264ProfileLevel
} from '../../utils';

type JobNameType = 'update-source' | 'add-stream-video' | 'add-stream-audio' | 'add-stream-manifest' | 'finished-encoding' |
  'cancelled-encoding' | 'retry-encoding' | 'failed-encoding';

@Injectable()
export class VideoService {
  private AudioParams: string[];
  private AudioSpeedParams: string[];
  private AudioSurroundParams: string[];
  private AudioSurroundOpusParams: string[];
  private VideoH264Params: string[];
  private VideoVP9Params: string[];
  private VideoAV1Params: string[];
  private CanceledJobIds: (string | number)[];
  private thumbnailFolder: string;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    @InjectQueue(TaskQueue.VIDEO_TRANSCODE_RESULT) private videoResultQueue: Queue<MediaQueueResult, any, JobNameType>,
    private configService: ConfigService, private kamplexApiService: KamplexApiService) {
    const audioParams = this.configService.get<string>('AUDIO_PARAMS');
    this.AudioParams = audioParams ? audioParams.split(' ') : AUDIO_PARAMS;
    const audioSpeedParams = this.configService.get<string>('AUDIO_SPEED_PARAMS');
    this.AudioSpeedParams = audioSpeedParams ? audioSpeedParams.split(' ') : AUDIO_SPEED_PARAMS;
    const audioSurroundParams = this.configService.get<string>('AUDIO_SURROUND_PARAMS');
    this.AudioSurroundParams = audioSurroundParams ? audioSurroundParams.split(' ') : AUDIO_SURROUND_PARAMS;
    const audioSurroundOpusParams = this.configService.get<string>('AUDIO_SURROUND_OPUS_PARAMS');
    this.AudioSurroundOpusParams = audioSurroundOpusParams ? audioSurroundOpusParams.split(' ') : AUDIO_SURROUND_OPUS_PARAMS;
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
      return {};
    }

    // Connect to MongoDB
    await mongoose.connect(this.configService.get<string>('DATABASE_URL'), { family: 4, useBigInt64: true });
    const appSettings = await settingModel.findOne({}).lean().exec();
    const mediaInfo = await mediaModel.findOne({ _id: BigInt(job.data.media) }, { _id: 1, originalLang: 1 }).lean().exec();

    const audioParams = appSettings.audioParams ? appSettings.audioParams.split(' ') : this.AudioParams;
    const audioSpeedParams = appSettings.audioSpeedParams ? appSettings.audioSpeedParams.split(' ') : this.AudioSpeedParams;
    const audioSurroundParams = appSettings.audioSurroundParams ? appSettings.audioSurroundParams.split(' ') : this.AudioSurroundParams;
    const audioSurroundOpusParams = appSettings.audioSurroundOpusParams ? appSettings.audioSurroundOpusParams.split(' ') : this.AudioSurroundOpusParams;
    const videoH264Params = appSettings.videoH264Params ? appSettings.videoH264Params.split(' ') : this.VideoH264Params;
    const videoVP9Params = appSettings.videoVP9Params ? appSettings.videoVP9Params.split(' ') : this.VideoVP9Params;
    const videoAV1Params = appSettings.videoAV1Params ? appSettings.videoAV1Params.split(' ') : this.VideoAV1Params;
    const qualityList = Array.isArray(appSettings.videoQualityList) && appSettings.videoQualityList.length ? appSettings.videoQualityList : ENCODING_QUALITY;
    const encodingSettings = appSettings.videoEncodingSettings || [];

    const rcloneDir = this.configService.get<string>('RCLONE_DIR');
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const transcodeDir = `${this.configService.get<string>('TRANSCODE_DIR')}/${job.id}`;
    const ffmpegDir = this.configService.get<string>('FFMPEG_DIR');
    const mediainfoDir = this.configService.get<string>('MEDIAINFO_DIR');
    const trimmedFileName = job.data.linkedStorage ? trimSlugFilename(job.data.filename) : job.data.filename; // Trim saved file name
    const inputFile = `${transcodeDir}/${trimmedFileName}`;
    const parsedInput = path.parse(inputFile);

    await this.ensureRcloneConfigExist(rcloneConfigFile, job.data.storage, job);
    if (job.data.linkedStorage)
      await this.ensureRcloneConfigExist(rcloneConfigFile, job.data.linkedStorage, job);

    // Retry if the transcoder was interrupted before
    const retryFromInterruption = await fileExists(transcodeDir);
    if (retryFromInterruption) {
      this.logger.notice('Transcode directory detected, maybe the transcoder was not exited properly before, cleaning up...');
      const status = { jobId: job.id, ...job.data };
      await this.videoResultQueue.add('retry-encoding', status);
      await deleteFolder(transcodeDir);
    }

    let availableQualityList: number[] | null = null;
    // Find and validate source quality if the quality is available on db
    {
      const sourceInfo = await mediaStorageModel.findOne({ _id: BigInt(job.data._id) }, { _id: 1, name: 1, quality: 1 }).lean().exec();
      if (sourceInfo?.quality) {
        try {
          availableQualityList = await this.validateSourceQuality(parsedInput, sourceInfo.quality, qualityList, codec,
            retryFromInterruption, job);
          if (availableQualityList === null)
            return {}; // There's nothing to encode
        } finally {
          if (availableQualityList === null)
            await deleteFolder(transcodeDir);
        }
      }
    }

    // Disconnect MongoDB
    await mongoose.disconnect();

    this.logger.info(`Downloading file from media id: ${job.data._id}`);
    try {
      const downloadedFileStats = await statFile(inputFile);
      if (!downloadedFileStats || downloadedFileStats.size !== job.data.size) {
        if (downloadedFileStats)
          await deleteFile(inputFile); // Delete file if exist
        const downloadStorage = job.data.linkedStorage || job.data.storage;
        await downloadFile(rcloneConfigFile, rcloneDir, downloadStorage, job.data.path, job.data.filename, transcodeDir,
          !!job.data.linkedStorage, (args => {
            this.logger.info('rclone ' + args.join(' '));
          }));
        if (job.data.linkedStorage) {
          // Trim file name and create folder on remote
          await Promise.all([
            renameFile(`${transcodeDir}/${job.data.filename}`, inputFile),
            mkdirRemote(rcloneConfigFile, rcloneDir, job.data.storage, job.data._id)
          ]);
        }
      }
    } catch (e) {
      this.logger.error(e);
      await deleteFolder(transcodeDir);
      const statusError = await this.generateStatusError(StatusCode.DOWNLOAD_FAILED, job);
      throw new Error(statusError.errorCode);
    }
    let videoInfo: FFprobe.FFProbeResult;
    let videoMIInfo: MediaInfoResult;
    this.logger.info(`Processing input file: ${inputFile}`);
    try {
      videoInfo = await FFprobe(inputFile, { path: `${ffmpegDir}/ffprobe` });
      videoMIInfo = await getMediaInfo(inputFile, mediainfoDir);
    } catch (e) {
      this.logger.error(e);
      await deleteFolder(transcodeDir);
      const statusError = await this.generateStatusError(StatusCode.PROBE_FAILED, job, { discard: true });
      throw new UnrecoverableError(statusError.errorCode);
    }

    const videoTrack = videoInfo.streams.find(s => s.codec_type === 'video');
    const videoMITrack = videoMIInfo.media.track.find(s => s['@type'] === 'Video');
    if (!videoTrack || !videoMITrack) {
      this.logger.error('Video track not found');
      await deleteFolder(transcodeDir);
      const statusError = await this.generateStatusError(StatusCode.NO_VIDEO_TRACK, job, { discard: true });
      throw new UnrecoverableError(statusError.errorCode);
    }

    const audioTracks = videoInfo.streams.filter(s => s.codec_type === 'audio');
    if (!audioTracks.length) {
      this.logger.error('Audio track not found');
      await deleteFolder(transcodeDir);
      const statusError = await this.generateStatusError(StatusCode.NO_AUDIO_TRACK, job, { discard: true });
      throw new UnrecoverableError(statusError.errorCode);
    }

    const runtime = videoInfo.format.duration ? Math.trunc(+videoInfo.format.duration) : 0;
    const videoDuration = videoTrack.duration ? Math.trunc(+videoTrack.duration) : runtime;
    const videoFps = Math.ceil(+videoMITrack.FrameRate) || Math.ceil(divideFromString(videoTrack.r_frame_rate));
    const videoBitrate = videoTrack.bit_rate ? Math.round(+videoTrack.bit_rate / 1000) :
      videoMITrack.BitRate ? Math.round(+videoMITrack.BitRate / 1000) : 0; // Bitrate in Kbps
    const videoCodec = videoTrack.codec_name || '';
    const videoSourceH264Params = (videoCodec === 'h264' && videoMITrack.Encoded_Library_Settings) ?
      videoMITrack.Encoded_Library_Settings : '';

    // Validate source file by reading the local file
    if (!availableQualityList) {
      try {
        availableQualityList = await this.validateSourceQuality(parsedInput, videoTrack.height, qualityList, codec,
          retryFromInterruption, job);
        if (availableQualityList === null)
          return {}; // There's nothing to encode
      } finally {
        if (availableQualityList === null)
          await deleteFolder(transcodeDir);
      }
    }

    const srcWidth = videoTrack.width || 0;
    const srcHeight = videoTrack.height || 0;

    this.logger.info(`Video resolution: ${srcWidth}x${srcHeight}`);

    await this.kamplexApiService.ensureProducerAppIsOnline(job.data.producerUrl);
    await this.videoResultQueue.add('update-source', {
      ...job.data,
      jobId: job.id,
      progress: {
        sourceId: job.data._id,
        quality: srcHeight,
        runtime: runtime
      }
    });

    const manifest = new StreamManifest();
    // const existingManifestData = await this.findExistingManifest(job.data.storage, job.data._id, codec);
    // if (existingManifestData !== null)
    //   manifest.load(existingManifestData);

    // Skip audio encoding for other codecs
    // Only encode if there's no audio track inside the manifest data
    if (codec === VideoCodec.H264 /*&& manifest.manifest.audioTracks.length === 0*/) {
      this.logger.info('Processing audio');
      const defaultAudioTrack = audioTracks.find(a => a.disposition.default) || audioTracks[0];
      const allowedAudioTracks = new Set(job.data.advancedOptions?.selectAudioTracks || []);
      if (allowedAudioTracks.size === 0)
        allowedAudioTracks.add(defaultAudioTrack.index);

      const audioNormalTrack = audioTracks.find(a => a.channels <= 2 && allowedAudioTracks.has(a.index));
      const audioSurroundTrack = audioTracks.find(a => a.channels > 2 && allowedAudioTracks.has(a.index));
      const audioPrimaryTracks = [audioNormalTrack, audioSurroundTrack].filter(a => a != null);
      const allowedExtraAudioTracks = new Set(job.data.advancedOptions?.extraAudioTracks || []);
      const audioExtraTracks = audioTracks.filter(a => !audioPrimaryTracks.includes(a) && allowedExtraAudioTracks.has(a.index));

      const firstAudioTrack = audioNormalTrack || audioSurroundTrack || defaultAudioTrack;
      const secondAudioTrack = audioSurroundTrack;

      try {
        // Audio language for primary track
        const audioOriginalLang = mediaInfo.originalLang;
        // Encode surround audio track
        if (secondAudioTrack != null) {
          this.logger.info(`Audio track index ${secondAudioTrack.index} (surround)`);
          await this.encodeAudioByTrack({
            inputFile, parsedInput, type: 'surround', audioTrack: secondAudioTrack, audioAACParams: audioSurroundParams,
            audioOpusParams: audioSurroundOpusParams, isDefault: true, downmix: false, language: audioOriginalLang, manifest, job
          });
        }
        // Encode stereo or mono audio track
        this.logger.info(`Audio track index ${firstAudioTrack.index} (normal)`);
        await this.encodeAudioByTrack({
          inputFile, parsedInput, type: 'normal', audioTrack: firstAudioTrack, audioAACParams: audioParams,
          audioOpusParams: audioSpeedParams, isDefault: !secondAudioTrack, downmix: firstAudioTrack.channels > 2,
          language: audioOriginalLang, manifest, job
        });
        // Encode any others audio tracks
        for (let i = 0; i < audioExtraTracks.length; i++) {
          const extraAudioTrack = audioExtraTracks[i];
          const extraTrackLang = extraAudioTrack.tags?.language || 'N/A';
          const extraTrackType = extraAudioTrack.channels > 2 ? 'surround' : 'normal';
          const extraAACParams = extraAudioTrack.channels > 2 ? audioSurroundParams : audioParams;
          const extraOpusParams = extraAudioTrack.channels > 2 ? audioSurroundOpusParams : audioSpeedParams;
          this.logger.info(`Audio track index ${extraAudioTrack.index} (others, channels: ${extraAudioTrack.channels}, language: ${extraTrackLang})`);
          await this.encodeAudioByTrack({
            inputFile, parsedInput, type: extraTrackType, audioTrack: extraAudioTrack, audioAACParams: extraAACParams,
            audioOpusParams: extraOpusParams, isDefault: false, downmix: false, manifest, job
          });
        }
      } catch (e) {
        this.logger.error(JSON.stringify(e));
        await deleteFolder(transcodeDir);
        if (e === RejectCode.JOB_CANCEL) {
          this.logger.info(`Received cancel signal from job id: ${job.id}`);
          return {};
        }
        const statusError = await this.generateStatusError(StatusCode.ENCODE_AUDIO_FAILED, job);
        throw new Error(statusError.errorCode);
      }
    }

    try {
      const sourceInfo: VideoSourceInfo = {
        duration: videoDuration, fps: videoFps, bitrate: videoBitrate, codec: videoCodec, sourceH264Params: videoSourceH264Params,
        width: srcWidth, height: srcHeight, language: mediaInfo.originalLang
      };
      if (codec === VideoCodec.H264) {
        this.logger.info('Video codec: H264');
        await this.encodeByCodec({
          inputFile, parsedInput, sourceInfo, qualityList: availableQualityList, encodingSettings,
          advancedSettings: job.data.advancedOptions, codec: VideoCodec.H264, videoParams: videoH264Params, manifest, job
        });
      }
      else if (codec === VideoCodec.VP9) {
        this.logger.info('Video codec: VP9');
        await this.encodeByCodec({
          inputFile, parsedInput, sourceInfo, qualityList: availableQualityList, encodingSettings,
          advancedSettings: job.data.advancedOptions, codec: VideoCodec.VP9, videoParams: videoVP9Params, manifest, job
        });
      }
      else if (codec === VideoCodec.AV1) {
        this.logger.info('Video codec: AV1');
        await this.encodeByCodec({
          inputFile, parsedInput, sourceInfo, qualityList: availableQualityList, encodingSettings,
          advancedSettings: job.data.advancedOptions, codec: VideoCodec.AV1, videoParams: videoAV1Params, manifest, job
        });
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
      }, [
        { tw: 160, th: 160, pageCols: 10, pageRows: 10, prefix: 'M', format: 'jpeg' },
        { tw: 320, th: 320, pageCols: 5, pageRows: 5, prefix: 'L', format: 'jpeg' }
      ]);
      const syncThumbnails = !!job.data.update;
      const rcloneMoveThumbArgs = this.createRcloneMoveThumbArgs(transcodeDir, job.data.storage, job.data._id, syncThumbnails);
      await this.uploadMedia(rcloneMoveThumbArgs, job.id);

      if (job.data.replaceStreams?.length) {
        this.logger.info('Removing old streams');
        for (let i = 0; i < job.data.replaceStreams.length; i++) {
          await deletePath(rcloneConfigFile, rcloneDir,
            job.data.storage, `${job.data._id}/${job.data.replaceStreams[i]}`, (args => {
              this.logger.info('rclone ' + args.join(' '));
            }))
        }
      }

      // Check uploaded files
      this.logger.info('Checking uploaded files');
      const checkFilesExclusion = `${this.thumbnailFolder}/**`;
      let uploadedFiles = await this.findUploadedFiles(job.data.storage, job.data._id, job.id, checkFilesExclusion);
      let listAttempt = 1;
      // 1 source file (0 for linked source), 3 audio files, and video files
      const totalExpectedFiles = availableQualityList.length + (job.data.linkedStorage ? 0 : 1) + 3;
      const maxTries = 5;
      while (uploadedFiles.length < totalExpectedFiles && listAttempt < maxTries) {
        uploadedFiles = await this.findUploadedFiles(job.data.storage, job.data._id, job.id, checkFilesExclusion);
        listAttempt++;
      }
      this.logger.info(`${uploadedFiles.length}/${totalExpectedFiles} files uploaded`);
    } catch (e) {
      this.logger.error(JSON.stringify(e));
      if (e === RejectCode.JOB_CANCEL) {
        this.logger.info(`Received cancel signal from job id: ${job.id}`);
        //await this.kamplexApiService.ensureProducerAppIsOnline(job.data.producerUrl);
        //await this.videoResultQueue.add('cancelled-encoding', this.generateStatus(job));
        return {};
      }
      const statusError = await this.generateStatusError(StatusCode.ENCODE_VIDEO_FAILED, job);
      throw new Error(statusError.errorCode);
    } finally {
      this.logger.info('Cleaning up');
      await deleteFolder(transcodeDir);
      this.logger.info('Completed');
    }
    await this.kamplexApiService.ensureProducerAppIsOnline(job.data.producerUrl);
    await this.videoResultQueue.add('finished-encoding', this.generateStatus(job));
    return {};
  }

  addToCanceled(job: Job<IJobData>) {
    if (job.data.id)
      this.CanceledJobIds.push(job.data.id);
    else if (job.data.ids)
      this.CanceledJobIds.push(...job.data.ids);
    return job.data;
  }

  private async encodeAudioByTrack(options: EncodeAudioByTrackOptions) {
    const { inputFile, parsedInput, type, audioTrack, audioAACParams, audioOpusParams, isDefault, downmix, language, manifest, job } = options;
    const aacType = type === 'normal' ? AudioCodec.AAC : AudioCodec.AAC_SURROUND;
    const opusType = type === 'normal' ? AudioCodec.OPUS : AudioCodec.OPUS_SURROUND;
    this.logger.info('Audio codec: AAC');
    const audioDuration = audioTrack.duration ? Math.trunc(+audioTrack.duration) : 0;
    const audioChannels = audioTrack.channels || (type === 'normal' ? 2 : 0);
    await this.encodeAudio({
      inputFile, parsedInput, sourceInfo: { duration: audioDuration, channels: audioChannels, language },
      audioTrackIndex: audioTrack.index, codec: aacType, isDefault, downmix, audioParams: audioAACParams,
      manifest, job
    });
    // Only encode opus surround if the source audio has 5 (4.1), 6 (5.1), 7 (6.1) or 8 (7.1) channels
    if (type === 'normal' || [5, 6, 7, 8].includes(audioChannels)) {
      this.logger.info('Audio codec: OPUS');
      await this.encodeAudio({
        inputFile, parsedInput, sourceInfo: { duration: audioDuration, channels: audioChannels, language },
        audioTrackIndex: audioTrack.index, codec: opusType, isDefault: false, downmix, audioParams: audioOpusParams,
        manifest, job
      });
    }
  }

  private async encodeAudio(options: EncodeAudioOptions) {
    const { inputFile, parsedInput, sourceInfo, audioTrackIndex, codec, isDefault, downmix, audioParams, manifest, job } = options;
    const streamId = await createSnowFlakeId();
    const audioArgs = this.createAudioEncodingArgs({
      inputFile, parsedInput, audioParams, codec, channels: sourceInfo.channels,
      downmix, audioIndex: audioTrackIndex
    });
    const audioBaseName = `${parsedInput.name}_audio_${audioTrackIndex}`;
    const audioFileName = `${audioBaseName}.mp4`;
    const manifestFileName = `${audioBaseName}.m3u8`;
    const mpdManifestFileName = `${audioBaseName}.mpd`;
    const playlistFileName = `${audioBaseName}_1.m3u8`;
    await this.encodeMedia(audioArgs, sourceInfo.duration, job.id);

    await this.prepareMediaFile(audioFileName, parsedInput, `${audioBaseName}_temp`, manifestFileName, job);

    this.logger.info(`Reading audio data: ${audioFileName}, ${mpdManifestFileName}, ${playlistFileName} and ${manifestFileName}`);
    const audioInfo = await FFprobe(`${parsedInput.dir}/${audioFileName}`, { path: `${this.configService.get<string>('FFMPEG_DIR')}/ffprobe` });
    const audioTrack = audioInfo.streams.find(s => s.codec_type === 'audio');
    const audioMIInfo = await getMediaInfo(`${parsedInput.dir}/${audioFileName}`, this.configService.get<string>('MEDIAINFO_DIR'));
    const audioMITrack = audioMIInfo.media.track.find(s => s['@type'] === 'Audio');
    if (!audioTrack || !audioMITrack)
      throw new Error('Failed to get encoded audio info');
    await manifest.appendAudioPlaylist({
      mpdPath: `${parsedInput.dir}/${mpdManifestFileName}`,
      m3u8PlaylistPath: `${parsedInput.dir}/${playlistFileName}`,
      format: audioMITrack.Format,
      mimeType: 'audio/mp4',
      isDefault: isDefault,
      language: sourceInfo.language || audioMITrack.Language,
      channels: +audioMITrack.Channels || audioTrack.channels || 2,
      samplingRate: +audioMITrack.SamplingRate || +audioTrack.sample_rate || 0,
      codec: codec,
      uri: `${streamId}/${audioFileName}`
    });

    const rcloneMoveArgs = this.createRcloneMoveArgs(`${parsedInput.dir}/${audioFileName}`,
      `${job.data.storage}:${job.data._id}/${streamId}`);
    await this.uploadMedia(rcloneMoveArgs, job.id);

    await this.kamplexApiService.ensureProducerAppIsOnline(job.data.producerUrl);
    await this.videoResultQueue.add('add-stream-audio', {
      ...job.data,
      jobId: job.id,
      progress: {
        sourceId: job.data._id,
        streamId: streamId,
        fileName: audioFileName,
        codec: codec,
        channels: +audioMITrack.Channels || audioTrack.channels || 2,
      }
    });
  }

  private async encodeByCodec(options: EncodeVideoOptions) {
    const {
      inputFile, parsedInput, sourceInfo, qualityList, encodingSettings, advancedSettings = {}, codec, videoParams,
      manifest, job
    } = options;
    // Merge default encoding settings with override settings
    if (advancedSettings.overrideSettings) {
      advancedSettings.overrideSettings.forEach(os => {
        const qualitySettings = encodingSettings.find(s => s.quality === os.quality);
        if (qualitySettings)
          Object.assign(qualitySettings, os);
      });
    }
    for (let i = 0; i < qualityList.length; i++) {
      this.logger.info(`Processing video quality: ${qualityList[i]}`);
      const streamId = await createSnowFlakeId();
      const perQualitySettings = encodingSettings.find(s => s.quality === qualityList[i]);
      const videoBaseName = `${parsedInput.name}_${qualityList[i]}`;
      const videoFileName = `${videoBaseName}.mp4`;
      const manifestFileName = `${videoBaseName}.m3u8`;
      const mpdManifestFileName = `${videoBaseName}.mpd`;
      const playlistFileName = `${videoBaseName}_1.m3u8`;
      try {
        if (codec === VideoCodec.H264) {
          const videoArgs = this.createVideoEncodingArgs({
            inputFile, parsedInput, codec, quality: qualityList[i], videoParams,
            sourceInfo, crfKey: 'crf', advancedSettings, encodingSetting: perQualitySettings
          });
          await this.encodeMedia(videoArgs, sourceInfo.duration, job.id);
        } else {
          // Pass 1 params
          const videoPass1Args = this.createTwoPassesVideoEncodingArgs({
            inputFile, parsedInput, codec, quality: qualityList[i], videoParams,
            sourceInfo, crfKey: 'cq', advancedSettings, encodingSetting: perQualitySettings, pass: 1
          });
          // Pass 2 params
          const videoPass2Args = this.createTwoPassesVideoEncodingArgs({
            inputFile, parsedInput, codec, quality: qualityList[i], videoParams,
            sourceInfo, crfKey: 'cq', advancedSettings, encodingSetting: perQualitySettings, pass: 2
          });

          await this.encodeMedia(videoPass1Args, sourceInfo.duration, job.id);
          await this.encodeMedia(videoPass2Args, sourceInfo.duration, job.id);
        }

        await this.prepareMediaFile(videoFileName, parsedInput, `${videoBaseName}_temp`, manifestFileName, job);

        this.logger.info(`Reading video data: ${videoFileName}, ${mpdManifestFileName}, ${playlistFileName} and ${manifestFileName}`);
        const videoMIInfo = await getMediaInfo(`${parsedInput.dir}/${videoFileName}`, this.configService.get<string>('MEDIAINFO_DIR'));
        const generalMITrack = videoMIInfo.media.track.find(s => s['@type'] === 'General');
        const videoMITrack = videoMIInfo.media.track.find(s => s['@type'] === 'Video');
        if (!videoMITrack)
          throw new Error('Failed to get encoded video info');
        manifest.appendVideoPlaylist({
          mpdPath: `${parsedInput.dir}/${mpdManifestFileName}`,
          m3u8PlaylistPath: `${parsedInput.dir}/${playlistFileName}`,
          width: +videoMITrack.Width || 0,
          height: +videoMITrack.Height || 0,
          format: videoMITrack.Format,
          mimeType: 'video/mp4',
          language: sourceInfo.language || videoMITrack.Language,
          frameRate: +videoMITrack.FrameRate || +generalMITrack?.FrameRate,
          codec: codec,
          uri: `${streamId}/${videoFileName}`
        });

        const rcloneMoveArgs = this.createRcloneMoveArgs(`${parsedInput.dir}/${videoFileName}`,
          `${job.data.storage}:${job.data._id}/${streamId}`);
        await this.uploadMedia(rcloneMoveArgs, job.id);

        // Save and upload manifest file
        await this.saveManifestFile(manifest, parsedInput.dir, codec, job);
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

      await this.kamplexApiService.ensureProducerAppIsOnline(job.data.producerUrl);
      await this.videoResultQueue.add('add-stream-video', {
        ...job.data,
        jobId: job.id,
        progress: {
          sourceId: job.data._id,
          streamId: streamId,
          fileName: videoFileName,
          codec: codec,
          quality: qualityList[i],
        }
      });
    }
  }

  @Cron('0 0 */5 * *')
  async handleInactiveRefreshToken() {
    // Runs every 5 days
    // Try to refresh all inactive tokens
    this.logger.info('Running scheduled token refresh');
    const rcloneDir = this.configService.get<string>('RCLONE_DIR');
    const rcloneConfig = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const remoteList = await findAllRemotes(rcloneConfig, rcloneDir);
    if (!remoteList.length) return;
    await refreshRemoteTokens(rcloneConfig, rcloneDir, remoteList, args => {
      this.logger.info('rclone ' + args.join(' '));
    });
  }

  private async prepareMediaFile(inputFileName: string, parsedInput: path.ParsedPath, tempFileName: string, playlistName: string,
    job: Job<IVideoData>) {
    this.logger.info(`Preparing media file: ${inputFileName}`);
    const inputFilePath = `${parsedInput.dir}/${inputFileName}`;
    const inputSourceFile = `${parsedInput.dir}/${job.data.filename}`;
    const hasFreeSpace = await hasFreeSpaceToCopyFile(inputFilePath, parsedInput.dir);
    if (!hasFreeSpace) {
      this.logger.warning(`Not enough disk space to duplicate file, deleting: ${job.data.filename} temporary`);
      await deleteFile(inputSourceFile);
    }
    const mp4boxPackArgs = this.createMP4BoxPackArgs(inputFilePath, parsedInput, tempFileName, playlistName);
    await this.packageMedia(mp4boxPackArgs, job.id);
    await deleteFile(inputFilePath);
    const tempFilePath = `${parsedInput.dir}/${tempFileName}.mp4`;
    await renameFile(tempFilePath, inputFilePath);
    if (!hasFreeSpace) {
      this.logger.info(`Redownloading: ${job.data.filename}`);
      const rcloneDir = this.configService.get<string>('RCLONE_DIR');
      const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
      const downloadStorage = job.data.linkedStorage || job.data.storage;
      await downloadFile(rcloneConfigFile, rcloneDir, downloadStorage, job.data.path, job.data.filename, parsedInput.dir,
        !!job.data.linkedStorage,
        (args => {
          this.logger.info('rclone ' + args.join(' '));
        }));
    }
  }

  private async saveManifestFile(manifest: StreamManifest, transcodeDir: string, codec: number, job: Job<IVideoData>) {
    const manifestFileName = `manifest_${codec}.json`;
    const manifestFilePath = `${transcodeDir}/${manifestFileName}`;
    const streamId = await createSnowFlakeId();
    this.logger.info(`Generating manifest file: ${manifestFileName}`);
    await manifest.saveFile(manifestFilePath);
    const rcloneMoveManifestArgs = this.createRcloneMoveArgs(manifestFilePath, `${job.data.storage}:${job.data._id}/${streamId}`);
    await this.uploadMedia(rcloneMoveManifestArgs, job.id);
    await this.videoResultQueue.add('add-stream-manifest', {
      ...job.data,
      jobId: job.id,
      progress: {
        sourceId: job.data._id,
        streamId: streamId,
        fileName: manifestFileName,
        codec: codec
      }
    });
  }

  private createAudioEncodingArgs(options: CreateAudioEncodingArgsOptions) {
    const { inputFile, parsedInput, audioParams, codec, channels, downmix, audioIndex } = options;
    const bitrate = AudioCodec.OPUS === codec ? 128 : AudioCodec.OPUS_SURROUND === codec ? 64 * channels : 0;
    const args: string[] = [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      '-vn'
    ];
    if (bitrate > 0) {
      args.push('-b:a', `${bitrate}K`);
    }
    args.push(...audioParams);
    if (downmix) {
      if (codec === AudioCodec.AAC) {
        args.push(
          '-af',
          '"lowpass=c=LFE:f=120,pan=stereo|FL=.3FL+.21FC+.3FLC+.21SL+.21BL+.15BC+.21LFE|FR=.3FR+.21FC+.3FRC+.21SR+.21BR+.15BC+.21LFE,volume=1.6"'
        );
      }
      else if (codec === AudioCodec.OPUS) {
        args.push('-ac', '2');
        args.push('-mapping_family', '0');
      }
    } else if (channels > 2) {
      const channelValue = channels <= 8 ? channels.toString() : '8'; // 8 channels (7.1) is the limit for both aac and opus
      args.push('-ac', channelValue);
      if (codec === AudioCodec.OPUS_SURROUND) {
        args.push('-mapping_family', '1');
      }
    }
    args.push(
      '-map', `0:${audioIndex}`,
      //'-map_metadata', '-1',
      '-map_chapters', '-1',
      '-f', 'mp4',
      `"${parsedInput.dir}/${parsedInput.name}_audio_${audioIndex}.mp4"`
    );
    return args;
  }

  private createVideoEncodingArgs(options: CreateVideoEncodingArgsOptions) {
    const { inputFile, parsedInput, codec, quality, videoParams, sourceInfo, crfKey, advancedSettings, encodingSetting } = options;
    const gopSize = (sourceInfo.fps ? sourceInfo.fps * 2 : 48).toString();
    const args: string[] = [
      '-hide_banner', '-y',
      '-progress', 'pipe:1',
      '-loglevel', 'error',
      '-i', `"${inputFile}"`,
      ...videoParams,
      '-g', gopSize,
      '-keyint_min', gopSize,
      '-sc_threshold', '0'
    ];
    if (encodingSetting)
      this.resolveEncodingSettings(args, encodingSetting, sourceInfo, crfKey);
    if (codec === VideoCodec.H264)
      this.resolveH264Params(args, advancedSettings, quality, sourceInfo);
    args.push(
      '-map', '0:v:0',
      //'-map_metadata', '-1',
      '-map_chapters', '-1',
      '-vf', `scale=-2:${quality}`,
      //'-movflags', '+faststart',
      '-f', 'mp4',
      `"${parsedInput.dir}/${parsedInput.name}_${quality}.mp4"`
    );
    return args;
  }

  private createTwoPassesVideoEncodingArgs(options: CreateVideoEncodingArgsOptions & { pass: number }) {
    const { inputFile, parsedInput, codec, quality, videoParams, sourceInfo, crfKey, advancedSettings, encodingSetting, pass } = options;
    const gopSize = (sourceInfo.fps ? sourceInfo.fps * 2 : 48).toString();
    if (pass === 1) {
      const outputName = process.platform === 'win32' ? 'NUL' : '/dev/null';
      const args = [
        '-hide_banner', '-y',
        '-progress', 'pipe:1',
        '-loglevel', 'error',
        '-i', `"${inputFile}"`,
        ...videoParams,
        '-g', gopSize,
        '-keyint_min', gopSize,
        '-sc_threshold', '0'
      ];
      if (encodingSetting)
        this.resolveEncodingSettings(args, encodingSetting, sourceInfo, crfKey);
      if (codec === VideoCodec.H264)
        this.resolveH264Params(args, advancedSettings, quality, sourceInfo);
      args.push(
        '-map', '0:v:0',
        '-vf', `scale=-2:${quality}`,
        //'-movflags', '+faststart',
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
      ...videoParams,
      '-g', gopSize,
      '-keyint_min', gopSize,
      '-sc_threshold', '0'
    ];
    if (encodingSetting)
      this.resolveEncodingSettings(args, encodingSetting, sourceInfo, crfKey);
    if (codec === VideoCodec.H264)
      this.resolveH264Params(args, advancedSettings, quality, sourceInfo);
    args.push(
      '-map', '0:v:0',
      //'-map_metadata', '-1',
      '-map_chapters', '-1',
      '-vf', `scale=-2:${quality}`,
      //'-movflags', '+faststart',
      '-passlogfile', `"${parsedInput.dir}/${parsedInput.name}_2pass.log"`,
      '-pass', '2',
      '-f', 'mp4',
      `"${parsedInput.dir}/${parsedInput.name}_${quality}.mp4"`
    );
    return args;
  }

  private resolveEncodingSettings(args: string[], encodingSetting: IEncodingSetting, sourceInfo: VideoSourceInfo,
    crfKey: 'crf' | 'cq' = 'crf') {
    const crfValue = crfKey === 'crf' ? encodingSetting.crf : encodingSetting.cq;
    crfValue && args.push('-crf', crfValue.toString());
    // Should double the bitrate when the source codec isn't h264 (could be h265, vp9 or av1)
    const baseBitrate = sourceInfo.codec === 'h264' ? sourceInfo.bitrate : sourceInfo.bitrate * 2;
    if (encodingSetting.useLowerRate && baseBitrate > 0 && baseBitrate < encodingSetting.maxrate) {
      encodingSetting.maxrate && args.push('-maxrate', `${baseBitrate}K`);
      encodingSetting.bufsize && args.push('-bufsize', `${baseBitrate * 2}K`);
    } else {
      encodingSetting.maxrate && args.push('-maxrate', `${encodingSetting.maxrate}K`);
      encodingSetting.bufsize && args.push('-bufsize', `${encodingSetting.bufsize}K`);
    }
  }

  private resolveH264Params(args: string[], advancedSettings: AdvancedVideoSettings, quality: number, sourceInfo: VideoSourceInfo) {
    if (advancedSettings.h264Tune) {
      args.push('-tune', advancedSettings.h264Tune);
    }
    if (quality >= 1440) {
      // Find the best h264 profile level for > 2k resolution
      const level = findH264ProfileLevel(sourceInfo.width, sourceInfo.height, quality, sourceInfo.fps);
      if (level !== null) {
        args.push('-level:v', level);
      }
    }
    if (sourceInfo.sourceH264Params) {
      const x264Params = createH264Params(sourceInfo.sourceH264Params, sourceInfo.height === quality);
      args.push('-x264-params', `"${x264Params}"`);
    }
  }

  private createMP4BoxPackArgs(input: string, parsedInput: path.ParsedPath, tempFileName: string, playlistName: string) {
    const segmentInitName = process.platform === 'win32' ? '$Init=$' : '\\$Init=\\$';
    const args: string[] = [
      '-dash', '6000',
      '-profile', 'onDemand',
      '-segment-name', `"${tempFileName}${segmentInitName}"`,
      '-out', `"${parsedInput.dir}/${playlistName}:dual"`,
      `"${input}"`
    ];
    return args;
  }

  private createRcloneMoveArgs(source: string, dest: string, include?: string) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      '--low-level-retries', '5',
      '-v', '--use-json-log',
      '--stats', '3m',
      'move', `"${source}"`, `"${dest}"`
    ];
    if (include) {
      args.push('--include', include);
    }
    return args;
  }

  private createRcloneMoveThumbArgs(transcodeDir: string, remote: string, parentFolder: string, sync: boolean = false) {
    const targetCommand = sync ? 'sync' : 'move';
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      '--low-level-retries', '5',
      '-v', '--use-json-log',
      '--stats', '3m',
      targetCommand,
      `"${transcodeDir}/${this.thumbnailFolder}"`,
      `"${remote}:${parentFolder}/${this.thumbnailFolder}"`
    ];
    return args;
  }

  private encodeMedia(args: string[], videoDuration: number, jobId: string | number) {
    return new Promise<void>((resolve, reject) => {
      let isCancelled = false;

      this.logger.info('ffmpeg ' + args.join(' '));
      const ffmpeg = child_process.spawn(`"${this.configService.get<string>('FFMPEG_DIR')}/ffmpeg"`, args, { shell: true });

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

  private packageMedia(args: string[], jobId: string | number) {
    return new Promise<void>((resolve, reject) => {
      let isCancelled = false;

      this.logger.info('MP4Box ' + args.join(' '));
      const mp4box = child_process.spawn(`"${this.configService.get<string>('MP4BOX_DIR')}/MP4Box"`, args, { shell: true });

      mp4box.stderr.setEncoding('utf8');
      mp4box.stderr.on('data', (data) => {
        stdout.write(data);
      });

      const cancelledJobChecker = this.createCancelJobChecker(jobId, () => {
        isCancelled = true;
        mp4box.kill('SIGINT'); // Stop key
      });

      mp4box.on('exit', (code: number) => {
        stdout.write('\n');
        clearInterval(cancelledJobChecker);
        if (isCancelled) {
          reject(RejectCode.JOB_CANCEL);
        } else if (code !== 0) {
          reject(`MP4Box exited with status code: ${code}`);
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
      const rclone = child_process.spawn(`"${this.configService.get<string>('RCLONE_DIR')}/rclone"`, args, { shell: true });

      rclone.stderr.setEncoding('utf8');
      rclone.stderr.on('data', (data) => {
        const progress = parseRcloneUploadProgress(data);
        if (progress)
          stdout.write(`${progress.msg}\r`);
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

  private findUploadedFiles(remote: string, parentFolder: string, jobId: string | number, exclude?: string) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const args: string[] = [
      '--config', rcloneConfigFile,
      'lsjson', `${remote}:${parentFolder}`,
      '--recursive', '--files-only'
    ];
    if (exclude) {
      args.push('--exclude', exclude);
    }
    return new Promise<RcloneFile[]>((resolve, reject) => {
      let isCancelled = false;
      this.logger.info('rclone ' + args.join(' '));
      const rclone = child_process.spawn(`"${this.configService.get<string>('RCLONE_DIR')}/rclone"`, args, { shell: true });

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
        } else if (code === 3) {
          // Return an empty array if directory not found
          resolve([]);
        } else if (code !== 0) {
          reject(`Error listing files, rclone exited with status code: ${code}`);
        } else {
          const fileData = JSON.parse(listJson);
          resolve(fileData);
        }
      });
    });
  }

  private async ensureRcloneConfigExist(configFile: string, storage: string, job: Job<IVideoData>) {
    const configExists = await findInFile(configFile, `[${storage}]`);
    if (!configExists) {
      this.logger.info(`Config for remote "${storage}" not found, generating...`);
      let externalStorage = await externalStorageModel.findOne({ _id: BigInt(storage) }).lean().exec();
      if (!externalStorage) {
        const statusError = await this.generateStatusError(StatusCode.STORAGE_NOT_FOUND, job);
        throw new Error(statusError.errorCode);
      }
      externalStorage = await this.decryptToken(externalStorage);
      const newConfig = createRcloneConfig(externalStorage);
      await appendToFile(configFile, newConfig);
      this.logger.info(`Generated config for remote "${storage}"`);
    }
  }

  private async findAvailableQuality(uploadedFiles: RcloneFile[], allQualityList: number[], parsedInput: path.ParsedPath,
    codec: number, replaceStreams: string[] = [], job: Job<IVideoData>) {
    const fileIds: bigint[] = [];
    for (let i = 0; i < uploadedFiles.length; i++) {
      if (!allQualityList.find(q => uploadedFiles[i].Name === `${parsedInput.name}_${q}.mp4`))
        continue;
      const stringId = uploadedFiles[i].Path.split('/')[0];
      if (replaceStreams.includes(stringId))
        continue;
      if (isNaN(<any>stringId))
        continue;
      fileIds.push(BigInt(stringId));
    }
    await mongoose.connect(this.configService.get<string>('DATABASE_URL'), { family: 4, useBigInt64: true });
    const sourceFileMeta = await mediaStorageModel.findOne({ _id: BigInt(job.data._id) }).lean().exec();
    await mongoose.disconnect();
    const qualityList = sourceFileMeta.streams
      .filter(file => file.codec === codec && fileIds.includes(file._id))
      .map(file => file.quality);
    const availableQualityList = allQualityList.filter(quality => !qualityList.includes(quality));
    return availableQualityList;
  }

  private calculateQuality(height: number, qualityList: number[]) {
    const availableQualityList: number[] = [];
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

  private async validateSourceQuality(parsedInput: path.ParsedPath, quality: number, qualityList: number[], codec: number,
    retryFromInterruption: boolean, job: Job<IVideoData>): Promise<number[] | null> {
    const allQualityList = this.calculateQuality(quality, qualityList);
    this.logger.info(`All quality: ${allQualityList.length ? allQualityList.join(', ') : 'None'}`);
    if (!allQualityList.length) {
      const statusError = await this.generateStatusError(StatusCode.LOW_QUALITY_VIDEO, job, { discard: true });
      throw new UnrecoverableError(statusError.errorCode);
    }
    let availableQualityList: number[];
    if (!retryFromInterruption) {
      // Check already encoded files
      this.logger.info('Checking already encoded files');
      let alreadyEncodedFiles = await this.findUploadedFiles(job.data.storage, job.data._id, job.id, `${this.thumbnailFolder}/**`);
      availableQualityList = await this.findAvailableQuality(alreadyEncodedFiles, allQualityList, parsedInput, codec,
        job.data.replaceStreams, job);
      this.logger.info(`Available quality: ${availableQualityList.length ? availableQualityList.join(', ') : 'None'}`);
      if (!availableQualityList.length) {
        this.logger.info('Everything is already encoded, no need to continue');
        await this.kamplexApiService.ensureProducerAppIsOnline(job.data.producerUrl);
        await this.videoResultQueue.add('cancelled-encoding', { ...job.data, jobId: job.id, keepStreams: true });
        return null;
      }
    } else {
      availableQualityList = [...allQualityList];
    }
    // Ensure the folder is empty if we need to encode all the qualities
    if (allQualityList.length === availableQualityList.length && retryFromInterruption) {
      const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
      const rcloneDir = this.configService.get<string>('RCLONE_DIR');
      this.logger.info('Cleanning source folder');
      await emptyPath(rcloneConfigFile, rcloneDir, job.data.storage, `${job.data._id}/*`, args => {
        this.logger.info('rclone ' + args.join(' '));
      }, {
        include: '*/**'
      });
    }
    return availableQualityList;
  }

  private async findExistingManifest(remote: string, parentFolder: string, codec: number) {
    const rcloneConfigFile = this.configService.get<string>('RCLONE_CONFIG_FILE');
    const rcloneDir = this.configService.get<string>('RCLONE_DIR');
    const [manifestFileInfo] = await listRemoteJson(rcloneConfigFile, rcloneDir, remote, parentFolder, {
      filesOnly: true,
      recursive: true,
      include: `*/manifest_${codec}.json`
    });
    if (!manifestFileInfo)
      return null;
    this.logger.info(`Found existing manifest from ${manifestFileInfo.Path}, reading data...`);
    const manifestContent = await readRemoteFile(rcloneConfigFile, rcloneDir, remote, parentFolder, manifestFileInfo.Path, args => {
      this.logger.info('rclone ' + args.join(' '));
    });
    if (!manifestContent)
      return null;
    return <HlsManifest>JSON.parse(manifestContent);
  }

  private async decryptToken(storage: IStorage) {
    const stringCrypto = new StringCrypto(this.configService.get<string>('CRYPTO_SECRET_KEY'));
    storage.clientSecret = await stringCrypto.decrypt(storage.clientSecret);
    if (storage.accessToken)
      storage.accessToken = await stringCrypto.decrypt(storage.accessToken);
    storage.refreshToken = await stringCrypto.decrypt(storage.refreshToken);
    return storage;
  }

  private async generateStatusError(errorCode: string, job: Job<IVideoData>, options: { discard: boolean } = { discard: false }) {
    const status = { errorCode, jobId: job.id, ...job.data };
    const statusJson = JSON.stringify(status);
    this.logger.error(`Error: ${errorCode} - ${statusJson}`);
    await this.kamplexApiService.ensureProducerAppIsOnline(job.data.producerUrl);
    if (options.discard)
      job.discard();
    if (options.discard || job.attemptsMade >= job.opts.attempts)
      await this.videoResultQueue.add('failed-encoding', status);
    else if (job.attemptsMade < job.opts.attempts)
      await this.videoResultQueue.add('retry-encoding', status);
    return status;
  }

  private generateStatus(job: Job<IVideoData>) {
    return { jobId: job.id, ...job.data };
  }
}