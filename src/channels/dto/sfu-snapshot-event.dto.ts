import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsNumber, IsString, IsUUID, ValidateNested } from "class-validator";

export class SfuSnapshotPeerDTO {
    @IsUUID()
    userId: string;

    @IsUUID()
    channelId: string;

    @IsUUID()
    sessionId: string;

    // The value sent with JOIN_ROOM; later toggles go through STATE_UPDATE, so only use it for new states.
    @IsBoolean()
    isMuted: boolean;

    @IsBoolean()
    isDeafened: boolean;
}

export class SfuSnapshotEventDTO {
    @IsString()
    sfuInstance: string;

    @IsUUID()
    bootId: string;

    @IsNumber()
    at: number;

    // @Type makes plainToInstance build SfuSnapshotPeerDTO instances, so ValidateNested can check each peer.
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SfuSnapshotPeerDTO)
    peers: SfuSnapshotPeerDTO[];
}
