import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { firstValueFrom } from 'rxjs';
import { Logger } from 'winston';

@Injectable()
export class TranscoderApiService {
  apiUrl: string;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private httpService: HttpService,
    private configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('PRIMARY_TRANSCODER_URL') || '';
  }

  async checkAndWaitForTranscoderPriority(checkTimeout: number = 10000) {
    if (!this.apiUrl) return;
    let priority = 0;
    let messageShowed = false;
    let errorCount = 0;
    while (true) {
      try {
        const response = await this.getTranscoderPriority();
        priority = response.data.priority;
        if (priority > 0) {
          if (!messageShowed) {
            this.logger.info('Another transcoder is in progress, waiting for completion...');
            messageShowed = true;
          }
          await new Promise(r => setTimeout(r, checkTimeout));
        } else {
          break;
        }
      } catch (e) {
        if (e.isAxiosError && e.response) {
          this.logger.error(`Received ${e.response.status} ${e.response.statusText} error from api`)
        } else {
          this.logger.error(`API error: ${e.message}`);
        }
        if (errorCount > 30)
          break;
        errorCount++;
        await new Promise(r => setTimeout(r, checkTimeout));
      }
    }
  }

  getTranscoderPriority() {
    return firstValueFrom(this.httpService.get<{ priority: number }>(`${this.apiUrl}/video/transcoder-priority`));
  }
}
