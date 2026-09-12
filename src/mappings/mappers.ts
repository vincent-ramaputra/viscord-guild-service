import { Guild } from "src/guilds/entities/guild.entity";
import { GuildResponseDTO } from "src/guilds/dto/guild-response.dto";
import { CreateGuildDto } from "src/guilds/dto/create-guild.dto";
import { Role } from "src/roles/entities/role.entity";
import { RoleResponseDTO } from "src/guilds/dto/role-response.dto";
import { Channel } from "src/channels/entities/channel.entity";
import { ChannelResponseDTO } from "src/channels/dto/channel-response.dto";
import { CreateChannelDTO } from "src/channels/dto/create-channel.dto";
import { CreateDMChannelDTO } from "src/channels/dto/create-dm-channel.dto";
import { PermissionOverwrite } from "src/channels/entities/permission-overwrite.entity";
import { PermissionOverwriteResponseDTO } from "src/channels/dto/permission-overwrite-response.dto";
import { UserChannelState } from "src/channels/entities/user-channel-state.entity";
import { UserChannelStateResponseDTO } from "src/channels/dto/user-channel-state-response.dto";
import { Invite } from "src/invites/entities/invite.entity";
import { InviteResponseDTO } from "src/invites/dto/invite-response.dto";
import { CreateInviteDto } from "src/invites/dto/create-invite.dto";

export function toGuildEntity(dto: CreateGuildDto): Guild {
    const guild = new Guild();
    guild.name = dto.name;
    return guild;
}

export function toGuildResponseDTO(guild: Guild): GuildResponseDTO {
    const dto = new GuildResponseDTO();
    dto.id = guild.id;
    dto.name = guild.name;
    dto.ownerId = guild.ownerId;
    dto.iconURL = guild.iconURL;
    dto.createdAt = guild.createdAt;
    dto.updatedAt = guild.updatedAt;
    dto.channels = guild.channels?.map(toChannelResponseDTO);
    dto.roles = guild.roles?.map(toRoleResponseDTO);
    return dto;
}

export function toRoleResponseDTO(role: Role): RoleResponseDTO {
    const dto = new RoleResponseDTO();
    dto.id = role.id;
    dto.name = role.name;
    dto.permissions = role.permissions.toString();
    dto.position = role.position;
    dto.isHoisted = role.isHoisted;
    dto.color = role.color;
    dto.guildId = role.guildId;
    return dto;
}

export function toChannelEntityFromCreateDTO(dto: CreateChannelDTO): Channel {
    const channel = new Channel();
    channel.guildId = dto.guildId;
    channel.name = dto.name;
    channel.type = dto.type;
    channel.parentId = dto.parentId;
    return channel;
}

export function toChannelEntityFromCreateDMDTO(dto: CreateDMChannelDTO): Channel {
    return new Channel();
}

export function toChannelResponseDTO(channel: Channel): ChannelResponseDTO {
    const dto = new ChannelResponseDTO();
    dto.id = channel.id;
    dto.name = channel.name;
    dto.type = channel.type;
    dto.createdAt = channel.createdAt;
    dto.updatedAt = channel.updatedAt;
    dto.isSynced = channel.isSynced;
    dto.guildId = channel.guildId;
    dto.lastMessageId = channel.lastMessageId;
    dto.parent = channel.parent ? toChannelResponseDTO(channel.parent) : undefined;
    dto.permissionOverwrites = channel.permissionOverwrites?.map(toPermissionOverwriteResponseDTO);
    return dto;
}

export function toPermissionOverwriteResponseDTO(overwrite: PermissionOverwrite): PermissionOverwriteResponseDTO {
    const dto = new PermissionOverwriteResponseDTO();
    dto.allow = overwrite.allow.toString();
    dto.deny = overwrite.deny.toString();
    dto.targetId = overwrite.targetId;
    dto.targetType = overwrite.targetType;
    dto.channelId = overwrite.channelId;
    return dto;
}

export function toUserChannelStateResponseDTO(state: UserChannelState): UserChannelStateResponseDTO {
    const dto = new UserChannelStateResponseDTO();
    dto.lastReadId = state.lastReadId;
    return dto;
}

export function toInviteEntity(dto: CreateInviteDto): Invite {
    const invite = new Invite();
    invite.inviterId = dto.inviterId;
    invite.channelId = dto.channelId;
    invite.guildId = dto.guildId;
    invite.maxAge = dto.maxAge;
    return invite;
}

export function toInviteResponseDTO(invite: Invite): InviteResponseDTO {
    const dto = new InviteResponseDTO();
    dto.id = invite.id;
    dto.code = invite.code;
    dto.maxAge = invite.maxAge;
    dto.inviterId = invite.inviterId;
    dto.channelId = invite.channelId;
    dto.guildId = invite.guildId;
    dto.createdAt = invite.createdAt as unknown as string;
    dto.expiresAt = invite.expiresAt as unknown as string;
    return dto;
}
