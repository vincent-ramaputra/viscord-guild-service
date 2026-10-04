import { IsIn } from "class-validator";

export class SfuEvent {
    @IsIn(['peer_joined', 'peer_left'])
    pattern: 'peer_joined' | 'peer_left';

    data: unknown;
}