import { Channel } from "src/channels/entities/channel.entity";
import { Guild } from "src/guilds/entities/guild.entity";
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";

@Entity()
export class Invite {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({unique: true})
    code: string;

    @Column({name: 'inviter_id'})
    inviterId: string;

    @Column({name: 'channel_id'})
    channelId: string;
    
    @Column({name: 'guild_id', nullable: true})
    guildId?: string;

    @Column({name: 'max_age', nullable: true})
    maxAge?: number;
    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @Column({name: 'expired_at', nullable: true})
    expiresAt?: Date;

    @ManyToOne(() => Channel, (channel) => channel.invites, {onDelete: 'CASCADE', onUpdate: 'CASCADE'})
    @JoinColumn({name: 'channel_id'})
    channel: Channel;

    @ManyToOne(() => Guild, (guild) => guild.invites, { nullable: true, onDelete: 'CASCADE', onUpdate: 'CASCADE' })
    @JoinColumn({name: 'guild_id'})
    guild?: Guild;
}
