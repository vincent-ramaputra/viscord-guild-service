import { IsIn, IsNumber, IsUUID } from "class-validator";

export class PeerLeftEventDTO {
    @IsUUID()
    userId: string;

    @IsUUID()
    channelId: string;

    @IsUUID()
    sessionId: string;

    @IsIn(['left', 'dropped'])
    reason: 'left' | 'dropped';

    @IsNumber()
    at: number;
}