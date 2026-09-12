import { AttachmentResponseDTO } from "./attachment-response.dto"

export class MessageResponseDTO {
    id: string

    senderId: string

    content: string

    channelId: string

    is_pinned: boolean

    createdAt: Date

    updatedAt: Date


    mentions: string[]

    attachments: AttachmentResponseDTO[]
}