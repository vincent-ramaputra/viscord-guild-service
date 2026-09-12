
export class CreateUserProfileDto {
    id: string;

    username: string;

    displayName: string;

    validate(): (string | undefined) {
        if (!this.id || this.id.length === 0) {
            return "User id is empty";
        }

        if (!this.displayName || this.displayName.length === 0) {
            return "Display name must be filled";
        }

        return undefined;
    }
}
