import { Controller, Post } from '@nestjs/common';

import { BaseVideoConsumer } from './video.consumer';

@Controller('video')
export class VideoController {
  constructor(private consumer: BaseVideoConsumer) { }

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
}
