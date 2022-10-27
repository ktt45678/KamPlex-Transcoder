import { Test, TestingModule } from '@nestjs/testing';
import { VideoCancelConsumer } from './video-cancel.consumer';
import { VideoCancelService } from './video-cancel.service';

describe('VideoCancelConsumer', () => {
  let controller: VideoCancelConsumer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideoCancelConsumer],
      providers: [VideoCancelService],
    }).compile();

    controller = module.get<VideoCancelConsumer>(VideoCancelConsumer);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
