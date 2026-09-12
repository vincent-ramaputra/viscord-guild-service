import { ChannelType } from "../enums/channel-type.enum";

export class CreateChannelDTO {
    guildId: string;

    name: string;

    type: ChannelType;

    parentId?: string;

    isPrivate: boolean;
}
