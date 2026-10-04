import {IsBoolean, IsNumber, IsString, IsUUID} from 'class-validator';

export class PeerJoinedEventDTO {
    @IsUUID()
    userId: string;

    @IsUUID()
    channelId: string;

    @IsUUID()
    sessionId: string;

    @IsString()
    sfuInstance: string;

    @IsUUID()
    bootId: string;

    @IsBoolean()
    isMuted: boolean;

    @IsBoolean()
    isDeafened: boolean;

    @IsNumber()
    at: number;
}