import { Guild } from "src/guilds/entities/guild.entity";
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { ChannelType } from "../enums/channel-type.enum";
import { ChannelRecipient } from "./channel-recipient.entity";
import { UserChannelState } from "./user-channel-state.entity";
import { Invite } from "src/invites/entities/invite.entity";
import { PermissionOverwrite } from "./permission-overwrite.entity";

@Entity()
export class Channel {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ nullable: true })
    name?: string;

    @Column({ name: 'owner_id' })
    ownerId: string;

    @Column({
        type: 'enum',
        enum: ChannelType,
        default: ChannelType.Text
    })
    type: ChannelType;

    @Column({ name: 'parent_id', nullable: true })
    parentId?: string;

    @Column({ name: 'guild_id', nullable: true })
    guildId: string;

    @Column({ name: 'last_message_id', nullable: true })
    lastMessageId?: string;

    @Column({name: 'is_synced', default: true})
    isSynced: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @ManyToOne(() => Channel, (channel) => channel.children, { nullable: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
    @JoinColumn({ name: 'parent_id' })
    parent?: Channel;

    @OneToMany(() => Channel, (channel) => channel.parent, { nullable: true })
    children?: Channel[];

    @ManyToOne(() => Guild, (guild) => guild.channels, { nullable: true, onDelete: 'CASCADE', onUpdate: 'CASCADE' })
    @JoinColumn({ name: 'guild_id' })
    guild?: Guild;

    @OneToMany(() => ChannelRecipient, (recipient) => recipient.channel)
    recipients: ChannelRecipient[];

    @OneToMany(() => UserChannelState, (userChannelState) => userChannelState.channel)
    userChannelState: UserChannelState[];

    @OneToMany(() => Invite, (invite) => invite.channel)
    invites: Invite[];

    @OneToMany(() => PermissionOverwrite, (po) => po.channel)
    permissionOverwrites: PermissionOverwrite[];
}