import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { firstValueFrom } from 'rxjs';
import { Logger } from 'winston';

import { fileExists, readAllLines } from '../../../utils';
import { BYPASS_PRODUCER_CHECK_FILE, PRODUCER_DOMAINS_FILE } from '../../../config';

@Injectable()
export class KamplexApiService {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger, private httpService: HttpService,
    private configService: ConfigService) { }

  async ensureProducerAppIsOnline(url: string, retries: number = 25, retryTimeout: number = 30000) {
    this.logger.info(`Pinging producer: ${url}`);
    let totalRetries = 0;
    while (totalRetries < retries) {
      const bypassCheckFileExist = await fileExists(BYPASS_PRODUCER_CHECK_FILE);
      if (bypassCheckFileExist) {
        this.logger.info('Bypass producer check file detected, skipping...');
        return true;
      }
      const isValidUrl = await this.isValidApiUrl(url);
      if (!isValidUrl) {
        totalRetries++;
        this.logger.warning(`Invalid producer url detected, retrying in ${retryTimeout}ms, retry: ${totalRetries}/${retries}`);
        continue;
      }
      try {
        const response = await firstValueFrom(this.httpService.get(url, {
          headers: { 'Content-Type': 'application/json' }
        }));
        this.logger.info(`GET ${url}: ${response.status}`);
        return true;
      } catch (e) {
        if (e.isAxiosError) {
          this.logger.error(`Failed to validate online status of the producer app, retrying in ${retryTimeout}ms`);
          await new Promise(r => setTimeout(r, retryTimeout));
        } else {
          this.logger.error(e);
          throw e;
        }
      }
    }
    return false;
  }

  private async isValidApiUrl(url: string) {
    const envApiDomains = (this.configService.get<string>('KAMPLEX_API_DOMAINS') || '').split(',');
    let urlData: URL;
    try {
      urlData = new URL(url);
    } catch {
      return false;
    }
    if (envApiDomains.includes(urlData.hostname)) {
      return true;
    }
    const fileApiDomains = await readAllLines(PRODUCER_DOMAINS_FILE);
    if (fileApiDomains.includes(urlData.hostname)) {
      return true;
    }
    return false;
  }
}
