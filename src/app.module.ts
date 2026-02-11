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

@Module({
  imports: [ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: '.env'
  }),
    DatabaseModule, GuildsModule, ChannelsModule, RedisModule, InvitesModule, RolesModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule { }
