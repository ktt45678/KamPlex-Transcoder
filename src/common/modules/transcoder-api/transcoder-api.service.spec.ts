import { Test, TestingModule } from '@nestjs/testing';
import { TranscoderApiService } from './transcoder-api.service';

describe('TranscoderApiService', () => {
  let service: TranscoderApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TranscoderApiService],
    }).compile();

    service = module.get<TranscoderApiService>(TranscoderApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
