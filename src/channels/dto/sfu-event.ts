import { IsIn } from "class-validator";

export class SfuEvent {
    @IsIn(['peer_joined', 'peer_left', 'sfu_started'])
    pattern: 'peer_joined' | 'peer_left' | 'sfu_started';

    data: unknown;
}