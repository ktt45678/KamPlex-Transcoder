import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { AppModule } from './app.module';
import { PORT, ADDRESS } from './config';
import { applyBigIntPatches } from './utils';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true }));
  app.enableCors();
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  const port = process.env.PORT || PORT;
  const address = process.env.ADDRESS || ADDRESS;
  await app.listen(port, address);
}

applyBigIntPatches();
bootstrap();
