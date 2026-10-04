import { IsIn } from "class-validator";

export class SfuEvent {
    @IsIn(['peer_joined', 'peer_left', 'sfu_started', 'sfu_heartbeat'])
    pattern: 'peer_joined' | 'peer_left' | 'sfu_started' | 'sfu_heartbeat';

    data: unknown;
}