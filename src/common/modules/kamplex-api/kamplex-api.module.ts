import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { KamplexApiService } from './kamplex-api.service';

@Module({
  imports: [HttpModule],
  providers: [KamplexApiService],
  exports: [KamplexApiService]
})
export class KamplexApiModule { }
