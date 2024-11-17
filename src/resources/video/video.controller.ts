import { Controller, Get, Post } from '@nestjs/common';

import { BaseVideoConsumer } from './video.consumer';
import { VideoService } from './video.service';

@Controller('video')
export class VideoController {
  constructor(private consumer: BaseVideoConsumer, private videoService: VideoService) { }

  @Post('pause')
  pauseWorker(): Promise<void> {
    return this.consumer.pauseWorker();
  }

  @Post('resume')
  resultWorker(): void {
    return this.consumer.resumeWorker();
  }

  @Post('close')
  closeWorker(): Promise<void> {
    return this.consumer.closeWorker();
  }

  @Get('transcoder-priority')
  getTranscoderPriority() {
    const priority = this.videoService.getTranscoderPriority();
    return { priority };
  }
}
