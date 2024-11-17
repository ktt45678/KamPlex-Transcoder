import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { TranscoderApiService } from './transcoder-api.service';

@Module({
  imports: [HttpModule],
  providers: [TranscoderApiService],
  exports: [TranscoderApiService]
})
export class TranscoderApiModule { }
