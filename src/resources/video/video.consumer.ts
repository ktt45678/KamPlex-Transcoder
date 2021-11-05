import { Processor, Process, OnQueueActive } from '@nestjs/bull';
import { Job } from 'bull';

import { VideoService } from './video.service';
import { TaskQueue } from '../../enums/task-queue.enum';
import { IVideoData } from './interfaces/video-data.interface';
import { StreamCodec } from 'src/enums/stream-codec.enum';

@Processor(TaskQueue.VIDEO_TRANSCODE)
export class VideoCosumer {
  constructor(private readonly videoService: VideoService) { }

  @Process(StreamCodec.H264_AAC.toString())
  async transcodeH264AAC(job: Job<IVideoData>) {
    const result = await this.videoService.transcode(job, StreamCodec.H264_AAC);
    return result;
  }

  /*
  @Process(StreamCodec.VP9_AAC.toString())
  async transcodeVP9AAC(job: Job<IVideoData>) {
    const result = await this.videoService.transcode(job, StreamCodec.VP9_AAC);
    return result;
  }

  @Process(StreamCodec.AV1_AAC.toString())
  async transcodeAV1AAC(job: Job<IVideoData>) {
    const result = await this.videoService.transcode(job, StreamCodec.AV1_AAC);
    return result;
  }
  */

  @OnQueueActive()
  onActive(job: Job) {
    console.log('\x1b[33m%s\x1b[0m', `Processing job ${job.id} of type ${job.name}`);
  }
}
