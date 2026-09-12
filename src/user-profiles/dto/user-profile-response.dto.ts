import { UserStatus } from "../enums/user-status.enum";

export class UserProfileResponseDTO {
    id: string

    displayName: string;
    
    username: string;

    pronouns?: string;
    
    bio?: string;
    
    status: UserStatus;
    
    avatarURL?: string;
    
    defaultAvatarURL?: string;

    createdAt: Date;
    
    updatedAt: Date;
}