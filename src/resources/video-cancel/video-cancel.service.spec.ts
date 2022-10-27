import { Test, TestingModule } from '@nestjs/testing';
import { VideoCancelService } from './video-cancel.service';

describe('VideoCancelService', () => {
  let service: VideoCancelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VideoCancelService],
    }).compile();

    service = module.get<VideoCancelService>(VideoCancelService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
