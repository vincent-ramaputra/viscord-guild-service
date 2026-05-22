import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GuildsModule } from './guilds/guilds.module';
import { ChannelsModule } from './channels/channels.module';
import { DatabaseModule } from "./database/database.module";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { join } from "path";
import { RedisModule } from './redis/redis.module';
import { InvitesModule } from './invites/invites.module';
import { RolesModule } from './roles/roles.module';
import { HealthController } from './health/health.controller';
import { LoggerModule } from 'nestjs-pino';
import { ServerResponse } from 'http';
import { IncomingMessage } from 'http';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env'
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV == 'production' ? 'info' : 'debug',
        formatters: {
          level: (label: string) => ({ level: label })
        },
        redact: [
          'req.headers.cookie',
          'req.headers.authorization',
          'res.headers["set-cookie"]',
        ],
        serializers: {
          req(req: IncomingMessage & { id: number }) {
            return {
              id: req.id,
              method: req.method,
              url: req.url,
              'x-forwarded-uri': req.headers['x-forwarded-uri']
            }
          },
          res(res: ServerResponse) {
            return {
              statusCode: res.statusCode
            };
          }
        }
      }
    }),
    DatabaseModule, GuildsModule, ChannelsModule, RedisModule, InvitesModule, RolesModule
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule { }
