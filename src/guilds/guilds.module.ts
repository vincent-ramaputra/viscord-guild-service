import { forwardRef, Module } from '@nestjs/common';
import { GuildsService } from './guilds.service';
import { GuildsController } from './guilds.controller';
import { TypeOrmModule } from "@nestjs/typeorm";
import { Guild } from "./entities/guild.entity";
import { GuildMember } from "./entities/guild-members.entity";
import { StorageModule } from "src/storage/storage.module";
import { ChannelsModule } from "src/channels/channels.module";
import { HttpModule } from "@nestjs/axios";
import { GrpcClientModule } from "src/grpc-client/grpc-client.module";
import { UserChannelState } from "src/channels/entities/user-channel-state.entity";
import { Role } from "src/roles/entities/role.entity";
import { InvitesModule } from "src/invites/invites.module";
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { GATEWAY_QUEUE } from 'src/constants/events';

@Module({
  controllers: [GuildsController],
  providers: [GuildsService],
  imports: [
    TypeOrmModule.forFeature([Guild, GuildMember, Role]),
    StorageModule,
    ChannelsModule,
    HttpModule,
    GrpcClientModule,
    InvitesModule,
    ClientsModule.registerAsync({
      clients: [
        {
          name: 'GATEWAY_MQ',
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => {
            return {
              transport: Transport.RMQ,
              options: {
                urls: [
                  `amqp://${configService.get('RMQ_HOST')}:${configService.get('RMQ_PORT')}`,
                ],
                queue: GATEWAY_QUEUE,
                queueOptions: { durable: true },
                persistent: true,
              },
            };
          },
        },
      ],
    }),
  ],
  exports: [GuildsService]
})

export class GuildsModule { }
