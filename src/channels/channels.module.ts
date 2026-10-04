import { forwardRef, Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { GuildChannelsController, DMChannelsController, ChannelsController } from './channels.controller';
import { HttpModule } from "@nestjs/axios";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Channel } from "./entities/channel.entity";
import { ChannelRecipient } from "./entities/channel-recipient.entity";
import { UserChannelState } from "./entities/user-channel-state.entity";
import { RedisModule } from "src/redis/redis.module";
import { Guild } from "src/guilds/entities/guild.entity";
import { GrpcClientModule } from "src/grpc-client/grpc-client.module";
import { InvitesModule } from "src/invites/invites.module";
import { Role } from "src/roles/entities/role.entity";
import { GuildsModule } from "src/guilds/guilds.module";
import { PermissionOverwrite } from "./entities/permission-overwrite.entity";
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { GATEWAY_QUEUE } from 'src/constants/events';
import { VoiceTicketService } from './voice-ticket.service';
import { SfuEventConsumer } from './sfu-event.consumer';

@Module({
  controllers: [GuildChannelsController, DMChannelsController, ChannelsController],
  providers: [ChannelsService, VoiceTicketService, SfuEventConsumer],
  imports: [
    HttpModule,
    RedisModule,
    TypeOrmModule.forFeature([Channel, ChannelRecipient, UserChannelState, Guild, Role, PermissionOverwrite]), GrpcClientModule, InvitesModule, forwardRef(() => GuildsModule),
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

  exports: [ChannelsService]
})
export class ChannelsModule { }
