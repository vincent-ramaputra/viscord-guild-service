import { Controller, Get, Post, Body, Patch, Param, Delete, Headers, ValidationPipe, Res, HttpStatus, Header, Put } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { CreateChannelDTO } from './dto/create-channel.dto';
import { CreateDMChannelDTO } from "./dto/create-dm-channel.dto";
import { Response } from "express";
import { GrpcMethod, MessagePattern } from "@nestjs/microservices";
import { AcknowledgeMessageDTO } from "./dto/acknowledge-message.dto";
import { GET_VOICE_RINGS_EVENT, GET_VOICE_STATES_EVENT, MESSAGE_CREATED, VOICE_UPDATE_EVENT } from "src/constants/events";
import { VoiceEventDTO } from "./dto/voice-event.dto";
import { VoiceEventType } from "./enums/voice-event-type";
import { GetDMChannelsDTO } from "./dto/get-dm-channels.dto";
import { CreateInviteDto } from "src/invites/dto/create-invite.dto";
import { UpdateChannelDTO } from "./dto/update-channel.dto";
import { UpdateChannelPermissionOverwriteDTO } from "./dto/update-channel-permission.dto";
import { MessageResponseDTO } from "src/messages/dto/message-response.dto";
import { InvitesService } from "src/invites/invites.service";
import { CanUserDeleteMessageRequest } from "./dto/can-user-delete-message.dto";
import { CheckPermissionDTO } from "./dto/check-permission.dto";
import { VoicePresenceService } from './voice-presence.service';

@Controller('guilds/:guildId/channels')
export class GuildChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
  ) { }

  @Post()
  async create(@Headers('X-User-Id') userId: string, @Body() createChannelDto: CreateChannelDTO, @Res() res: Response, @Param('guildId') guildId: string) {
    createChannelDto.guildId = guildId;
    const result = await this.channelsService.create(userId, createChannelDto);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Get()
  findAll() {

  }

  @Get(':id')
  findOne(@Param('id') id: string) {
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
  }
}

@Controller('users/me/channels')
export class DMChannelsController {
  constructor(private readonly channelsService: ChannelsService) { }

  @Post()
  async create(@Headers('X-User-Id') userId: string, @Body(new ValidationPipe({ transform: true })) dto: CreateDMChannelDTO, @Res() res: Response) {
    if (!userId || userId.length === 0) {
      return res.status(HttpStatus.UNAUTHORIZED).send();
    }

    const result = await this.channelsService.createDMChannel(userId, dto);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Get()
  async getAll(@Headers('X-User-Id') userId: string, @Res() res: Response) {
    const result = await this.channelsService.getDMChannels(userId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @GrpcMethod('ChannelsService', 'GetDMChannels')
  async acknowledgeMessage(dto: GetDMChannelsDTO) {
    return this.channelsService.getDMChannels(dto.userId);
  }

  @Get(':channelId')
  async getDMChannel(@Headers('X-User-Id') userId: string, @Param('channelId') channelId: string, @Res() res: Response) {
    if (!userId || userId.length === 0) {
      return res.status(HttpStatus.UNAUTHORIZED).send();
    }

    const result = await this.channelsService.getChannelByIdWithAuth(userId, channelId);
    const { status } = result;

    return res.status(status).json(result);
  }
}

@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService,
    private readonly invitesService: InvitesService,
    private readonly voicePresenceService: VoicePresenceService
  ) { }

  @Get(':channelId')
  async getDMChannel(@Headers('X-User-Id') userId: string, @Param('channelId') channelId: string, @Res() res: Response) {
    if (!userId || userId.length === 0) {
      return res.status(HttpStatus.UNAUTHORIZED).send();
    }

    const result = await this.channelsService.getChannelByIdWithAuth(userId, channelId);
    const { status } = result;
    return res.status(status).json(result);
  }

  @Post(':channelId/typing')
  async broadcastUserTyping(@Headers('X-User-Id') userId: string, @Param('channelId') channelId: string, @Res() res: Response) {
    if (!userId || userId.length === 0) {
      return res.status(HttpStatus.UNAUTHORIZED).send();
    }

    const result = await this.channelsService.broadcastUserTyping(userId, channelId);
    const { status } = result;
    return res.status(status).json(result);
  }

  @GrpcMethod('ChannelsService', 'AcknowledgeMessage')
  async acknowledgeMessage(dto: AcknowledgeMessageDTO) {
    return this.channelsService.acknowledgeMessage(dto);
  }

  @Post(':channelId/call/ring')
  async ringChannelRecipients(@Headers('X-User-Id') userId: string, @Param('channelId') channelId: string, @Res() res: Response) {
    if (!userId || userId.length === 0) {
      return res.status(HttpStatus.UNAUTHORIZED).send();
    }

    const result = await this.channelsService.ringChannelRecipients(userId, channelId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Delete(':channelId')
  async deleteChannel(@Headers('X-User-Id') userId: string, @Param('channelId') channelId: string, @Res() res: Response) {
    if (!userId || userId.length === 0) {
      return res.status(HttpStatus.UNAUTHORIZED).send();
    }

    const result = await this.channelsService.delete(userId, channelId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Patch(":channelId")
  async updateChannel(@Headers('X-User-Id') userId: string, @Param('channelId') channelId: string, @Res() res: Response, @Body(new ValidationPipe({ transform: true })) dto: UpdateChannelDTO) {
    dto.channelId = channelId;

    const result = await this.channelsService.update(userId, dto);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Post(':channelId/invites')
  async createOrGetInvite(@Headers('X-User-Id') userId: string, @Param('channelId') channelId: string, @Res() res: Response, @Body(new ValidationPipe({ transform: true })) dto: CreateInviteDto) {
    dto.inviterId = userId;
    dto.channelId = channelId;

    const result = await this.invitesService.createOrGet(dto);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Get(':channelId/invites')
  async getInvites(@Headers('X-User-Id') userId: string, @Param('channelId') channelId: string, @Res() res: Response) {
    const result = await this.channelsService.getChannelInvites(userId, channelId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Put(':channelId/permissions/:targetId')
  async updateChannelPermissionOverwrite(@Headers('X-User-Id') userId: string, @Res() res: Response, @Param('channelId') channelId: string, @Param('targetId') targetId: string, @Body() dto: UpdateChannelPermissionOverwriteDTO) {
    dto.channelId = channelId;
    dto.userId = userId;
    dto.targetId = targetId;

    const result = await this.channelsService.updateChannelPermissionOverwrite(dto);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Delete(':channelId/permissions/:targetId')
  async deletePermissionOverwrite(@Headers('X-User-Id') userId: string, @Res() res: Response, @Param('channelId') channelId: string, @Param('targetId') targetId: string, @Body() dto: UpdateChannelPermissionOverwriteDTO) {
    const result = await this.channelsService.deleteChannelPermissionOverwrite(channelId, targetId, userId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Post(':channelId/sync')
  async syncChannelPermissions(@Headers('X-User-Id') userId: string, @Res() res: Response, @Param('channelId') channelId: string) {
    const result = await this.channelsService.syncChannel(userId, channelId);
    const { status } = result;

    return res.status(status).json(result);
  }

  @Post(':channelId/voice-ticket')
  async createVoiceTicket(
    @Headers('X-User-Id') userId: string,
    @Res() res: Response,
    @Param('channelId') channelId: string
  ) {
    const result = await this.channelsService.createVoiceTicket(userId, channelId);
    const { status } = result;

    return res.status(status).json(result);

  }

  @MessagePattern(VOICE_UPDATE_EVENT)
  async voiceUpdate(@Body(new ValidationPipe({ transform: true })) dto: VoiceEventDTO) {
    switch (dto.type) {
      case VoiceEventType.VOICE_JOIN:
      case VoiceEventType.VOICE_LEAVE: break;
      case VoiceEventType.STATE_UPDATE: await this.voicePresenceService.handleVoiceStateUpdate(dto); break;
    }
  }

  @MessagePattern(GET_VOICE_STATES_EVENT)
  async getVoiceStates(@Body(new ValidationPipe({ transform: true })) userId: string) {
    await this.voicePresenceService.handleGetVoiceStates(userId);
  }

  @MessagePattern(GET_VOICE_RINGS_EVENT)
  async getVoiceRingStates(@Body(new ValidationPipe({ transform: true })) userId: string) {
    await this.channelsService.handleGetVoiceRings(userId);
  }

  @GrpcMethod('ChannelsService', 'GetChannelById')
  async getChannelById({ userId, channelId }: { userId: string, channelId: string }) {
    return await this.channelsService.getChannelById(userId, channelId);
  }

  @GrpcMethod('ChannelsService', 'IsUserChannelParticipant')
  async isUserChannelParticipant({ userId, channelId }: { userId: string, channelId: string }) {
    return await this.channelsService.isUserChannelParticipant(userId, channelId)
  }

  @GrpcMethod('ChannelsService', 'CheckPermission')
  async checkPermission(dto: CheckPermissionDTO) {
    console.log(dto)
    return await this.channelsService.checkPermission(dto);
  }

  @GrpcMethod('ChannelsService', "CanUserDeleteMessage")
  async canUserDeleteMessage(dto: CanUserDeleteMessageRequest) {
    return await this.channelsService.canUserDeleteMessage(dto);
  }

  @GrpcMethod('ChannelsService', 'CanUserSendMessage')
  async canUserSendMessage({ userId, channelId }: { userId: string, channelId: string }) {
    return await this.channelsService.canUserSendMessage(userId, channelId);
  }

  @GrpcMethod('ChannelsService', 'CanUserGetChannelMessages')
  async canUserGetChannelMessages({ userId, channelId }: { userId: string, channelId: string }) {
    return await this.channelsService.canUserGetChannelMessages(userId, channelId);
  }

  @GrpcMethod('ChannelsService', 'CanUserAttachFiles')
  async canUserAttachFiles({ userId, channelId }: { userId: string, channelId: string }) {
    return await this.channelsService.canUserAttachFiles(userId, channelId);
  }

  @MessagePattern(MESSAGE_CREATED)
  async incrementUnreadCount(@Body(new ValidationPipe({ transform: true })) dto: MessageResponseDTO) {
    await this.channelsService.onMessageCreated(dto);
  }
}