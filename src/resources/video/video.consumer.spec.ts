import { Test, TestingModule } from '@nestjs/testing';
import { VideoCosumerH264 } from './video.consumer';
import { VideoService } from './video.service';

describe('VideoCosumer', () => {
  let controller: VideoCosumerH264;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VideoCosumerH264, VideoService],
    }).compile();

    controller = module.get<VideoCosumerH264>(VideoCosumerH264);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
