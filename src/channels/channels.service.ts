import { BadRequestException, ForbiddenException, forwardRef, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { CreateChannelDTO } from './dto/create-channel.dto';
import { CreateDMChannelDTO } from "./dto/create-dm-channel.dto";
import { Result } from "src/interfaces/result.interface";
import { ChannelResponseDTO } from "./dto/channel-response.dto";
import { firstValueFrom } from "rxjs";
import { In, Repository } from "typeorm";
import { Channel } from "./entities/channel.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { ChannelRecipient } from "./entities/channel-recipient.entity";
import { toChannelEntityFromCreateDMDTO, toChannelEntityFromCreateDTO, toChannelResponseDTO, toPermissionOverwriteResponseDTO, toUserChannelStateResponseDTO } from "src/mappings/mappers";
import { ChannelType } from "./enums/channel-type.enum";
import { UserProfileResponseDTO } from "src/user-profiles/dto/user-profile-response.dto";
import { ClientGrpc, ClientProxy, RpcException } from "@nestjs/microservices";
import { GET_VOICE_RINGS_EVENT, GET_VOICE_STATES_EVENT, GUILD_UPDATE_EVENT, MESSAGE_RECEIVED_EVENT, PRODUCER_CREATED, USER_TYPING_EVENT, VOICE_RING_DISMISS_EVENT, VOICE_RING_EVENT, VOICE_UPDATE_EVENT } from "src/constants/events";
import { Payload } from "src/interfaces/payload.dto";
import { UserTypingDTO } from "src/channels/dto/user-typing.dto";
import { UserChannelState } from "./entities/user-channel-state.entity";
import { AcknowledgeMessageDTO } from "./dto/acknowledge-message.dto";
import { VoiceEventDTO } from "./dto/voice-event.dto";
import { RedisService } from "src/redis/redis.service";
import { VoiceState } from "./entities/voice-state";
import { VoiceEventType } from "./enums/voice-event-type";
import { VoiceStateDTO } from "./dto/voice-state.dto";
import { VoiceRingState } from "./entities/voice-ring-state";
import { VOICE_GRACE_MS, VOICE_RING_TIMEOUT } from "src/constants/time";
import { VoiceRingStateDTO } from "./dto/voice-ring-state.dto";
import { Guild } from "src/guilds/entities/guild.entity";
import { UserProfilesService } from "src/user-profiles/grpc/user-profiles.service";
import { InviteResponseDTO } from "src/invites/dto/invite-response.dto";
import { InvitesService } from "src/invites/invites.service";
import { UpdateChannelDTO } from "./dto/update-channel.dto";
import { UserChannelStateResponseDTO } from "./dto/user-channel-state-response.dto";
import { MessagesService } from "src/messages/messages.service";
import { GuildUpdateDTO } from "src/guilds/dto/guild-update.dto";
import { GuildUpdateType } from "src/guilds/enums/guild-update-type.enum";
import { PermissionOverwrite } from "./entities/permission-overwrite.entity";
import { PermissionOverwriteResponseDTO } from "./dto/permission-overwrite-response.dto";
import { GuildsService } from "src/guilds/guilds.service";
import { allowPermission, applyChannelOverwrites, denyPermission, hasPermission, toBit } from "./helpers/permission.helper";
import { PermissionOverwriteTargetType } from "./enums/permission-overwrite-target-type.enum";
import { Permissions } from "../guilds/enums/permissions.enum";
import { UpdateChannelPermissionOverwriteDTO } from "./dto/update-channel-permission.dto";
import { GuildMember } from "src/guilds/entities/guild-members.entity";
import { MessageResponseDTO } from "src/messages/dto/message-response.dto";
import { CanUserDeleteMessageRequest } from "./dto/can-user-delete-message.dto";
import { CanUserDeleteMessageResponse } from "./dto/can-user-delete-message.response.dto";
import { CheckPermissionResponseDTO } from "src/channels/dto/check-permission-response.dto";
import { CheckPermissionDTO } from "./dto/check-permission.dto";
import { CreateVoiceTicketResponseDTO } from './dto/create-voice-ticket-response.dto';
import { VoiceTicketService } from './voice-ticket.service';
import { ConfigService } from '@nestjs/config';
import { PeerJoinedEventDTO } from './dto/peer-joined-event.dto';
import { PEER_JOINED_SCRIPT } from './redis-scripts/peer-joined.script';
import { PeerLeftEventDTO } from './dto/peer-left-event.dto';
import { PEER_LEFT_SCRIPT } from './redis-scripts/peer-left.script';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);
  private usersService: UserProfilesService;
  private messagesService: MessagesService;
  private readonly sfuPublicUrl: string;

  constructor(
    private readonly redisService: RedisService,
    private readonly voiceTicketService: VoiceTicketService,
    private readonly config: ConfigService,
    @InjectRepository(Guild) private readonly guildsRepository: Repository<Guild>,
    @InjectRepository(Channel) private readonly channelsRepository: Repository<Channel>,
    @InjectRepository(ChannelRecipient) private readonly channelRecipientsRepository: Repository<ChannelRecipient>,
    @InjectRepository(UserChannelState) private readonly userChannelStatesRepository: Repository<UserChannelState>,
    @InjectRepository(PermissionOverwrite) private readonly permissionOverwritesRepository: Repository<PermissionOverwrite>,
    @Inject(forwardRef(() => InvitesService)) private readonly invitesService: InvitesService,
    @Inject(forwardRef(() => GuildsService)) private readonly guildsService: GuildsService,
    @Inject('USERS_SERVICE') private usersGRPCClient: ClientGrpc,
    @Inject('MESSAGES_SERVICE') private messagesGRPCClient: ClientGrpc,
    @Inject('GATEWAY_MQ') private readonly gatewayMQ: ClientProxy
  ) {
    this.sfuPublicUrl = this.config.getOrThrow<string>('SFU_PUBLIC_URL');
  }

  async create(userId: string, dto: CreateChannelDTO): Promise<Result<ChannelResponseDTO>> {
    if (!dto.guildId || dto.guildId.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Invalid guild id'
      };
    }

    const guild = await this.guildsRepository.findOne({ where: { id: dto.guildId }, relations: ['members'] });
    const effectivePermission = await (dto.parentId ? this.getEffectivePermission({ userId, channelId: dto.parentId, guildId: dto.guildId }) : this.guildsService.getBasePermission(userId, dto.guildId));

    if ((effectivePermission & Permissions.MANAGE_CHANNELS) !== Permissions.MANAGE_CHANNELS) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User is not permitted to manage channel'
      };
    }

    if (dto.name.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Must be between 1 and 100 in length. Channel name cannot be ""'
      };
    }

    const channelToSave = toChannelEntityFromCreateDTO(dto);
    channelToSave.ownerId = userId;
    if (!dto.parentId) {
      channelToSave.isSynced = false;
      channelToSave.parentId = null;
      channelToSave.permissionOverwrites = [
        {
          targetId: guild.id,
          targetType: PermissionOverwriteTargetType.ROLE,
          allow: 0n,
          deny: 0n
        } as PermissionOverwrite
      ];
    } else if (dto.isPrivate) {
      channelToSave.isSynced = false;
      channelToSave.permissionOverwrites = [
        {
          targetId: guild.id,
          targetType: PermissionOverwriteTargetType.ROLE,
          allow: 0n,
          deny: Permissions.VIEW_CHANNELS
        } as PermissionOverwrite
      ];
    } else {
      channelToSave.isSynced = true;
    }

    try {
      await this.channelsRepository.save(channelToSave);
      if (channelToSave.permissionOverwrites) {
        channelToSave.permissionOverwrites = channelToSave.permissionOverwrites.map(ow => {
          ow.channelId = channelToSave.id;
          return ow;
        });
        await this.permissionOverwritesRepository.save(channelToSave.permissionOverwrites);
      }
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An unknown error occurred when creating channel'
      };
    }

    const channelWithRelations = await this.channelsRepository.findOne({
      where: { id: channelToSave.id },
      relations: ['parent', 'permissionOverwrites'],
    });

    const payload = toChannelResponseDTO(channelWithRelations);

    const recipientResponse = await firstValueFrom(this.usersService.getUserProfiles({ userIds: guild.members.map(m => m.userId) }));
    if (recipientResponse.status === HttpStatus.OK) {
      payload.recipients = recipientResponse.data;
    }

    payload.permissionOverwrites = channelWithRelations.permissionOverwrites.map(toPermissionOverwriteResponseDTO);

    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, { recipients: guild.members.map(g => g.userId).filter(id => id !== userId), data: { guildId: guild.id, type: GuildUpdateType.CHANNEL_UPDATE, data: payload } } as Payload<GuildUpdateDTO>);
    } catch (error) {
      this.logger.error('Failed emitting channel create update');
    }
    return {
      status: HttpStatus.CREATED,
      data: payload,
      message: 'Channel created successfully'
    };
  }

  async delete(userId: string, channelId: string): Promise<Result<null>> {
    if (!userId || !channelId) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: "Channel id is empty"
      };
    }

    const channel = await this.channelsRepository.findOne({ where: { id: channelId }, relations: ['recipients'] })

    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: "Channel does not exist"
      };
    }

    const guild = await this.guildsRepository.findOne({ where: { id: channel.guildId }, relations: ['members'] });
    const effectivePermission = await this.getEffectivePermission({ userId, channelId: channel.isSynced ? channel.parentId : channel.id, guildId: channel.guildId });

    if ((effectivePermission & Permissions.MANAGE_CHANNELS) !== Permissions.MANAGE_CHANNELS) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User is not permitted to manage channel'
      };
    }

    try {
      await this.channelsRepository.delete({ id: channel.id });
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: "An error occurred while deleting channel"
      };
    }

    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients: guild.members.map(g => g.userId).filter(id => id !== userId),
        data: {
          guildId: guild.id,
          type: GuildUpdateType.CHANNEL_DELETE,
          data: channelId
        }
      } as Payload<GuildUpdateDTO>);
    } catch (error) {
      this.logger.error('Failed emitting channel delete update');
    }

    return {
      status: HttpStatus.NO_CONTENT,
      data: null,
      message: "Channel deleted successfully"
    };
  }

  async createDMChannel(userId: string, dto: CreateDMChannelDTO): Promise<Result<ChannelResponseDTO>> {
    if (!dto.recipientId || dto.recipientId.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: "Recipient is empty"
      };
    }

    let existingChannel = await this.channelsRepository
      .createQueryBuilder('channel')
      .innerJoin('channel.recipients', 'channel_recipient')
      .where('channel_recipient.user_id IN (:...recipients) AND channel.type = :channelType', { recipients: [userId, dto.recipientId], channelType: ChannelType.DM })
      .having('COUNT(DISTINCT channel_recipient.user_id) = 2')
      .groupBy('channel.id')
      .select('channel.id').getOne();

    if (existingChannel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: "Channel already exists"
      }
    }


    let recipientResponse: Result<UserProfileResponseDTO[]>;

    try {
      recipientResponse = await firstValueFrom(this.usersService.getUserProfiles({ userIds: [dto.recipientId] }));
      if (recipientResponse.status !== HttpStatus.OK) {
        return {
          status: HttpStatus.BAD_REQUEST,
          data: null,
          message: "Failed retrieving recipient data"
        };
      }
    } catch (error) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: "Failed retrieving recipient data"
      };
    }

    const channel = toChannelEntityFromCreateDMDTO(dto);
    channel.type = ChannelType.DM;
    channel.ownerId = userId;

    try {
      await this.channelsRepository.save(channel);
      const recipients: ChannelRecipient[] = [{ channelId: channel.id, userId: userId }, { channelId: channel.id, userId: dto.recipientId }];
      await this.channelRecipientsRepository.save(recipients);

      channel.recipients = recipients;
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: "Failed saving channel data"
      };
    }

    const responseDTO = toChannelResponseDTO(channel);
    responseDTO.recipients = [recipientResponse.data[0]];

    return {
      status: HttpStatus.CREATED,
      data: responseDTO,
      message: ""
    };
  }

  async getDMChannels(userId: string): Promise<Result<ChannelResponseDTO[]>> {
    let channels: Channel[] = [];

    try {
      channels = await this.channelsRepository
        .createQueryBuilder('channel')
        .innerJoin('channel.recipients', 'channel_recipient')
        .where('channel_recipient.user_id = :userId AND channel.type = :channelType', { userId: userId, channelType: ChannelType.DM })
        .select('channel').getMany();
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: "Failed retrieving DMs"
      };
    }

    const dto: ChannelResponseDTO[] = channels.map(toChannelResponseDTO);
    for (const channel of dto) {
      const recipients = await this.channelRecipientsRepository.findBy({ channelId: channel.id });
      const userChannelStateResponse = await this.getUserChannelState(userId, channel.id);
      channel.userChannelState = userChannelStateResponse.data;

      channel.recipients = await Promise.all(recipients.filter(re => re.userId !== userId).map(async r => {
        const response = await this.getRecipientDetail(r.userId);
        if (response.status !== HttpStatus.OK) {
          return undefined;
        }
        return response.data!;
      }));
    }

    return {
      status: HttpStatus.OK,
      data: dto,
      message: 'DM Channels retrieved successfully'
    };
  }

  async getGuildChannels(guildId: string): Promise<Result<ChannelResponseDTO[]>> {
    if (!guildId || guildId.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Invalid guild id'
      };
    }

    const channels = await this.channelsRepository
      .createQueryBuilder('channel')
      .leftJoinAndSelect('channel.parent', 'channel')
      .where('channel.guildId = :guildId', { guildId: guildId })
      .getMany();

    const data = channels.map(toChannelResponseDTO);

    return {
      status: HttpStatus.OK,
      data: data,
      message: 'Channels retrieved successfully'
    };
  }

  async getChannelByIdWithAuth(userId: string, channelId: string): Promise<Result<ChannelResponseDTO>> {
    if (!channelId || channelId.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Invalid channel id'
      };
    }

    const channel = await this.channelsRepository
      .createQueryBuilder('channel')
      .leftJoinAndSelect('channel.recipients', 'recipients')
      .where('channel.id = :channelId', { channelId: channelId })
      .getOne();

    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel not found'
      };
    }

    if (!channel.recipients.find(r => r.userId === userId)) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User is not part of this channel'
      };
    }

    const data = toChannelResponseDTO(channel);
    data.recipients = await Promise.all(channel.recipients.filter(re => re.userId !== userId).map(async r => (await this.getRecipientDetail(r.userId)).data));

    return {
      status: HttpStatus.OK,
      data: data,
      message: 'Channel retrieved successfully'
    };
  }

  async getChannelRecipients(channelId: string): Promise<string[]> {
    const channel = await this.channelsRepository.findOne({ where: { id: channelId }, relations: ['recipients'] });

    if (!channel) return [];
    if (channel.type === ChannelType.DM) {
      return channel.recipients.map(r => r.userId);
    }

    const guild = await this.guildsRepository
      .createQueryBuilder('guild')
      .leftJoinAndSelect('guild.channels', 'channel')
      .leftJoinAndSelect('guild.members', 'member')
      .where('channel.id = :channelId', { channelId })
      .getOne();

    if (!guild) return [];

    const members = guild.members.map(m => m.userId);
    //TODO permission based filter

    return members;
  }

  async isUserChannelParticipant(userId: string, channelId: string): Promise<Result<any>> {
    const channelRecipients = await this.getChannelRecipients(channelId);

    if (!channelRecipients.includes(userId)) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User is not a recipient of this channel'
      };
    }

    return {
      status: HttpStatus.OK,
      data: null,
      message: null
    };
  }

  async getChannelById(userId: string, channelId: string) {
    if (!channelId || channelId.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Invalid channel id'
      };
    }

    const channel = await this.channelsRepository.findOneBy({ id: channelId })
    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel not found'
      };
    }

    const data = toChannelResponseDTO(channel);

    if (channel.type === ChannelType.DM) {
      const channelRecipients = await this.getChannelRecipients(channelId);
      data.recipients = await Promise.all(channelRecipients.map(async userId => (await this.getRecipientDetail(userId)).data));
    }
    else {
      const members = (await this.guildsRepository.findOne({ where: { id: channel.guildId }, relations: ['members'] })).members;
      if (!members.find(m => m.userId === userId)) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: null,
          message: 'User is not a member of this guild'
        };
      }
    }

    return {
      status: HttpStatus.OK,
      data: data,
      message: 'Channel retrieved successfully'
    };

  }

  private async getRecipientDetail(userId: string): Promise<Result<UserProfileResponseDTO>> {
    let recipientResponse: Result<UserProfileResponseDTO[]>;
    try {
      recipientResponse = (await firstValueFrom(this.usersService.getUserProfiles({ userIds: [userId] })));
      if (recipientResponse.status !== HttpStatus.OK) {
        return {
          status: HttpStatus.BAD_REQUEST,
          data: null,
          message: 'Failed retrieving recipient data'
        };
      }
    } catch (error) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Failed retrieving recipient data'
      };
    }

    return {
      status: HttpStatus.OK,
      data: recipientResponse.data[0],
      message: 'Recipient data retrieved successfully'
    }
  }

  async broadcastUserTyping(userId: string, channelId: string): Promise<Result<null>> {
    const channel = await this.channelsRepository.findOne({ where: { id: channelId }, relations: ['recipients'] });

    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel not found'
      };
    }

    let recipients: string[] = [];

    if (channel.type === ChannelType.DM) {
      if (!channel.recipients!.find(r => r.userId === userId)) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: null,
          message: 'User is not a recipient of this channel'
        };
      }
      recipients = channel.recipients.filter(r => r.userId !== userId).map(r => r.userId);
    }
    else {
      const members = await this.guildsService.getMembersWithPermissions(channel.guildId, Permissions.VIEW_CHANNELS);

      if (!members.find(m => m.userId === userId)) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: null,
          message: 'User is not a recipient of this channel'
        };
      }

      recipients = members.map(m => m.userId).filter(id => id !== userId);
    }

    const dto: UserTypingDTO = {
      userId: userId,
      channelId: channelId
    };
    try {
      this.gatewayMQ.emit(USER_TYPING_EVENT, { recipients: recipients, data: dto } as Payload<UserTypingDTO>)
    } catch (error) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while broadcasting typing status'
      };
    }

    return {
      status: HttpStatus.NO_CONTENT,
      data: null,
      message: ''
    };
  }

  async acknowledgeMessage(dto: AcknowledgeMessageDTO): Promise<Result<null>> {
    const channel = await this.channelsRepository.findOneBy({ id: dto.channelId });

    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel does not exist'
      }
    }

    const effectivePermission = await this.getEffectivePermission({ userId: dto.userId, channelId: dto.channelId, guildId: channel.guildId });

    if (channel.guildId && !((effectivePermission & Permissions.VIEW_CHANNELS) === Permissions.VIEW_CHANNELS)) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User does not have permission to read message'
      };
    }

    let userReadState = await this.userChannelStatesRepository.findOne({ where: { userId: dto.userId, channelId: dto.channelId } })

    if (!userReadState) {
      userReadState = this.userChannelStatesRepository.create()
      userReadState.channelId = dto.channelId;
      userReadState.userId = dto.userId;
    }
    userReadState.lastReadId = dto.messageId;

    try {
      await this.userChannelStatesRepository.save(userReadState);
    } catch (error) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while updating last seen message'
      };
    }
    const redisClient = await this.redisService.getClient();
    const key = this.getUserChannelUnreadCountKey(dto.userId, dto.channelId);
    redisClient.set(key, 0);


    return {
      status: HttpStatus.NO_CONTENT,
      message: 'Last seen message updated successfully',
      data: null
    };
  }

  async ringChannelRecipients(userId: string, channelId: string): Promise<Result<null>> {
    const channel = await this.channelsRepository
      .createQueryBuilder('channel')
      .innerJoinAndSelect('channel.recipients', 'channel_recipient')
      .where('channel.id = :channelId', { channelId })
      .getOne();

    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel not found'
      };
    }

    const isMember = channel.recipients.some(r => r.userId === userId);
    if (!isMember && channel.type !== ChannelType.DM) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'You are not a member of this channel'
      };
    }

    const recipients = channel.recipients
      .map(r => r.userId);

    if (recipients.length === 0) {
      return {
        status: HttpStatus.NO_CONTENT,
        data: null,
        message: 'No other recipients to ring'
      };
    }

    const client = await this.redisService.getClient();
    const pipeline = client.multi();

    const ringPayloads: VoiceRingState[] = recipients.filter(uid => uid !== userId).map(recipientId => ({
      initiatorId: userId,
      channelId,
      recipientId,
    }));

    for (const dto of ringPayloads) {
      pipeline.set(this.getVoiceRingKey(dto.channelId, dto.recipientId), JSON.stringify(dto));
      pipeline.sAdd(this.getVoiceRingChannelkey(dto.channelId), dto.recipientId);
      setTimeout(() => {
        this.handleDismissVoiceRing(dto.recipientId, dto.channelId);
      }, VOICE_RING_TIMEOUT);
    }

    try {
      await pipeline.exec();
    } catch (error) {
      this.logger.error({ error }, 'Redis ring state error');
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'Failed to set ring state in Redis'
      };
    }

    try {
      this.gatewayMQ.emit(
        VOICE_RING_EVENT,
        { recipients, data: ringPayloads } as Payload<VoiceRingStateDTO[]>
      );
    } catch (error) {
      this.logger.error({ error }, 'Emit ring event failed');
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'Failed to emit ring event'
      };
    }

    return {
      status: HttpStatus.NO_CONTENT,
      data: null,
      message: 'Ringing sent successfully'
    };
  }

  async handleDismissVoiceRing(userId: string, channelId: string) {
    const client = await this.redisService.getClient();
    const key = this.getVoiceRingKey(channelId, userId);
    let voiceRingState: VoiceRingState;
    try {
      const raw = await client.get(key);
      if (!raw) {
        return {
          status: HttpStatus.NOT_FOUND,
          data: null,
          message: 'No active voice ring found for this user and channel.'
        };
      }

      voiceRingState = JSON.parse(raw as string) as VoiceRingState;
      if (!voiceRingState) throw new Error();

      await client.del(key);
      await client.sRem(this.getVoiceRingChannelkey(channelId), userId);
    } catch (error) {
      this.logger.error({ error }, 'Redis ring state error');
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'Failed to delete ring state in Redis'
      };
    }

    try {
      this.gatewayMQ.emit(
        VOICE_RING_DISMISS_EVENT,
        { recipients: [voiceRingState.initiatorId, voiceRingState.recipientId], data: voiceRingState } as Payload<VoiceRingStateDTO>
      );
    } catch (error) {
      this.logger.error({ error }, 'Emit ring event failed');
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'Failed to emit ring event'
      };
    }

    return {
      status: HttpStatus.NO_CONTENT,
      data: null,
      message: 'Ringing dismissed successfully'
    };
  }

  async createVoiceTicket(userId: string, channelId: string): Promise<Result<CreateVoiceTicketResponseDTO>> {
    if (!userId || userId.length === 0) {
      return {
        status: HttpStatus.UNAUTHORIZED,
        message: "Unauthorized",
        data: null
      };
    }

    if (!channelId || channelId.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: "Invalid channel ID",
        data: null
      };
    }

    const channel: Channel = await this.channelsRepository.findOneBy({ id: channelId });
    if (!channel) {
      return {
        status: HttpStatus.NOT_FOUND,
        data: null,
        message: 'Channel not found'
      };
    }

    const recipients = await this.getChannelRecipients(channelId);
    if (!recipients.find(id => id === userId)) {
      return {
        status: HttpStatus.NOT_FOUND,
        data: null,
        message: 'Channel not found'
      };
    }

    if (channel.type !== ChannelType.Voice && channel.type !== ChannelType.DM) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Not a voice channel',
        data: null
      };
    }
    if (channel.guildId) {
      const effective = await this.getEffectivePermission({ userId, guildId: channel.guildId, channelId });
      if (!hasPermission(effective, Permissions.VIEW_CHANNELS)) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: null,
          message: 'You dont have the permission to join this voice channel'
        };
      }
    }

    try {
      const ticket = await this.voiceTicketService.sign(userId, channelId);
      return {
        status: HttpStatus.OK,
        message: 'Voice ticket created successfully',
        data: {
          ticket,
          sfuUrl: this.sfuPublicUrl
        }
      };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed creating voice ticket');
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'An unknown error occurred while creating voice ticket',
        data: null
      };
    }
  }

  async handleGetVoiceStates(userId: string) {
    const channels = await this.channelsRepository
      .createQueryBuilder('channel')
      .innerJoinAndSelect('channel.recipients', 'channel_recipient')
      .where('channel_recipient.user_id = :userId', { userId: userId }).getMany();

    const client = await this.redisService.getClient();

    const voiceStates = [];
    for (const channel of channels) {
      const participants = await client.sMembers(this.getVoiceChannelKey(channel.id));
      if (participants.length === 0) continue;
      const rawStates = await client.mGet(participants.map(uid => this.getVoiceStateKey(channel.id, uid)));
      const states = rawStates.filter((v): v is string => v !== null).map(s => JSON.parse(s));
      voiceStates.push(...states);
    }

    this.gatewayMQ.emit(GET_VOICE_STATES_EVENT, { recipients: [userId], data: voiceStates } as Payload<VoiceStateDTO[]>)
  }

  async handleGetVoiceRings(userId: string) {
    const channels = await this.channelsRepository
      .createQueryBuilder('channel')
      .innerJoinAndSelect('channel.recipients', 'channel_recipient')
      .where('channel_recipient.user_id = :userId', { userId: userId }).getMany();

    const client = await this.redisService.getClient();

    const voiceRings = [];
    for (const channel of channels) {
      const recipients = await client.sMembers(this.getVoiceRingChannelkey(channel.id));
      if (recipients.length === 0) continue;

      const rawStates = await client.mGet(recipients.map(uid => this.getVoiceRingKey(channel.id, uid)));
      const states = rawStates.filter((v): v is string => v !== null).map(s => JSON.parse(s));
      voiceRings.push(...states);
    }

    this.gatewayMQ.emit(GET_VOICE_RINGS_EVENT, { recipients: [userId], data: voiceRings } as Payload<VoiceRingStateDTO[]>)
  }

  private async clearChannelVoiceRings(channelId: string) {
    const client = await this.redisService.getClient();

    const recipients = await client.sMembers(this.getVoiceRingChannelkey(channelId));
    try {
      for (const recipient of recipients) {
        const rawState = await client.get(this.getVoiceRingKey(channelId, recipient));
        if (rawState) {
          const state: VoiceRingState = JSON.parse(rawState as string);
          this.gatewayMQ.emit(VOICE_RING_DISMISS_EVENT, { recipients: [state.recipientId, state.initiatorId], data: state } as Payload<VoiceRingStateDTO>)
        }
      }
      await client.del(this.getVoiceRingChannelkey(channelId));
    } catch (error) {
      this.logger.error(error);
    }
  }

  async handleVoiceStateUpdate(dto: VoiceEventDTO) {
    const client = await this.redisService.getClient();
    const key = this.getVoiceStateKey(dto.channelId, dto.userId);
    const rawState = await client.get(key);
    if (typeof (rawState) !== 'string') return;
    const oldState: VoiceState = JSON.parse(rawState);
    const newState: VoiceState = {
      ...oldState,
      ...dto.data
    };

    await client.set(key, JSON.stringify(newState));

    let channel = await this.channelsRepository
      .createQueryBuilder('channel')
      .innerJoinAndSelect('channel.recipients', 'channel_recipient')
      .where('channel.id = :channelId', { channelId: dto.channelId })
      .getOne();
    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel not found'
      };
    }

    if (!channel.recipients.find(r => r.userId === dto.userId)) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'Channel not found'
      };
    }
    const recipients = channel.recipients.map(r => r.userId);

    const payload: VoiceEventDTO = {
      channelId: dto.channelId,
      userId: dto.userId,
      type: VoiceEventType.STATE_UPDATE,
      data: newState
    }

    this.gatewayMQ.emit(VOICE_UPDATE_EVENT, { recipients: recipients, data: payload } as Payload<VoiceEventDTO>)
  }

  // async createOrGetInvite(dto: CreateInviteDto): Promise<Result<InviteResponseDTO>> {
  //   if (!dto.guildId) {
  //     return {
  //       status: HttpStatus.BAD_REQUEST,
  //       data: null,
  //       message: 'Guild ID cannot be empty'
  //     }
  //   }
  //   const channel = await this.channelsRepository.findOne({ where: { id: dto.channelId }, relations: ['recipients'] });

  //   if (!channel) {
  //     return {
  //       status: HttpStatus.BAD_REQUEST,
  //       data: null,
  //       message: 'Channel not found'
  //     }
  //   }

  //   if (channel.type === ChannelType.DM) {
  //     return {
  //       status: HttpStatus.NOT_IMPLEMENTED,
  //       data: null,
  //       message: 'This feature has not been implemented for DM channels'
  //     }
  //   }

  //   const guild = await this.guildsRepository.findOneBy({ id: channel.guildId });
  //   if (!guild) {
  //     return {
  //       status: HttpStatus.BAD_REQUEST,
  //       data: null,
  //       message: 'Guild not found'
  //     }
  //   }
  //   if (dto.channelId && (!channel || (channel.type !== ChannelType.Voice && channel.type !== ChannelType.Text))) {
  //     return {
  //       status: HttpStatus.BAD_REQUEST,
  //       data: null,
  //       message: 'Channel not found'
  //     }
  //   }

  //   const effectivePermission = await this.getEffectivePermission
  //   if (guild.ownerId !== dto.inviterId) {
  //     return {
  //       status: HttpStatus.FORBIDDEN,
  //       data: null,
  //       message: 'Only guild owner is allowed to perform this action'
  //     }
  //   }

  //   const recipients = await this.getChannelRecipients(dto.channelId);
  //   if (!recipients.includes(dto.inviterId)) {
  //     return {
  //       status: HttpStatus.FORBIDDEN,
  //       data: null,
  //       message: 'User is not channel recipient'
  //     }
  //   }

  //   const inviteResponse = await this.invitesService.create(dto);

  //   return inviteResponse;
  // }

  async getChannelInvites(userId: string, channelId: string): Promise<Result<InviteResponseDTO[]>> {
    const channel = await this.channelsRepository.findOne({ where: { id: channelId } });

    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel not found'
      }
    }

    if (channel.type === ChannelType.DM) {
      return {
        status: HttpStatus.NOT_IMPLEMENTED,
        data: null,
        message: 'This feature has not been implemented for DM channels'
      }
    }

    const guild = await this.guildsRepository.findOneBy({ id: channel.guildId });

    if (!guild) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Guild not found'
      }
    }

    if (guild.ownerId !== userId) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'Only guild owner is allowed to perform this action'
      }
    }

    const invites = await this.invitesService.getChannelInvites(channelId);

    return invites;
  }

  async update(userId: string, dto: UpdateChannelDTO): Promise<Result<ChannelResponseDTO>> {
    if (!userId || !dto.channelId) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: "Channel id is empty"
      };
    }

    const channel = await this.channelsRepository.findOne({ where: { id: dto.channelId }, relations: ['recipients'] })

    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: "Channel does not exist"
      };
    }

    const guild = await this.guildsRepository.findOne({ where: { id: channel.guildId }, relations: ['members'] })
    const effectivePermission = channel.guildId ? await this.getEffectivePermission({ userId, channelId: dto.channelId, guildId: channel.guildId }) : 0n;
    if (channel.guildId && (effectivePermission & Permissions.MANAGE_CHANNELS) !== Permissions.MANAGE_CHANNELS) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: "User is not allowed to update this channel"
      }
    }

    if (dto.name.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Must be between 1 and 100 in length. Channel name cannot be ""'
      };
    }

    channel.name = dto.name;

    try {
      await this.channelsRepository.save(channel);
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: "An error occurred while updating channel"
      };
    }


    const payload = toChannelResponseDTO(channel);
    const recipients = guild.members.map(m => m.userId).filter(id => id !== userId);
    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients,
        data: {
          guildId: channel.guildId,
          type: GuildUpdateType.CHANNEL_UPDATE,
          data: payload
        }
      } as Payload<GuildUpdateDTO>);
    } catch (error) {
      this.logger.error('Failed emitting channel update');
    }

    return {
      status: HttpStatus.OK,
      data: payload,
      message: "Channel updated successfully"
    };
  }

  async getUserChannelState(userId: string, channelId: string): Promise<Result<UserChannelStateResponseDTO>> {
    const state = await this.userChannelStatesRepository.findOneBy({ userId: userId, channelId: channelId });
    const redisClient = await this.redisService.getClient();
    const key = this.getUserChannelUnreadCountKey(userId, channelId);
    const unreadCountRaw = await redisClient.get(key);
    let unreadCount = 0;
    if (unreadCountRaw === null) {
      if (state) {
        const response = await firstValueFrom(this.messagesService.getUnreadCount({ channelId: channelId, lastReadId: state.lastReadId }));
        if (response.status === HttpStatus.OK) {
          unreadCount = response.data;
          await redisClient.set(key, unreadCount);
        }
        else unreadCount = 0;
      }
      else {
        unreadCount = 0;
      }

    }
    else {
      unreadCount = Number.parseInt(unreadCountRaw as string);
    }

    try {
      const dto = state ? toUserChannelStateResponseDTO(state) : new UserChannelStateResponseDTO();
      dto.unreadCount = unreadCount;
      return {
        status: HttpStatus.OK,
        data: dto,
        message: 'User channel state retrieved successfully',
      };
    } catch (error) {
      this.logger.error(error);
    }

  }

  async onMessageCreated(dto: MessageResponseDTO) {
    const channel = await this.channelsRepository.findOne({ where: { id: dto.channelId }, relations: ['recipients'] });
    if (!channel) return;

    let recipients: string[] = [];

    if (channel.type === ChannelType.DM) recipients = channel.recipients.map(r => r.userId).filter(userId => userId !== dto.senderId);
    else recipients = (await this.getMembersWithChannelPermissions(channel.guildId, channel.id, Permissions.VIEW_CHANNELS)).map(m => m.userId).filter(userId => userId !== dto.senderId);

    const redisClient = await this.redisService.getClient();
    for (const userId of recipients) {
      const key = this.getUserChannelUnreadCountKey(userId, dto.channelId);
      const unreadCountRaw = await redisClient.get(key);
      let unreadCount = 1;
      if (unreadCountRaw !== null) {
        unreadCount += Number.parseInt(unreadCountRaw as string);
      }

      await redisClient.set(key, unreadCount);
    }


    channel.lastMessageId = dto.id;
    try {
      await this.channelsRepository.save(channel);

      this.gatewayMQ.emit(MESSAGE_RECEIVED_EVENT, { recipients, data: dto } as Payload<MessageResponseDTO>)
    }
    catch (error) {
      this.logger.error(error);
    }
  }

  async getEffectivePermission({ userId, guildId, channelId }: { userId: string, guildId: string, channelId: string }): Promise<bigint> {
    let effective = await this.guildsService.getBasePermission(userId, guildId);

    const channel = await this.channelsRepository.findOne({ where: { id: channelId }, relations: ['permissionOverwrites', 'parent', 'guild', 'parent.permissionOverwrites'] });

    if (!channel || channel.guildId !== guildId) return 0n;

    if (channel.ownerId === userId) return effective;

    const memberRoles = await this.guildsService.getMemberRoles(userId, guildId);
    effective = applyChannelOverwrites(effective, channel.isSynced && channel.parent ? channel.parent.permissionOverwrites : channel.permissionOverwrites, userId, memberRoles, guildId);

    return effective;
  }

  async getMembersWithChannelPermissions(guildId: string, channelId: string, permission: bigint): Promise<GuildMember[]> {
    const guild = await this.guildsRepository.findOne({
      where: { id: guildId },
      relations: [
        'members',
        'roles',
        'members.roles',
        'channels',
        'channels.permissionOverwrites'
      ]
    });
    if (!guild) return [];

    const channel = guild.channels.find(ch => ch.id === channelId);
    if (!channel) return [];

    const parent = guild.channels.find(ch => ch.id === channel.parentId);

    const overwrites = channel.permissionOverwrites;
    const everyoneRole = guild.roles.find(role => role.id === guildId);

    return guild.members.filter(member => {
      if (member.userId === guild.ownerId) return true;

      let effective = everyoneRole ? everyoneRole.permissions : 0n;

      for (const role of member.roles) {
        effective = allowPermission(effective, role.permissions);
      }

      effective = applyChannelOverwrites(effective, channel.isSynced ? parent.permissionOverwrites : overwrites, member.userId, member.roles, guildId);

      return (effective & permission) === permission;
    })
  }

  async updateChannelPermissionOverwrite(dto: UpdateChannelPermissionOverwriteDTO): Promise<Result<PermissionOverwriteResponseDTO>> {
    const channel = await this.channelsRepository.findOne({ where: { id: dto.channelId } });

    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel does not exist'
      }
    }

    if (!channel.guildId) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Cannot set permission for this channel'
      }
    }

    const effectivePermission = await this.getEffectivePermission({ userId: dto.userId, channelId: channel.id, guildId: channel.guildId });

    if ((effectivePermission & Permissions.MANAGE_CHANNELS) !== Permissions.MANAGE_CHANNELS) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User does not have permission to manage channels'
      };
    }

    const guild = await this.guildsRepository.findOne({ where: { id: channel.guildId }, relations: ['roles', 'members'] });

    if (dto.targetType === PermissionOverwriteTargetType.MEMBER) {
      if (!guild.members.find(m => m.userId === dto.targetId)) {
        return {
          status: HttpStatus.BAD_REQUEST,
          data: null,
          message: 'Target user is not a member of this guild'
        };
      }
    }
    else {
      if (!guild.roles.find(role => role.id === dto.targetId)) {
        return {
          status: HttpStatus.BAD_REQUEST,
          data: null,
          message: 'Invalid role'
        };
      }
    }



    let overwrite: PermissionOverwrite = null!;
    try {
      if (channel.isSynced && channel.parentId) {
        channel.isSynced = false;
        const parentOverwrites = await this.permissionOverwritesRepository.findBy({
          channelId: channel.parentId,
        });

        const clonedOverwrites = parentOverwrites.map((ow) => {
          const clone = new PermissionOverwrite();
          clone.channelId = channel.id;
          clone.targetId = ow.targetId;
          clone.targetType = ow.targetType;
          clone.allow = ow.allow;
          clone.deny = ow.deny;
          return clone;
        });

        const existing = clonedOverwrites.find(
          (ow) => ow.targetId === dto.targetId,
        );
        if (existing) {
          existing.allow = dto.allow;
          existing.deny = dto.deny;
          overwrite = existing;
        } else {
          overwrite = new PermissionOverwrite();
          overwrite.channelId = channel.id;
          overwrite.targetId = dto.targetId;
          overwrite.targetType = dto.targetType;
          overwrite.allow = dto.allow;
          overwrite.deny = dto.deny;
          clonedOverwrites.push(overwrite);
        }
        await this.permissionOverwritesRepository.save(clonedOverwrites);

      } else {
        overwrite = await this.permissionOverwritesRepository.findOneBy({
          channelId: dto.channelId,
          targetId: dto.targetId,
        });

        if (!overwrite) {
          overwrite = new PermissionOverwrite();
          overwrite.channelId = dto.channelId;
          overwrite.targetId = dto.targetId;
          overwrite.targetType = dto.targetType;
        }

        overwrite.allow = dto.allow;
        overwrite.deny = dto.deny;

      }

      const cleanedAllow = overwrite.allow & ~overwrite.deny;
      const cleanedDeny = overwrite.deny & ~overwrite.allow;
      overwrite.allow = cleanedAllow;
      overwrite.deny = cleanedDeny;

      await this.channelsRepository.save(channel);
      await this.permissionOverwritesRepository.save(overwrite);
    } catch (error) {
      // TODO: ROLLBACK transaction
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while updating permission',
      };
    }

    const overwrites = await this.permissionOverwritesRepository.findBy({ channelId: dto.channelId });
    const recipients = guild.members.filter(m => m.userId !== dto.userId).map(r => r.userId);

    const channelDTO = toChannelResponseDTO(channel);
    channelDTO.permissionOverwrites = overwrites.map(toPermissionOverwriteResponseDTO);

    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients: recipients,
        data: {
          guildId: channel.guildId,
          type: GuildUpdateType.CHANNEL_UPDATE,
          data: channelDTO
        }
      } as Payload<GuildUpdateDTO>)
    } catch (error) {
      this.logger.error(error);
    }

    return {
      status: HttpStatus.OK,
      data: toPermissionOverwriteResponseDTO(overwrite),
      message: 'Permission updated successfully'
    };
  }

  async syncChannel(userId: string, channelId: string): Promise<Result<ChannelResponseDTO>> {
    const channel = await this.channelsRepository.findOne({ where: { id: channelId } });

    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel does not exist'
      }
    }

    if (!channel.guildId) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Cannot set permission for this channel'
      }
    }

    if (!channel.parentId) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel does not have parent to sync with'
      };
    }

    const effectivePermission = await this.getEffectivePermission({ userId, channelId: channel.id, guildId: channel.guildId });

    if (!((effectivePermission & Permissions.MANAGE_CHANNELS) === Permissions.MANAGE_CHANNELS)) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User does not have permission to manage channels'
      };
    }

    channel.isSynced = true;
    const overwrites = await this.permissionOverwritesRepository.findBy({ channelId: channel.id });
    delete channel.permissionOverwrites;

    try {
      await this.permissionOverwritesRepository.delete({ targetId: In(overwrites.map(ow => ow.targetId)), channelId: In(overwrites.map(ow => ow.channelId)) });
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while updating permissions'
      };
    }

    try {
      await this.channelsRepository.save(channel);
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while updating permission'
      };
    }

    const channelDTO = toChannelResponseDTO(channel);

    const guild = await this.guildsRepository.findOne({ where: { id: channel.guildId }, relations: ['roles', 'members'] });
    const recipients = guild.members.map(m => m.userId).filter(id => id !== userId);
    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients: recipients,
        data: {
          guildId: channel.guildId,
          type: GuildUpdateType.CHANNEL_UPDATE,
          data: channelDTO
        }
      } as Payload<GuildUpdateDTO>)
    } catch (error) {
      this.logger.error(error);
    }

    return {
      status: HttpStatus.OK,
      data: channelDTO,
      message: 'Permission updated successfully'
    };
  }

  async deleteChannelPermissionOverwrite(channelId: string, targetId: string, userId: string): Promise<Result<null>> {
    const channel = await this.channelsRepository.findOne({ where: { id: channelId }, relations: ['permissionOverwrites'] });

    if (!channel) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Channel doesnt exist'
      };
    }

    if (!channel.guildId) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Cannot perform this action for this channel'
      };
    }
    const overwrite = await this.permissionOverwritesRepository.findOneBy({ channelId, targetId });

    if (!overwrite) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'There are no permissions for this role/member'
      };
    }

    const effectivePermission = await this.getEffectivePermission({ userId, channelId, guildId: channel.guildId });

    if ((effectivePermission & Permissions.MANAGE_ROLES) !== Permissions.MANAGE_ROLES) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User is not allowed to manage channel permissions'
      }
    }

    if (targetId === channel.guildId) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Cannot delete this permissions'
      };
    }


    try {
      await this.permissionOverwritesRepository.delete({ targetId: overwrite.targetId, channelId: overwrite.channelId });
      channel.permissionOverwrites = channel.permissionOverwrites.filter(ow => ow.targetId !== targetId);
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while deleting permissions'
      };
    }

    const guild = await this.guildsRepository.findOne({ where: { id: channel.guildId }, relations: ['members'] })

    const channelDTO = toChannelResponseDTO(channel);
    channelDTO.permissionOverwrites = channel.permissionOverwrites.map(toPermissionOverwriteResponseDTO);

    const recipients = guild.members.map(m => m.userId).filter(id => id !== userId);

    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients,
        data: {
          type: GuildUpdateType.CHANNEL_UPDATE,
          guildId: guild.id,
          data: channelDTO,
        }
      } as Payload<GuildUpdateDTO>)
    } catch (error) {
      this.logger.error(error);
    }

    return {
      status: HttpStatus.NO_CONTENT,
      data: null,
      message: 'Permissions deleted successfully'
    };
  }

  async canUserSendMessage(userId: string, channelId: string): Promise<Result<boolean>> {
    if (userId == null || channelId == null) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: false,
        message: "Invalid request"
      };
    }

    const channel = await this.channelsRepository.findOne({ where: { id: channelId }, relations: ['permissionOverwrites', 'recipients'] });

    if (channel == null) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: false,
        message: "Invalid channel or user ID"
      }
    }

    if (channel.type == ChannelType.DM) {
      if (!channel.recipients.find(r => r.userId == userId)) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: false,
          message: "User is not a recipient of this channel"
        };
      }
    }
    else {
      const isMember = await this.guildsService.isGuildMember(userId, channel.guildId);
      if (!isMember) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: false,
          message: "User is not a member of this guild"
        };
      }

      if (channel.type == ChannelType.Voice) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: false,
          message: "Cannot send messages in this channel"
        };
      }

      const permissions = await this.getEffectivePermission({ userId, channelId, guildId: channel.guildId });
      if (!hasPermission(permissions, Permissions.SEND_MESSAGES)) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: false,
          message: "User is not allowed to send messages on this channel"
        };
      }
    }


    return {
      status: HttpStatus.OK,
      data: true,
      message: ""
    };
  }

  async canUserGetChannelMessages(userId: string, channelId: string): Promise<Result<boolean>> {
    if (userId == null || channelId == null) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: false,
        message: "Invalid request"
      };
    }

    const channel = await this.channelsRepository.findOne({ where: { id: channelId }, relations: ['permissionOverwrites', 'recipients'] });

    if (channel == null) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: false,
        message: "Invalid channel or user ID"
      }
    }

    if (channel.type == ChannelType.DM) {
      if (!channel.recipients.find(r => r.userId == userId)) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: false,
          message: "User is not a recipient of this channel"
        };
      }
    }
    else {
      const isMember = await this.guildsService.isGuildMember(userId, channel.guildId);
      if (!isMember) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: false,
          message: "User is not a member of this guild"
        };
      }

      if (channel.type == ChannelType.Voice) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: false,
          message: "Cannot send messages in this channel"
        };
      }

      const permissions = await this.getEffectivePermission({ userId, channelId, guildId: channel.guildId });
      if (!hasPermission(permissions, Permissions.VIEW_CHANNELS)) {
        return {
          status: HttpStatus.FORBIDDEN,
          data: false,
          message: "User is not allowed to send messages on this channel"
        };
      }
    }


    return {
      status: HttpStatus.OK,
      data: true,
      message: ""
    };
  }

  async canUserDeleteMessage(dto: CanUserDeleteMessageRequest): Promise<CanUserDeleteMessageResponse> {
    const channel = await this.channelsRepository.findOne({ where: { id: dto.channelId }, relations: ['permissionOverwrites', 'recipients'] });

    if (!channel) {
      throw new BadRequestException("Invalid channel ID");
    }

    if (channel.type === ChannelType.DM) {
      if (dto.messageAuthorId !== dto.userId || !channel.recipients.some(r => r.userId === dto.userId)) return { allowed: false };
    }
    else {
      const isMember = await this.guildsService.isGuildMember(dto.userId, channel.guildId);
      if (!isMember) return { allowed: false };

      const permissions = await this.getEffectivePermission({ userId: dto.userId, guildId: channel.guildId, channelId: dto.channelId });
      if (dto.messageAuthorId === dto.userId) {
        if (!hasPermission(permissions, Permissions.VIEW_CHANNELS)) {
          return { allowed: false };
        }
      }
      else {
        if (!hasPermission(permissions, Permissions.MANAGE_MESSAGES)) {
          return { allowed: false };
        }
      }
    }

    return { allowed: true };
  }

  async checkPermission(dto: CheckPermissionDTO): Promise<CheckPermissionResponseDTO> {
    if (dto.userId == null || dto.channelId == null) {
      throw new RpcException(new BadRequestException("Invalid channel or user ID"));
    }

    const channel = await this.channelsRepository.findOne({ where: { id: dto.channelId }, relations: ['permissionOverwrites', 'recipients'] });
    if (channel == null) {
      throw new RpcException(new BadRequestException("Invalid channel or user ID"));
    }

    if (channel.type === ChannelType.DM) {
      throw new RpcException(new BadRequestException("DM channels do not have permissions"));
    }

    const isMember = await this.guildsService.isGuildMember(dto.userId, channel.guildId);
    if (!isMember) {
      throw new RpcException(new ForbiddenException("User is not a member of this guild"));
    }

    if (channel.type === ChannelType.Voice) {
      throw new RpcException(new ForbiddenException("Cannot send messages in this channel"));
    }

    let permissionToCheck = 0n;
    for (const permission of dto.permissions as number[]) {
      permissionToCheck |= toBit(permission);
    }

    const grantedPermissions = await this.getEffectivePermission({ userId: dto.userId, channelId: dto.channelId, guildId: channel.guildId });
    if (!hasPermission(grantedPermissions, permissionToCheck)) {
      return { allowed: false };
    }

    return { allowed: true };
  }

  async handlePeerJoined(dto: PeerJoinedEventDTO) {
    const voiceState: VoiceState = {
      userId: dto.userId,
      channelId: dto.channelId,
      bootId: dto.bootId,
      sfuInstance: dto.sfuInstance,
      isDeafened: dto.isDeafened,
      isMuted: dto.isMuted,
      sessionId: dto.sessionId,
      status: 'connected'
    };

    const redis = await this.redisService.getClient();
    const [outcome, previousChannelId] = await redis.eval(PEER_JOINED_SCRIPT, {
      keys: [
        this.getVoiceUserChannelKey(dto.userId),
        this.getVoiceStateKey(dto.channelId, dto.userId),
        this.getVoiceChannelKey(dto.channelId)
      ],
      arguments: [
        dto.userId,
        dto.channelId,
        dto.sessionId,
        JSON.stringify(voiceState)
      ]
    }) as [string, string?];

    if (previousChannelId) {
      const recipients: string[] = await this.getChannelRecipients(previousChannelId);

      const payload: VoiceEventDTO = {
        channelId: previousChannelId,
        userId: dto.userId,
        type: VoiceEventType.VOICE_LEAVE,
        data: {
          channelId: previousChannelId,
          userId: dto.userId,
        } as VoiceStateDTO
      };


      this.gatewayMQ.emit(VOICE_UPDATE_EVENT, { recipients: recipients, data: payload } as Payload<VoiceEventDTO>);
    }

    if (outcome === 'duplicate' || outcome === 'reconnected') return;

    const recipients = await this.getChannelRecipients(dto.channelId);

    await this.handleDismissVoiceRing(dto.userId, dto.channelId);

    const payload: VoiceEventDTO = {
      channelId: dto.channelId,
      userId: dto.userId,
      type: VoiceEventType.VOICE_JOIN,
      data: {
        channelId: dto.channelId,
        userId: dto.userId,
        isMuted: dto.isMuted,
        isDeafened: dto.isDeafened
      } as VoiceStateDTO
    };

    this.gatewayMQ.emit(VOICE_UPDATE_EVENT, { recipients: recipients, data: payload } as Payload<VoiceEventDTO>);
  }

  async handlePeerLeft(dto: PeerLeftEventDTO) {
    const [outcome, remaining] = await this.runPeerLeftScript(dto, dto.reason);

    if (outcome === 'marked') await this.scheduleLeaveCheck(dto);
    if (outcome === 'removed') await this.onVoiceRemoved(dto.channelId, dto.userId, remaining);
  }

  private async runPeerLeftScript(dto: PeerLeftEventDTO, mode: 'left' | 'dropped' | 'check'): Promise<[string, number?]> {
    const redis = await this.redisService.getClient();
    const [outcome, remaining] = await redis.eval(PEER_LEFT_SCRIPT, {
      keys: [
        this.getVoiceUserChannelKey(dto.userId),
        this.getVoiceStateKey(dto.channelId, dto.userId),
        this.getVoiceChannelKey(dto.channelId)
      ],
      arguments: [
        dto.userId,
        dto.channelId,
        dto.sessionId,
        mode
      ]
    }) as [string, number?];

    return [outcome, remaining];

  }

  private async scheduleLeaveCheck(dto: PeerLeftEventDTO) {
    setTimeout(async () => {
      try {
        const [outcome, remaining] = await this.runPeerLeftScript(dto, 'check');
        if (outcome !== 'removed') return;

        await this.onVoiceRemoved(dto.channelId, dto.userId, remaining);
      } catch (error) {
        this.logger.error({ err: error }, 'Error when checking after grace period');
      }
    }, VOICE_GRACE_MS);
  }

  private async onVoiceRemoved(channelId: string, userId: string, remaining: number) {
    const recipients = await this.getChannelRecipients(channelId);

    if (remaining === 0) {
      await this.clearChannelVoiceRings(channelId);
    }

    const payload: VoiceEventDTO = {
      channelId: channelId,
      userId: userId,
      type: VoiceEventType.VOICE_LEAVE,
      data: {
        channelId,
        userId,
      } as VoiceStateDTO
    };

    this.gatewayMQ.emit(VOICE_UPDATE_EVENT, { recipients: recipients, data: payload } as Payload<VoiceEventDTO>);
  }

  private getVoiceChannelKey(channelId: string) {
    return `voice:channel:${channelId}`;
  }

  private getVoiceStateKey(channelId: string, userId: string) {
    return `voice:state:${channelId}:${userId}`
  }

  private getVoiceUserChannelKey(userId: string) {
    return `voice:user:${userId}`;
  }

  private getVoiceRingKey(channelId: string, userId: string) {
    return `ring:${channelId}:${userId}`
  }

  private getVoiceRingChannelkey(channelId: string) {
    return `ring:channel:${channelId}}`
  }

  private getUserChannelUnreadCountKey(userId: string, channelId: string) {
    return `unread:${userId}:${channelId}`
  }

  onModuleInit() {
    this.usersService = this.usersGRPCClient.getService<UserProfilesService>('UserProfilesService');
    this.messagesService = this.messagesGRPCClient.getService<MessagesService>('MessagesService');
  }
}
