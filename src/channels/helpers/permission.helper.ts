import { Role } from "src/roles/entities/role.entity";
import { PermissionOverwrite } from "../entities/permission-overwrite.entity";
import { PermissionOverwriteTargetType } from "../enums/permission-overwrite-target-type.enum";
import { every } from "rxjs";


export function allowPermission(basePermission: bigint, permission: bigint) {
    return basePermission | permission;
}

export function denyPermission(basePermission: bigint, permission: bigint) {
    return basePermission & ~permission;
}

export function hasPermission(basePermission: bigint, permission: bigint) {
    return (basePermission & permission) === permission;
}

export function applyChannelOverwrites(basePermission: bigint, overwrites: PermissionOverwrite[], userId: string, memberRoles: Role[], guildId: string) {
    let effective = basePermission;
    const everyoneOW = overwrites.find(ow => ow.targetId === guildId && ow.targetType === PermissionOverwriteTargetType.ROLE);
    if (everyoneOW) {
        effective &= ~everyoneOW.deny;
        effective |= everyoneOW.allow;
    }

    let allow = 0n;
    let deny = 0n;

    for (const ow of overwrites) {
        if (ow.targetType === PermissionOverwriteTargetType.ROLE && memberRoles.find(role => role.id === ow.targetId)) {
            allow |= ow.allow;
            deny |= ow.deny;
        }
    }

    effective &= ~deny;
    effective |= allow;

    const memberOW = overwrites.find(ow => ow.targetType === PermissionOverwriteTargetType.MEMBER && ow.targetId === userId);
    if (memberOW) {
        effective &= ~memberOW.deny;
        effective |= memberOW.allow;
    }

    return effective;
}