import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { importPKCS8, CryptoKey, SignJWT } from 'jose'

@Injectable()
export class VoiceTicketService implements OnModuleInit {
    private key: CryptoKey

    constructor(
        private readonly config: ConfigService
    ) { }
    async onModuleInit() {
        const pem = Buffer.from(this.config.getOrThrow<string>('SFU_TICKET_PRIVATE_KEY'), 'base64').toString();
        this.key = await importPKCS8(pem, 'ES256');
    }

    sign(userId: string, channelId: string) {
        return new SignJWT({ channelId })
            .setProtectedHeader({ alg: 'ES256', kid: 'voice-ticket-1' })
            .setIssuer('guild-service')
            .setAudience('sfu-service')
            .setIssuedAt()
            .setSubject(userId)
            .setExpirationTime('60s')
            .setJti(randomUUID())
            .sign(this.key);
    }
}
