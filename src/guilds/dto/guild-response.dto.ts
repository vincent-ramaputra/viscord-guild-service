import { ChannelResponseDTO } from "src/channels/dto/channel-response.dto";
import { RoleResponseDTO } from "src/guilds/dto/role-response.dto";
import { GuildMemberResponseDTO } from "./guild-member-response.dto";

export class GuildResponseDTO {
    id: string;

    name: string;

    ownerId: string;

    iconURL?: string;

    channels: ChannelResponseDTO[]

    createdAt: Date

    updatedAt: Date

    members: GuildMemberResponseDTO[];

    roles: RoleResponseDTO[];
}