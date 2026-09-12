import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1789215531211 implements MigrationInterface {
    name = 'InitialSchema1789215531211'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "channel_recipient" ("channel_id" uuid NOT NULL, "user_id" uuid NOT NULL, CONSTRAINT "PK_ecc37fdebfecdff8bc7c0c159cc" PRIMARY KEY ("channel_id", "user_id"))`);
        await queryRunner.query(`CREATE TABLE "user_channel_state" ("channel_id" uuid NOT NULL, "user_id" uuid NOT NULL, "last_read_id" character varying, CONSTRAINT "PK_070767db619cd129382df309dfb" PRIMARY KEY ("channel_id", "user_id"))`);
        await queryRunner.query(`CREATE TABLE "invite" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "inviter_id" character varying NOT NULL, "channel_id" uuid NOT NULL, "guild_id" uuid, "max_age" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "expired_at" TIMESTAMP, CONSTRAINT "UQ_ffbbc5bbb052814e22a0c525ff4" UNIQUE ("code"), CONSTRAINT "PK_fc9fa190e5a3c5d80604a4f63e1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."permission_overwrite_target_type_enum" AS ENUM('MEMBER', 'ROLE')`);
        await queryRunner.query(`CREATE TABLE "permission_overwrite" ("allow" bigint NOT NULL DEFAULT '0', "deny" bigint NOT NULL DEFAULT '0', "target_id" character varying NOT NULL, "target_type" "public"."permission_overwrite_target_type_enum" NOT NULL, "channel_id" uuid NOT NULL, CONSTRAINT "UQ_15adbe4ebe503ea27d9387bb31e" UNIQUE ("channel_id", "target_id"), CONSTRAINT "PK_15adbe4ebe503ea27d9387bb31e" PRIMARY KEY ("target_id", "channel_id"))`);
        await queryRunner.query(`CREATE TYPE "public"."channel_type_enum" AS ENUM('0', '1', '2', '3')`);
        await queryRunner.query(`CREATE TABLE "channel" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying, "owner_id" character varying NOT NULL, "type" "public"."channel_type_enum" NOT NULL DEFAULT '0', "parent_id" uuid, "guild_id" uuid, "last_message_id" character varying, "is_synced" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_590f33ee6ee7d76437acf362e39" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "guild_member" ("guildId" uuid NOT NULL, "userId" uuid NOT NULL, "joinedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_59e0756d90604968396baa9bbb5" PRIMARY KEY ("guildId", "userId"))`);
        await queryRunner.query(`CREATE TABLE "guild" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "owner_id" character varying NOT NULL, "icon_url" character varying, "isPrivate" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_cfbbd0a2805cab7053b516068a3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "role" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "permissions" bigint NOT NULL DEFAULT '0', "position" integer NOT NULL DEFAULT '0', "is_hoisted" boolean NOT NULL DEFAULT false, "color" integer, "guild_id" uuid NOT NULL, CONSTRAINT "PK_b36bcfe02fc8de3c57a8b2391c2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "guild_member_roles_role" ("guildMemberGuildId" uuid NOT NULL, "guildMemberUserId" uuid NOT NULL, "roleId" uuid NOT NULL, CONSTRAINT "PK_79d0594327426daa8ecc70c87d2" PRIMARY KEY ("guildMemberGuildId", "guildMemberUserId", "roleId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_75a6fc89f66da4b46a7da50d5c" ON "guild_member_roles_role" ("guildMemberGuildId", "guildMemberUserId") `);
        await queryRunner.query(`CREATE INDEX "IDX_fe7726290539df40c44715e9ad" ON "guild_member_roles_role" ("roleId") `);
        await queryRunner.query(`ALTER TABLE "channel_recipient" ADD CONSTRAINT "FK_e8efeb72b3645e673436222e51d" FOREIGN KEY ("channel_id") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_channel_state" ADD CONSTRAINT "FK_1bb5b48431966ec4b52e5e50dc4" FOREIGN KEY ("channel_id") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "invite" ADD CONSTRAINT "FK_b28201fdc3612b5456557565e6c" FOREIGN KEY ("channel_id") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "invite" ADD CONSTRAINT "FK_9c5b38c4ba8ee79a99d8ca13c8b" FOREIGN KEY ("guild_id") REFERENCES "guild"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "permission_overwrite" ADD CONSTRAINT "FK_fc91f36602f0a41f8123b91edb6" FOREIGN KEY ("channel_id") REFERENCES "channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "channel" ADD CONSTRAINT "FK_5e08b71237b8c45e7781ebdb605" FOREIGN KEY ("parent_id") REFERENCES "channel"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "channel" ADD CONSTRAINT "FK_51e5d96fde242b5912290ad24ab" FOREIGN KEY ("guild_id") REFERENCES "guild"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "guild_member" ADD CONSTRAINT "FK_c6adfed3d6a7330d91a4f21ce1d" FOREIGN KEY ("guildId") REFERENCES "guild"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "role" ADD CONSTRAINT "FK_7f9e3b8f3390b95e6222cc0c334" FOREIGN KEY ("guild_id") REFERENCES "guild"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "guild_member_roles_role" ADD CONSTRAINT "FK_75a6fc89f66da4b46a7da50d5ca" FOREIGN KEY ("guildMemberGuildId", "guildMemberUserId") REFERENCES "guild_member"("guildId","userId") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "guild_member_roles_role" ADD CONSTRAINT "FK_fe7726290539df40c44715e9adb" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "guild_member_roles_role" DROP CONSTRAINT "FK_fe7726290539df40c44715e9adb"`);
        await queryRunner.query(`ALTER TABLE "guild_member_roles_role" DROP CONSTRAINT "FK_75a6fc89f66da4b46a7da50d5ca"`);
        await queryRunner.query(`ALTER TABLE "role" DROP CONSTRAINT "FK_7f9e3b8f3390b95e6222cc0c334"`);
        await queryRunner.query(`ALTER TABLE "guild_member" DROP CONSTRAINT "FK_c6adfed3d6a7330d91a4f21ce1d"`);
        await queryRunner.query(`ALTER TABLE "channel" DROP CONSTRAINT "FK_51e5d96fde242b5912290ad24ab"`);
        await queryRunner.query(`ALTER TABLE "channel" DROP CONSTRAINT "FK_5e08b71237b8c45e7781ebdb605"`);
        await queryRunner.query(`ALTER TABLE "permission_overwrite" DROP CONSTRAINT "FK_fc91f36602f0a41f8123b91edb6"`);
        await queryRunner.query(`ALTER TABLE "invite" DROP CONSTRAINT "FK_9c5b38c4ba8ee79a99d8ca13c8b"`);
        await queryRunner.query(`ALTER TABLE "invite" DROP CONSTRAINT "FK_b28201fdc3612b5456557565e6c"`);
        await queryRunner.query(`ALTER TABLE "user_channel_state" DROP CONSTRAINT "FK_1bb5b48431966ec4b52e5e50dc4"`);
        await queryRunner.query(`ALTER TABLE "channel_recipient" DROP CONSTRAINT "FK_e8efeb72b3645e673436222e51d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fe7726290539df40c44715e9ad"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_75a6fc89f66da4b46a7da50d5c"`);
        await queryRunner.query(`DROP TABLE "guild_member_roles_role"`);
        await queryRunner.query(`DROP TABLE "role"`);
        await queryRunner.query(`DROP TABLE "guild"`);
        await queryRunner.query(`DROP TABLE "guild_member"`);
        await queryRunner.query(`DROP TABLE "channel"`);
        await queryRunner.query(`DROP TYPE "public"."channel_type_enum"`);
        await queryRunner.query(`DROP TABLE "permission_overwrite"`);
        await queryRunner.query(`DROP TYPE "public"."permission_overwrite_target_type_enum"`);
        await queryRunner.query(`DROP TABLE "invite"`);
        await queryRunner.query(`DROP TABLE "user_channel_state"`);
        await queryRunner.query(`DROP TABLE "channel_recipient"`);
    }

}
