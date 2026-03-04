

export interface CheckPermissionDTO {
    userId: string;
    guildId: string;
    channelId: string;
    permissions: string | number[];
}