import { IsNumber, IsString, IsUUID } from "class-validator";

export class SfuStartedEventDTO {
    @IsString()
    sfuInstance: string;

    @IsUUID()
    bootId: string;

    @IsNumber()
    at: number;
}