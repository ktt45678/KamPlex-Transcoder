import { Test, TestingModule } from '@nestjs/testing';
import { VideoCosumer } from './video.consumer';
import { VideoService } from './video.service';

describe('VideoCosumer', () => {
  let controller: VideoCosumer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VideoCosumer, VideoService],
    }).compile();

    controller = module.get<VideoCosumer>(VideoCosumer);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
