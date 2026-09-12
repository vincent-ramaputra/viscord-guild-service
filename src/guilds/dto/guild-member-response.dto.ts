import { UserProfileResponseDTO } from "src/user-profiles/dto/user-profile-response.dto";

export class GuildMemberResponseDTO {
    userId: string;

    roles: string[];

    profile: UserProfileResponseDTO;
}