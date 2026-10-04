import { IsString, IsUUID } from "class-validator";


export class SfuHeartbeatEventDTO {
    @IsString()
    sfuInstance: string;

    @IsUUID()
    bootId: string;
}