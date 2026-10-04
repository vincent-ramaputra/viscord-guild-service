import { forwardRef, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { CreateGuildDto } from './dto/create-guild.dto';
import { InjectRepository } from "@nestjs/typeorm"
import { Guild } from "./entities/guild.entity";
import { Repository } from "typeorm";
import { toChannelResponseDTO, toGuildEntity, toGuildResponseDTO, toPermissionOverwriteResponseDTO, toRoleResponseDTO } from "src/mappings/mappers";
import { GuildMember } from "./entities/guild-members.entity";
import { Result } from "../interfaces/result.interface"
import { GuildResponseDTO } from "./dto/guild-response.dto";
import { StorageService } from "src/storage/storage.service";
import { ChannelsService } from "src/channels/channels.service";
import { ChannelType } from "src/channels/enums/channel-type.enum";
import { firstValueFrom } from "rxjs";
import { UserProfileResponseDTO } from "src/user-profiles/dto/user-profile-response.dto";
import { UserProfilesService } from "src/user-profiles/grpc/user-profiles.service";
import { ClientGrpc, ClientProxy } from "@nestjs/microservices";
import { GUILD_UPDATE_EVENT } from "src/constants/events";
import { Payload } from "src/interfaces/payload.dto";
import { GuildUpdateDTO } from "./dto/guild-update.dto";
import { GuildUpdateType } from "./enums/guild-update-type.enum";
import { Role } from "src/roles/entities/role.entity";
import { ALL_PERMISSIONS, Permissions } from "src/guilds/enums/permissions.enum";
import { RoleResponseDTO } from "src/guilds/dto/role-response.dto";
import { allowPermission } from "src/channels/helpers/permission.helper";
import { UpdateRoleDTO } from "./dto/update-role.dto";
import { AssignRoleDTO } from "./dto/assign-role.dto";
import { GuildMemberResponseDTO } from "./dto/guild-member-response.dto";
import { CheckPermissionDTO } from "../channels/dto/check-permission.dto";
import { UpdateMemberDTO } from "./dto/update-member.dto";
import { UpdateGuildDTO } from "./dto/update-guild.dto";
import { InvitesService } from "src/invites/invites.service";
import { InviteResponseDTO } from "src/invites/dto/invite-response.dto";
import { DeleteRoleDTO } from "./dto/delete-role.dto";
import { Channel } from "src/channels/entities/channel.entity";
import { ChannelResponseDTO } from "src/channels/dto/channel-response.dto";

@Injectable()
export class GuildsService {
  private readonly logger = new Logger(GuildsService.name);
  private usersServiceGrpc: UserProfilesService;
  constructor(
    @InjectRepository(Guild) private readonly guildsRepository: Repository<Guild>,
    @InjectRepository(GuildMember) private readonly guildMembersRepository: Repository<GuildMember>,
    @InjectRepository(Role) private readonly rolesRepository: Repository<Role>,
    @Inject(forwardRef(() => ChannelsService)) private readonly channelsService: ChannelsService,
    @Inject(forwardRef(() => InvitesService)) private readonly invitesService: InvitesService,
    private readonly storageService: StorageService,
    @Inject('USERS_SERVICE') private usersGRPCClient: ClientGrpc,
    @Inject('GATEWAY_MQ') private readonly gatewayMQ: ClientProxy
  ) { }

  /**
   * Builds the full, client-facing guild icon URL from the stored value.
   * `guild.iconURL` only holds the uploaded object's filename; the object key is
   * prefixed per-guild (`icons/<guildId>/<filename>`) and the public URL adds the
   * CDN endpoint + bucket via `StorageService.toPublicURL`.
   */
  private resolveIconURL(guild: Guild): string | undefined {
    if (!guild.iconURL) return undefined;
    // Tolerate legacy rows that already stored an absolute URL.
    if (/^https?:\/\//i.test(guild.iconURL)) return guild.iconURL;
    return this.storageService.toPublicURL(`icons/${guild.id}/${guild.iconURL}`);
  }

  async create(userId: string, dto: CreateGuildDto): Promise<Result<GuildResponseDTO>> {
    if (!dto.name || dto.name.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: "Cannot be empty."
      };
    }

    const guild = toGuildEntity(dto);
    guild.ownerId = userId;

    try {
      await this.guildsRepository.save(guild);
      //create default guild template

      const owner = await this.guildMembersRepository.save({ guild: guild, userId: userId, roles: [] });
      // create channel categories and channels

      if (dto.iconImage) {
        const types = ['image/jpg', 'image/jpeg', 'image/png', 'image/gif'];
        if (!types.find(type => type === dto.iconImage.mimetype)) {
          return {
            status: HttpStatus.BAD_REQUEST,
            data: null,
            message: "Invalid icon extension"
          };
        }

        const response = await this.storageService.uploadFile(`icons/${guild.id}`, dto.iconImage);

        if (response.status !== HttpStatus.OK) {
          await this.guildsRepository.delete(guild);
          return {
            ...response,
            data: null
          };
        }
        guild.iconURL = response.data;
      }



      const everyoneRole = new Role();
      everyoneRole.id = guild.id;
      everyoneRole.name = '@everyone';
      everyoneRole.permissions =
        Permissions.VIEW_CHANNELS |
        Permissions.CREATE_INVITES |
        Permissions.SEND_MESSAGES |
        Permissions.ATTACH_FILES |
        Permissions.MENTION_ROLES

      everyoneRole.guildId = guild.id;

      await this.rolesRepository.save(everyoneRole);

      const response = await this.channelsService.create(userId, { guildId: guild.id, name: 'Text Channels', type: ChannelType.Category, isPrivate: false });
      if (response.status !== HttpStatus.CREATED) throw new Error(response.message);
      const textChannelResponse = await this.channelsService.create(userId, { guildId: guild.id, name: 'general', type: ChannelType.Text, parentId: response.data.id, isPrivate: false });

      const voiceCategoryResponse = await this.channelsService.create(userId, { guildId: guild.id, name: 'Voice Channels', type: ChannelType.Category, isPrivate: false });
      if (voiceCategoryResponse.status !== HttpStatus.CREATED) throw new Error(voiceCategoryResponse.message);
      const voiceChannelResponse = await this.channelsService.create(userId, { guildId: guild.id, name: 'General', type: ChannelType.Voice, parentId: voiceCategoryResponse.data.id, isPrivate: false });


      await this.guildsRepository.save(guild);

    } catch (error) {
      this.logger.error(error);
      await this.guildsRepository.delete(guild);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: "Failed saving guild data",
        data: null
      }
    }

    const response = await this.findOne(userId, guild.id);

    return {
      status: HttpStatus.CREATED,
      data: response.data,
      message: "Guild created successfully"
    };

  }

  /**
   * Builds the client-facing channel list for a guild, including each channel's
   * permission overwrites and the requesting user's read state. Shared by
   * `findAll` and `findOne` so the two responses can't drift apart again.
   * Callers must load `channel.permissionOverwrites`; it is mapped without `?.`
   * so a missing join throws instead of silently dropping the field.
   */
  private async toChannelResponses(userId: string, channels: Channel[]): Promise<ChannelResponseDTO[]> {
    return Promise.all(channels.map(async ch => {
      const channel = toChannelResponseDTO(ch);
      const userChannelStateResponse = await this.channelsService.getUserChannelState(userId, ch.id);
      channel.userChannelState = userChannelStateResponse.data;
      channel.permissionOverwrites = ch.permissionOverwrites.map(toPermissionOverwriteResponseDTO);
      return channel;
    }));
  }

  async findAll(userId: string): Promise<Result<GuildResponseDTO[]>> {
    const guilds = await this.guildsRepository
      .createQueryBuilder('guild')
      .leftJoinAndSelect('guild.members', 'members')
      .leftJoinAndSelect('members.roles', 'member_roles')
      .leftJoinAndSelect('guild.channels', 'channel')
      .leftJoinAndSelect('guild.roles', 'roles')
      .leftJoinAndSelect('channel.parent', 'parent_channel')
      .leftJoinAndSelect('channel.permissionOverwrites', 'permission_overwrites')
      .where(qb => {
        const subQuery = qb
          .subQuery()
          .select('gm.guildId')
          .from('guild_member', 'gm')
          .where('gm.userId = :userId')
          .getQuery();

        return 'guild.id IN ' + subQuery;
      })
      .setParameter('userId', userId)
      .getMany();



    const result = await Promise.all(
      guilds.map(async (guild) => {
        const data = toGuildResponseDTO(guild);

        const membersResponse: Result<UserProfileResponseDTO[]> =
          await firstValueFrom(
            this.usersServiceGrpc.getUserProfiles({
              userIds: guild.members.map((m) => m.userId),
            }),
          );
        const memberProfiles = membersResponse.data;

        data.members = guild.members.map(m => ({
          userId: m.userId,
          profile: memberProfiles.find(p => p.id === m.userId)!,
          roles: m.roles.map(r => r.id)
        }))

        data.channels = await this.toChannelResponses(userId, guild.channels);

        data.roles = guild.roles.map(toRoleResponseDTO);
        data.createdAt = guild.createdAt;
        data.updatedAt = guild.updatedAt;
        data.iconURL = this.resolveIconURL(guild);

        return data;
      }),
    );


    return {
      status: HttpStatus.OK,
      data: result,
      message: 'Guilds retrieved successfully with details',
    };
  }


  async findOne(userId: string, guildId: string): Promise<Result<GuildResponseDTO>> {
    if (!guildId || guildId.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Invalid Guild Id'
      };
    }


    const guild = await this.guildsRepository
      .createQueryBuilder('guild')
      .leftJoinAndSelect('guild.members', 'member')
      .leftJoinAndSelect('member.roles', 'member_roles')
      .leftJoinAndSelect('guild.channels', 'channel')
      .leftJoinAndSelect('guild.roles', 'role')
      .leftJoinAndSelect('channel.parent', 'parent_channel')
      .leftJoinAndSelect('channel.permissionOverwrites', 'permission_overwrites')
      .where('guild.id = :guildId', { guildId: guildId }).getOne();


    if (!guild.members.find(m => m.userId === userId)) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'Not permitted to perform this action'
      };
    }

    const data = toGuildResponseDTO(guild);
    const membersResponse: Result<UserProfileResponseDTO[]> = await firstValueFrom(this.usersServiceGrpc.getUserProfiles({ userIds: guild.members.map(re => re.userId) }));

    const memberProfiles = membersResponse.data;

    data.members = guild.members.map(m => ({
      userId: m.userId,
      profile: memberProfiles.find(p => p.id === m.userId)!,
      roles: m.roles.map(r => r.id)
    }))


    data.channels = await this.toChannelResponses(userId, guild.channels);

    data.roles = guild.roles.map(toRoleResponseDTO);
    data.iconURL = this.resolveIconURL(guild);

    return {
      status: HttpStatus.OK,
      data: data,
      message: 'Guild data retrieved successfully'
    };
  }

  async join(userId: string, guildId: string, channelId: string): Promise<Result<GuildResponseDTO>> {
    const guild = await this.guildsRepository.findOne({ where: { id: guildId }, relations: ['members'] });

    if (!guild) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'This guild does not exist'
      };
    }

    if (guild.members.find(m => m.userId === userId)) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'User is already a member of this guild'
      };
    }
    const newMember = new GuildMember();
    newMember.guildId = guildId;
    newMember.userId = userId;
    guild.members.push(newMember);

    const recipients = guild.members.filter(m => m.userId !== userId).map(m => m.userId);

    const newMemberProfile = await firstValueFrom(this.usersServiceGrpc.getUserProfiles({ userIds: [userId] }));

    try {
      await this.guildMembersRepository.save(newMember);
      if (newMemberProfile[0]) this.gatewayMQ.emit(GUILD_UPDATE_EVENT, { recipients, data: { guildId, type: GuildUpdateType.MEMBER_JOIN, data: newMemberProfile.data[0] } } as Payload<GuildUpdateDTO>)
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while saving new member'
      };
    }

    return await this.findOne(userId, guildId);
  }

  async leaveGuild(userId: string, guildId: string): Promise<Result<null>> {
    const guild = await this.guildsRepository.findOne({ where: { id: guildId }, relations: ['members'] });

    if (!guild) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Guild does not exist'
      };
    }

    if (!guild.members.find(gm => gm.userId === userId)) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'User is not a member of this guild'
      };
    }

    if (guild.ownerId === userId) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'You cannot leave the guild you owned'
      };
    }

    const recipients = guild.members.filter(m => m.userId !== userId).map(m => m.userId);

    try {
      await this.guildMembersRepository.delete({ userId, guildId });
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, { recipients, data: { type: GuildUpdateType.MEMBER_LEAVE, data: userId, guildId } } as Payload<GuildUpdateDTO>)
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred'
      };
    }

    return {
      status: HttpStatus.NO_CONTENT,
      data: null,
      message: 'Guild left successfully'
    };
  }

  async getMemberRoles(userId: string, guildId: string): Promise<Role[]> {
    const member = await this.guildMembersRepository.findOne({ where: { userId, guildId }, relations: ['roles'] });

    return member?.roles ?? [];
  }

  async getGuildRoles(guildId: string): Promise<Role[]> {
    const guild = await this.guildsRepository.findOne({ where: { id: guildId }, relations: ['roles'] });

    return guild.roles ?? [];
  }

  async getBasePermission(userId: string, guildId: string): Promise<bigint> {
    const guild = await this.guildsRepository.findOne({ where: { id: guildId } });

    if (!guild) {
      return 0n;
    }

    if (guild.ownerId === userId) {
      return ALL_PERMISSIONS;
    }

    const memberRoles = await this.getMemberRoles(userId, guildId);
    const guildRoles = await this.getGuildRoles(guildId);
    const everyoneRole = guildRoles.find(role => role.id === guildId);

    let basePermissions = everyoneRole ? everyoneRole.permissions : 0n;

    for (const role of memberRoles) {
      basePermissions = allowPermission(basePermissions, role.permissions);
    }

    return basePermissions;
  }

  async getMembersWithPermissions(guildId: string, permission: bigint): Promise<GuildMember[]> {
    const guild = await this.guildsRepository.findOne({
      where: { id: guildId },
      relations: ['members', 'roles', 'members.roles']
    });
    if (!guild) return [];

    const everyoneRole = guild.roles.find(role => role.id === guildId);


    return guild.members.filter(member => {
      if (member.userId === guild.ownerId) return true;

      let basePermissions = everyoneRole ? everyoneRole.permissions : 0n;

      for (const role of member.roles) {
        basePermissions = allowPermission(basePermissions, role.permissions);
      }

      return (basePermissions & permission) === permission;
    })
  }

  async updateRole(dto: UpdateRoleDTO): Promise<Result<RoleResponseDTO>> {
    const guild = await this.guildsRepository.findOne({ where: { id: dto.guildId }, relations: ['roles', 'members'] });

    if (!guild) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Guild does not exist'
      };
    }

    if (guild.ownerId !== dto.userId) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'Only owner is allowed to perform this action'
      };
    }

    const role = guild.roles.find(role => role.id === dto.id);

    if (!role) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Role does not exist'
      };
    }

    if (role.id !== guild.id) {
      if (dto.name) role.name = dto.name;
      if (dto.isHoisted !== null && dto.isHoisted !== undefined) role.isHoisted = dto.isHoisted;
      if (dto.position) role.position = dto.position;
      if (dto.color) role.color = dto.color;
    }
    if (dto.permissions) role.permissions = dto.permissions;

    try {
      await this.rolesRepository.save(role);
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while updating role'
      };
    }

    const recipients = guild.members.filter(gm => gm.userId !== dto.userId).map(gm => gm.userId);

    const roleDTO = toRoleResponseDTO(role);

    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients,
        data: {
          guildId: dto.guildId,
          type: GuildUpdateType.ROLE_UPDATE,
          data: roleDTO
        }
      } as Payload<GuildUpdateDTO>)
    } catch (error) {
      this.logger.error(error);
    }

    return {
      status: HttpStatus.OK,
      data: roleDTO,
      message: 'Role updated successfully'
    };
  }

  async assignRole(dto: AssignRoleDTO): Promise<Result<GuildMemberResponseDTO[]>> {
    const guild = await this.guildsRepository.findOne({ where: { id: dto.guildId }, relations: ['roles', 'members', 'members.roles'] });

    if (!guild) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Guild does not exist'
      };
    }

    const basePermission = await this.getBasePermission(dto.assignerId, dto.guildId);
    if ((basePermission & Permissions.MANAGE_ROLES) !== Permissions.MANAGE_ROLES) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User does not have permission to manage roles'
      };
    }

    const role = guild.roles.find(role => role.id === dto.roleId);

    if (!role) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Role does not exist'
      };
    }

    if (role.id === guild.id) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Cannot assign @everyone role'
      };
    }

    const invalidUsers: string[] = [];
    const updatedMembers: GuildMember[] = [];
    for (const userId of dto.assigneeIds) {
      const member = guild.members.find(gm => gm.userId === userId)
      if (!member) invalidUsers.push(userId);
      else {
        const assignedRole = member.roles.find(role => role.id === dto.roleId);
        if (assignedRole) continue;
        member.roles.push(role);
        updatedMembers.push(member);
      }
    }

    if (invalidUsers.length > 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Some users are not a member of this guild'
      }
    }


    try {
      await this.guildMembersRepository.save(updatedMembers)
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while updating members roles'
      };
    }

    const recipients = guild.members.filter(m => m.userId !== dto.assignerId).map(m => m.userId);

    const updatedMembersDTO: GuildMemberResponseDTO[] = updatedMembers.map(m => ({
      userId: m.userId,
      profile: null,
      roles: m.roles.map(role => role.id)
    }));

    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients,
        data: {
          guildId: guild.id,
          type: GuildUpdateType.MEMBERS_UPDATE,
          data: updatedMembersDTO,
        }
      } as Payload<GuildUpdateDTO>)
    } catch (error) {
      this.logger.error(error);
    }

    return {
      status: HttpStatus.OK,
      data: updatedMembersDTO,
      message: 'Roles assigned successfully'
    };
  }

  async createRole(userId: string, guildId: string): Promise<Result<RoleResponseDTO>> {
    const guild = await this.guildsRepository.findOne({ where: { id: guildId }, relations: ['roles', 'members'] });

    if (!guild) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Guild does not exist'
      };
    }

    if (guild.ownerId !== userId) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'Only owner is allowed to perform this action'
      };
    }

    const role = new Role();
    role.name = 'new role';
    role.position = Math.min(...guild.roles.map(r => r.position)) + 1;
    role.guildId = guildId;
    role.permissions = 0n;

    try {
      await this.rolesRepository
        .createQueryBuilder('role')
        .update(Role)
        .set({ position: () => 'position + 1' })
        .where('position >= :position', { position: role.position })
        .execute();

      await this.rolesRepository.save(role);
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while saving roles'
      }
    }

    const roleDTO = toRoleResponseDTO(role);
    const recipients = guild.members.filter(m => m.userId !== userId).map(m => m.userId);

    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients,
        data: {
          guildId,
          type: GuildUpdateType.ROLE_UPDATE,
          data: roleDTO
        }
      } as Payload<GuildUpdateDTO>)
    } catch (error) {
      this.logger.error(error);
    }

    return {
      status: HttpStatus.OK,
      data: roleDTO,
      message: 'Role created successfully'
    }
  }

  async checkPermission(dto: CheckPermissionDTO) {
    try {
      const effectivePermission = await (dto.channelId ?
        this.channelsService.getEffectivePermission({ userId: dto.userId, guildId: dto.guildId, channelId: dto.channelId }) :
        this.getBasePermission(dto.userId, dto.guildId));
      return (effectivePermission & BigInt(dto.permissions as string)) === BigInt(dto.permissions as string);
    } catch (error) {
      this.logger.error(error);
    }

    return false;
  }

  async updateMember(dto: UpdateMemberDTO) {
    if (!dto.userId || !dto.guildId || !dto.memberId) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Invalid DTO'
      };
    }

    const guild = await this.guildsRepository.findOne({ where: { id: dto.guildId }, relations: ['members', 'roles'] });

    if (!guild) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Guild not found'
      };
    }

    const member = guild.members.find(m => m.userId === dto.memberId);

    if (!member) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'This user is not a member of this guild'
      };
    }

    const basePermission = await this.getBasePermission(dto.userId, dto.guildId);

    if ((basePermission & Permissions.MANAGE_ROLES) !== Permissions.MANAGE_ROLES) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User does not have permission to manage roles'
      };
    }

    member.roles = guild.roles.filter(role => dto.roleIds.find(id => id === role.id));

    try {
      await this.guildMembersRepository.save(member);
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while updating member'
      };
    }

    const recipients = guild.members.filter(m => m.userId !== dto.userId).map(r => r.userId);
    const memberDTO: GuildMemberResponseDTO = {
      userId: member.userId,
      profile: null,
      roles: member.roles.map(role => role.id)
    }

    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients,
        data: {
          type: GuildUpdateType.MEMBERS_UPDATE,
          guildId: dto.guildId,
          data: [memberDTO]
        }
      } as Payload<GuildUpdateDTO>);
    } catch (error) {
      this.logger.error(error);
    }

    return {
      status: HttpStatus.OK,
      data: memberDTO,
      message: 'Member updated successfully'
    };
  }

  async update(dto: UpdateGuildDTO): Promise<Result<GuildResponseDTO>> {
    const guild = await this.guildsRepository.findOne({ where: { id: dto.guildId }, relations: ['members'] });

    if (!guild) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Guild does not exist'
      };
    }

    if (dto.userId !== guild.ownerId) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'Only owner is permitted to perform this action'
      };
    }

    if (!dto.name || dto.name.length === 0) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Cannot be empty.'
      };
    }

    guild.name = dto.name;

    try {
      await this.guildsRepository.save(guild);
    } catch (error) {
      this.logger.error(error);

      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while updating server data.'
      }
    }

    const guildDTO = toGuildResponseDTO(guild);
    guildDTO.iconURL = this.resolveIconURL(guild);

    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients: guild.members.map(m => m.userId).filter(id => id !== dto.userId),
        data: {
          guildId: guild.id,
          data: guildDTO,
          type: GuildUpdateType.GUILD_UPDATE
        }
      } as Payload<GuildUpdateDTO>)
    } catch (error) {
      this.logger.error(error);
    }

    return {
      status: HttpStatus.OK,
      data: guildDTO,
      message: 'Guild updated successfully'
    };
  }


  remove(id: number) {
    return `This action removes a #${id} guild`;
  }

  async getGuildInvites(userId: string, guildId: string): Promise<Result<InviteResponseDTO[]>> {
    const guild = await this.guildsRepository.findOneBy({ id: guildId });

    if (!guild) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Guild does not exist'
      };
    }

    const effectivePermission = await this.getBasePermission(userId, guildId);

    if ((effectivePermission & Permissions.MANAGE_SERVERS) !== Permissions.MANAGE_SERVERS) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User is not permitted to perform this action'
      };
    }

    return await this.invitesService.getGuildInvites(guildId);
  }

  async deleteRole(dto: DeleteRoleDTO): Promise<Result<null>> {
    const guild = await this.guildsRepository.findOne({ where: { id: dto.guildId }, relations: ['roles', 'members'] });

    if (!guild) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Guild does not exist'
      };
    }

    if (!guild.roles.find(role => role.id === dto.roleId)) {
      return {
        status: HttpStatus.BAD_REQUEST,
        data: null,
        message: 'Role does not exist'
      };
    }

    const effectivePermission = await this.getBasePermission(dto.userId, dto.guildId);

    if ((effectivePermission & Permissions.MANAGE_SERVERS) !== Permissions.MANAGE_SERVERS) {
      return {
        status: HttpStatus.FORBIDDEN,
        data: null,
        message: 'User is not permitted to perform this action'
      };
    }

    try {
      await this.rolesRepository.delete({ id: dto.roleId });
    } catch (error) {
      this.logger.error(error);
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        data: null,
        message: 'An error occurred while deleting role'
      };
    }

    try {
      this.gatewayMQ.emit(GUILD_UPDATE_EVENT, {
        recipients: guild.members.map(m => m.userId).filter(id => id !== dto.userId),
        data: {
          guildId: guild.id,
          data: dto.roleId,
          type: GuildUpdateType.ROLE_DELETE
        }
      } as Payload<GuildUpdateDTO>)
    } catch (error) {
      this.logger.error(error);
    }

    return {
      status: HttpStatus.NO_CONTENT,
      data: null,
      message: 'Role deleted successfully'
    };
  }

  async isGuildMember(userId: string, guildId: string): Promise<boolean> {
    const isMember = await this.guildMembersRepository.exists({
      where: {
        userId: userId,
        guildId: guildId,
      }
    });

    return isMember;
  }

  onModuleInit() {
    this.usersServiceGrpc = this.usersGRPCClient.getService<UserProfilesService>('UserProfilesService');
  }
}
