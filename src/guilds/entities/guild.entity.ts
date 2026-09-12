import { Channel } from "src/channels/entities/channel.entity";
import { Column, CreateDateColumn, Entity, JoinColumn, JoinTable, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm"
import { GuildMember } from "./guild-members.entity";
import { Invite } from "src/invites/entities/invite.entity";
import { Role } from "src/roles/entities/role.entity";

@Entity()
export class Guild {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({ name: 'owner_id' })
    ownerId: string;

    @Column({ name: 'icon_url', nullable: true})
    iconURL?: string;

    @Column({default: false})
    isPrivate: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @OneToMany(() => GuildMember, (member) => member.guild)
    members: GuildMember[];

    @OneToMany(() => Channel, (channel) => channel.guild)
    channels: Channel[];

    @OneToMany(() => Invite, (invite) => invite.guild)
    invites: Invite[];

    @OneToMany(() => Role, (role) => role.guild)
    roles: Role[];
}