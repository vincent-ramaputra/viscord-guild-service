
export class InviteResponseDTO {
    id: string;

    code: string;

    maxAge: number;

    inviterId: string;

    channelId: string;
    
    guildId?: string;

    createdAt: string;

    expiresAt: string;
}