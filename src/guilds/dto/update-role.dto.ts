import { AutoMap } from "@automapper/classes";

export class UpdateRoleDTO {
    @AutoMap()
    id: string;
    @AutoMap()
    name: string;
    @AutoMap()
    position: number;
    @AutoMap()
    permissions: bigint;
    @AutoMap()
    isHoisted: boolean;
    @AutoMap()
    color?: number;
    @AutoMap()
    guildId: string;
    @AutoMap()
    userId: string;
}