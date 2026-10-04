import { IsIn } from "class-validator";

export class SfuEvent {
    @IsIn(['peer_joined', 'peer_left', 'sfu_started', 'sfu_heartbeat', 'sfu_snapshot'])
    pattern: 'peer_joined' | 'peer_left' | 'sfu_started' | 'sfu_heartbeat' | 'sfu_snapshot';

    data: unknown;
}