import { UserProfileResponseDTO } from "src/user-profiles/dto/user-profile-response.dto";
import { ChannelType } from "../enums/channel-type.enum";
import { UserChannelStateResponseDTO } from "./user-channel-state-response.dto";
import { PermissionOverwriteResponseDTO } from "./permission-overwrite-response.dto";

export class ChannelResponseDTO {
    id: string;

    name?: string;

    type: ChannelType;

    createdAt: Date;

    updatedAt: Date;

    isSynced: boolean;

    parent?: ChannelResponseDTO;

    guildId: string;

    recipients?: UserProfileResponseDTO[];

    lastMessageId?: string;

    userChannelState?: UserChannelStateResponseDTO;

    permissionOverwrites: PermissionOverwriteResponseDTO[];
}