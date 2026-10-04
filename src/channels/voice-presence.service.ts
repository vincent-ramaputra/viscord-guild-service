import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { RedisService } from "src/redis/redis.service";
import { PeerJoinedEventDTO } from "./dto/peer-joined-event.dto";
import { VoiceState } from "./entities/voice-state";
import { PEER_JOINED_SCRIPT } from "./redis-scripts/peer-joined.script";
import { ChannelsService } from "./channels.service";
import { VoiceEventDTO } from "./dto/voice-event.dto";
import { VoiceEventType } from "./enums/voice-event-type";
import { VoiceStateDTO } from "./dto/voice-state.dto";
import { ClientProxy } from "@nestjs/microservices";
import { GET_VOICE_STATES_EVENT, VOICE_UPDATE_EVENT } from "src/constants/events";
import { PeerLeftEventDTO } from "./dto/peer-left-event.dto";
import { PEER_LEFT_SCRIPT } from "./redis-scripts/peer-left.script";
import { SFU_HEARTBEAT_EXP_S, SWEEP_SFU_INTERVAL_MS, VOICE_GRACE_MS } from "src/constants/time";
import { SfuStartedEventDTO } from "./dto/sfu-started-event.dto";
import { Payload } from "src/interfaces/payload.dto";
import { SfuHeartbeatEventDTO } from "./dto/sfu-heartbeat-event.dto";
import { Channel } from "./entities/channel.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { VOICE_STATE_UPDATE_SCRIPT } from "./redis-scripts/voice-state-update.script";

@Injectable()
export class VoicePresenceService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(VoicePresenceService.name);

    private sweeping = false;
    private sweepTimer?: NodeJS.Timeout;

    private readonly SFU_INSTANCE_KEY = 'sfu:instance';

    constructor(
        private readonly redisService: RedisService,
        private readonly channelsService: ChannelsService,
        @InjectRepository(Channel) private channelsRepository: Repository<Channel>,
        @Inject('GATEWAY_MQ') private readonly gatewayMQ: ClientProxy
    ) {
    }

    async handleVoiceStateUpdate(dto: VoiceEventDTO) {
        const { isMuted, isDeafened } = dto.data ?? {};
        const valid = (v: unknown) => v === undefined || typeof v === 'boolean';
        if (!valid(isMuted) || !valid(isDeafened)) return;

        const redis = await this.redisService.getClient();
        const [outcome, rawState] = await redis.eval(VOICE_STATE_UPDATE_SCRIPT, {
            keys: [this.getVoiceStateKey(dto.channelId, dto.userId)],
            arguments: [
                isMuted === undefined ? '' : String(isMuted),
                isDeafened === undefined ? '' : String(isDeafened),
            ]
        }) as [string, string?];

        if (outcome !== 'updated') return;

        const state: VoiceState = JSON.parse(rawState);

        const recipients = await this.channelsService.getChannelRecipients(dto.channelId);

        const payload: VoiceEventDTO = {
            channelId: dto.channelId,
            userId: dto.userId,
            type: VoiceEventType.STATE_UPDATE,
            data: this.toVoiceStateDTO(state)
        }

        this.gatewayMQ.emit(VOICE_UPDATE_EVENT, { recipients: recipients, data: payload } as Payload<VoiceEventDTO>)
    }

    async handleGetVoiceStates(userId: string) {
        const channels = await this.channelsRepository
            .createQueryBuilder('channel')
            .innerJoinAndSelect('channel.recipients', 'channel_recipient')
            .where('channel_recipient.user_id = :userId', { userId: userId }).getMany();

        const client = await this.redisService.getClient();

        const voiceStates: VoiceStateDTO[] = [];
        for (const channel of channels) {
            const participants = await client.sMembers(this.getVoiceChannelKey(channel.id));
            if (participants.length === 0) continue;
            const rawStates = await client.mGet(participants.map(uid => this.getVoiceStateKey(channel.id, uid)));
            const states = rawStates.filter((v): v is string => v !== null).map(s => this.toVoiceStateDTO(JSON.parse(s)));
            voiceStates.push(...states);
        }

        this.gatewayMQ.emit(GET_VOICE_STATES_EVENT, { recipients: [userId], data: voiceStates } as Payload<VoiceStateDTO[]>)
    }


    async handlePeerJoined(dto: PeerJoinedEventDTO) {
        const voiceState: VoiceState = {
            userId: dto.userId,
            channelId: dto.channelId,
            bootId: dto.bootId,
            sfuInstance: dto.sfuInstance,
            isDeafened: dto.isDeafened,
            isMuted: dto.isMuted,
            sessionId: dto.sessionId,
            status: 'connected'
        };

        const redis = await this.redisService.getClient();
        const [outcome, previousChannelId] = await redis.eval(PEER_JOINED_SCRIPT, {
            keys: [
                this.getVoiceUserChannelKey(dto.userId),
                this.getVoiceStateKey(dto.channelId, dto.userId),
                this.getVoiceChannelKey(dto.channelId)
            ],
            arguments: [
                dto.userId,
                dto.channelId,
                dto.sessionId,
                JSON.stringify(voiceState)
            ]
        }) as [string, string?];

        await redis.sAdd(this.SFU_INSTANCE_KEY, dto.sfuInstance);

        if (previousChannelId) {
            const recipients: string[] = await this.channelsService.getChannelRecipients(previousChannelId);

            const payload: VoiceEventDTO = {
                channelId: previousChannelId,
                userId: dto.userId,
                type: VoiceEventType.VOICE_LEAVE,
                data: {
                    channelId: previousChannelId,
                    userId: dto.userId,
                } as VoiceStateDTO
            };


            this.gatewayMQ.emit(VOICE_UPDATE_EVENT, { recipients: recipients, data: payload } as Payload<VoiceEventDTO>);
        }

        if (outcome === 'duplicate' || outcome === 'reconnected') return;

        const recipients = await this.channelsService.getChannelRecipients(dto.channelId);

        await this.channelsService.handleDismissVoiceRing(dto.userId, dto.channelId);

        const payload: VoiceEventDTO = {
            channelId: dto.channelId,
            userId: dto.userId,
            type: VoiceEventType.VOICE_JOIN,
            data: {
                channelId: dto.channelId,
                userId: dto.userId,
                isMuted: dto.isMuted,
                isDeafened: dto.isDeafened
            } as VoiceStateDTO
        };

        this.gatewayMQ.emit(VOICE_UPDATE_EVENT, { recipients: recipients, data: payload } as Payload<VoiceEventDTO>);
    }

    async handlePeerLeft(dto: PeerLeftEventDTO) {
        const [outcome, remaining] = await this.runPeerLeftScript(dto, dto.reason);

        if (outcome === 'marked') await this.scheduleLeaveCheck(dto);
        if (outcome === 'removed') await this.onVoiceRemoved(dto.channelId, dto.userId, remaining);
    }

    private async runPeerLeftScript(dto: PeerLeftEventDTO, mode: 'left' | 'dropped' | 'check'): Promise<[string, number?]> {
        const redis = await this.redisService.getClient();
        const [outcome, remaining] = await redis.eval(PEER_LEFT_SCRIPT, {
            keys: [
                this.getVoiceUserChannelKey(dto.userId),
                this.getVoiceStateKey(dto.channelId, dto.userId),
                this.getVoiceChannelKey(dto.channelId)
            ],
            arguments: [
                dto.userId,
                dto.channelId,
                dto.sessionId,
                mode
            ]
        }) as [string, number?];

        return [outcome, remaining];

    }

    private async scheduleLeaveCheck(dto: PeerLeftEventDTO) {
        setTimeout(async () => {
            try {
                const [outcome, remaining] = await this.runPeerLeftScript(dto, 'check');
                if (outcome !== 'removed') return;

                await this.onVoiceRemoved(dto.channelId, dto.userId, remaining);
            } catch (error) {
                this.logger.error({ err: error }, 'Error when checking after grace period');
            }
        }, VOICE_GRACE_MS);
    }

    private async onVoiceRemoved(channelId: string, userId: string, remaining: number) {
        const recipients = await this.channelsService.getChannelRecipients(channelId);

        if (remaining === 0) {
            await this.channelsService.clearChannelVoiceRings(channelId);
        }

        const payload: VoiceEventDTO = {
            channelId: channelId,
            userId: userId,
            type: VoiceEventType.VOICE_LEAVE,
            data: {
                channelId,
                userId,
            } as VoiceStateDTO
        };

        this.gatewayMQ.emit(VOICE_UPDATE_EVENT, { recipients: recipients, data: payload } as Payload<VoiceEventDTO>);
    }

    async handleSfuStarted(dto: SfuStartedEventDTO) {
        const statesDropped = await this.dropStatesOf(dto.sfuInstance, dto.bootId);
        this.logger.log({ sfuInstance: dto.sfuInstance, bootId: dto.bootId, dropped: statesDropped }, 'SFU started');
    }

    private async dropStatesOf(sfuInstance: string, exceptBootId?: string) {
        const redis = await this.redisService.getClient();

        const keys = new Set<string>();

        for await (const key of redis.scanIterator({ MATCH: 'voice:state:*', COUNT: 100 })) {
            keys.add(key);
        }

        const staleStates: VoiceState[] = [];
        const all = [...keys];

        for (let i = 0; i < all.length; i += 100) {
            const batch = all.slice(i, i + 100);
            const raws = await redis.mGet(batch);
            raws.forEach((raw, idx) => {
                if (!raw) return;

                try {
                    const state: VoiceState = JSON.parse(raw);

                    if (state.sfuInstance === sfuInstance && state.bootId !== exceptBootId) {
                        staleStates.push(state);
                    }
                } catch (error) {
                    this.logger.warn({ err: error, key: batch[idx] }, 'Unparsable voice state, skipping');
                }
            })
        }

        const promises: Promise<void>[] = [];
        for (const state of staleStates) {
            promises.push(this.handlePeerLeft({
                userId: state.userId,
                channelId: state.channelId,
                sessionId: state.sessionId,
                reason: 'dropped',
                at: Date.now()
            }));
        }
        const results = await Promise.allSettled(promises);
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed.length > 0) {
            this.logger.error({ errs: failed.map(f => f.reason), failed: failed.length, total: staleStates.length }, 'Some SFU-restart drops failed');
            throw new Error(`${failed.length}/${staleStates.length} drops failed`);
        }

        return staleStates.length;
    }

    async handleSfuHeartbeat(dto: SfuHeartbeatEventDTO) {
        const redis = await this.redisService.getClient();

        await redis.setEx(this.getSfuHeartbeatKey(dto.sfuInstance), SFU_HEARTBEAT_EXP_S, dto.bootId);
        await redis.sAdd(this.SFU_INSTANCE_KEY, dto.sfuInstance);
    }

    private getSfuHeartbeatKey(sfuInstance: string) {
        return `sfu:alive:${sfuInstance}`;
    }

    private getVoiceChannelKey(channelId: string) {
        return `voice:channel:${channelId}`;
    }

    private getVoiceStateKey(channelId: string, userId: string) {
        return `voice:state:${channelId}:${userId}`
    }

    private getVoiceUserChannelKey(userId: string) {
        return `voice:user:${userId}`;
    }

    private toVoiceStateDTO(state: VoiceState): VoiceStateDTO {
        return {
            channelId: state.channelId,
            userId: state.userId,
            isDeafened: state.isDeafened,
            isMuted: state.isMuted
        };
    }

    private async sweepSfu() {
        if (this.sweeping) return;

        this.sweeping = true;
        try {
            const redis = await this.redisService.getClient();

            const sfuInstances = await redis.sMembers(this.SFU_INSTANCE_KEY);

            for (const sfu of sfuInstances) {
                if (!(await redis.get(this.getSfuHeartbeatKey(sfu)))) {
                    await this.dropStatesOf(sfu);
                    await redis.sRem(this.SFU_INSTANCE_KEY, sfu);
                }
            }
        } catch (error) {
            this.logger.error({ err: error }, 'SFU sweep failed')
        }
        finally {
            this.sweeping = false;
        }
    }

    onModuleInit() {
        this.sweepTimer = setInterval(() => this.sweepSfu(), SWEEP_SFU_INTERVAL_MS);
    }

    onModuleDestroy() {
        if (this.sweepTimer) clearInterval(this.sweepTimer);
    }

}