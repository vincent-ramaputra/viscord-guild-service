import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { join } from "path";
import { CHANNEL_QUEUE } from "./constants/events";
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.useGlobalFilters(new AllExceptionsFilter());
  
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: ['channels', 'guilds'],
      protoPath: [join(__dirname, 'proto/channels.proto'), join(__dirname, 'proto/guilds.proto')],
      url: `0.0.0.0:${process.env.GRPC_PORT}`
    }
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [`amqp://${process.env.RMQ_HOST}:${process.env.RMQ_PORT}`],
      queue: CHANNEL_QUEUE,
      queueOptions: {
        durable: true
      }
    }
  });

  await app.startAllMicroservices();
  await app.listen(3000);
}
bootstrap();
