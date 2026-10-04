import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AmqpConnectionManager, ChannelWrapper, connect } from 'amqp-connection-manager'
import { Channel, ConsumeMessage } from "amqplib";
import { SFU_QUEUE } from "src/constants/events";
import { plainToInstance } from 'class-transformer';
import { SfuEvent } from "./dto/sfu-event";
import { validate } from "class-validator";
import { PeerJoinedEventDTO } from "./dto/peer-joined-event.dto";
import { PeerLeftEventDTO } from "./dto/peer-left-event.dto";
import { ChannelsService } from "./channels.service";
import { SfuStartedEventDTO } from "./dto/sfu-started-event.dto";
import { SfuHeartbeatEventDTO } from "./dto/sfu-heartbeat-event.dto";
import { VoicePresenceService } from "./voice-presence.service";

@Injectable()
export class SfuEventConsumer implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(SfuEventConsumer.name);

    private channelWrapper?: ChannelWrapper;
    private connectionManager?: AmqpConnectionManager;

    constructor(
        private readonly config: ConfigService,
        private readonly channelsService: ChannelsService,
        private readonly voicePresenceService: VoicePresenceService
    ) { }

    async onModuleInit() {
        const url = `amqp://${this.config.getOrThrow('RMQ_HOST')}:${this.config.getOrThrow('RMQ_PORT')}`;

        this.connectionManager = connect(url, {
            heartbeatIntervalInSeconds: 30,
        });

        const wrapper = this.connectionManager.createChannel({
            json: false,
            setup: async (ch: Channel) => {
                await ch.assertQueue(SFU_QUEUE, { durable: true });

            }
        });
        this.channelWrapper = wrapper;

        await wrapper.consume(SFU_QUEUE, (msg) => this.onMessage(msg), { prefetch: 1, noAck: false });
    }

    private async onMessage(msg: ConsumeMessage) {
        try {
            const content = JSON.parse(msg.content.toString());
            const payload = await this.validateOrDrop(SfuEvent, content, msg);
            if (!payload) return;

            switch (payload.pattern) {
                case "peer_joined": {
                    const data = await this.validateOrDrop(PeerJoinedEventDTO, payload.data, msg);
                    if (!data) return;

                    try {
                        await this.voicePresenceService.handlePeerJoined(data);
                        this.logger.log({ event: data }, 'peer_joined message handled')
                        this.channelWrapper.ack(msg);
                    } catch (error) {
                        this.logger.error({ err: error }, 'Failed updating peer voice data');
                        setTimeout(() => this.channelWrapper.nack(msg, false, true), 1000);
                    }
                    break;
                }
                case "peer_left": {
                    const data = await this.validateOrDrop(PeerLeftEventDTO, payload.data, msg);
                    if (!data) return;

                    try {
                        await this.voicePresenceService.handlePeerLeft(data);
                        this.logger.log({ event: data }, 'peer_left message handled')
                        this.channelWrapper.ack(msg);
                    } catch (error) {
                        this.logger.error({ err: error }, 'Failed updating peer voice data');
                        setTimeout(() => this.channelWrapper.nack(msg, false, true), 1000);
                    }
                    break;
                }
                case "sfu_started": {
                    const data = await this.validateOrDrop(SfuStartedEventDTO, payload.data, msg);
                    if (!data) return;

                    try {
                        await this.voicePresenceService.handleSfuStarted(data);
                        this.logger.log({ event: data }, 'sfu_started message handled')
                        this.channelWrapper.ack(msg);
                    } catch (error) {
                        this.logger.error({ err: error }, 'Failed updating peer voice data');
                        setTimeout(() => this.channelWrapper.nack(msg, false, true), 1000);
                    }
                    break;
                }
                case "sfu_heartbeat": {
                    const data = await this.validateOrDrop(SfuHeartbeatEventDTO, payload.data, msg);
                    if (!data) return;

                    try {
                        await this.voicePresenceService.handleSfuHeartbeat(data);
                        this.logger.log({ event: data }, 'sfu_heartbeat message handled')
                        this.channelWrapper.ack(msg);
                    } catch (error) {
                        this.logger.error({ err: error }, 'Failed updating peer voice data');
                        setTimeout(() => this.channelWrapper.nack(msg, false, true), 1000);
                    }
                    break;
                }
                default: {
                    this.channelWrapper.nack(msg, false, false);
                    break;
                }
            }
        } catch (error) {
            this.logger.error({ err: error }, 'Failed consuming message');
            this.channelWrapper.nack(msg, false, false);
        }
    }

    private async validateOrDrop<T extends object>(cls: new () => T, plain: unknown, msg: ConsumeMessage): Promise<T | null> {
        const instance = plainToInstance(cls, plain);
        const errors = await validate(instance);

        if (errors.length === 0) return instance;

        this.logger.warn({
            errors: errors.map(e => ({ property: e.property, constraints: e.constraints })),
            content: msg.content.toString().slice(0, 500)
        }, 'Invalid SFU event');
        this.channelWrapper.nack(msg, false, false);
        return null;
    }

    async onModuleDestroy() {
        await this.channelWrapper?.close();
        await this.connectionManager?.close();
    }

}