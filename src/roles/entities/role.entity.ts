import { Guild } from "src/guilds/entities/guild.entity";
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Role {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({
        type: 'bigint',
        default: 0,
        transformer: {
            to: (value?: bigint | null): string | null => {
                if (value === null || value === undefined) return null;
                return value.toString();
            },
            from: (value?: string | null): bigint | null => {
                if (value === null || value === undefined) return BigInt(0);
                return BigInt(value);
            },
        },
    })
    permissions: bigint;

    @Column({ default: 0 })
    position: number;

    @Column({ name: 'is_hoisted', default: false })
    isHoisted: boolean;

    @Column({nullable: true})
    color?: number

    @Column({ name: 'guild_id' })
    guildId: string;

    @ManyToOne(() => Guild, g => g.roles, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
    @JoinColumn({ name: 'guild_id' })
    guild: Guild;

}
