
export class UpdateRoleDTO {
    id: string;
    name: string;
    position: number;
    permissions: bigint;
    isHoisted: boolean;
    color?: number;
    guildId: string;
    userId: string;
}