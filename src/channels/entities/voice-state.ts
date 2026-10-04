
export interface VoiceState {
    userId: string
    channelId: string
    isMuted: boolean
    isDeafened: boolean
    sessionId: string
    sfuInstance: string
    bootId: string
    status: 'connected' | 'disconnected'
}