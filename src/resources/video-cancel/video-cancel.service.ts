import { Injectable } from '@nestjs/common';

import { OnPubSubMessage } from '../../common/modules/redis-pubsub';
import { VideoService } from '../video/video.service';

@Injectable()
export class VideoCancelService {
  constructor(private readonly videoService: VideoService) { }

  @OnPubSubMessage('video-cancel')
  onVideoCancelMessage(message: string) {
    const data = JSON.parse(message);
    this.videoService.addToCanceled(data);
  }
}
