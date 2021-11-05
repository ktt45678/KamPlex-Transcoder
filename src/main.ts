import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

import { PORT, ADDRESS } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true }));
  app.enableCors();
  const port = process.env.PORT || PORT;
  const address = process.env.ADDRESS || ADDRESS;
  await app.listen(port, address);
}
bootstrap();
