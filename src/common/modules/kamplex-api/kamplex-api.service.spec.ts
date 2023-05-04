import { Test, TestingModule } from '@nestjs/testing';
import { KamplexApiService } from './kamplex-api.service';

describe('KamplexApiService', () => {
  let service: KamplexApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KamplexApiService],
    }).compile();

    service = module.get<KamplexApiService>(KamplexApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
