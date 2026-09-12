import { PermissionOverwriteTargetType } from "../enums/permission-overwrite-target-type.enum";

export class PermissionOverwriteResponseDTO {
    allow: string;

    deny: string;

    targetId: string;

    targetType: PermissionOverwriteTargetType;

    channelId: string;

}