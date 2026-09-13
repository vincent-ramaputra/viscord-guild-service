import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { getDbSslConfig } from "./ssl.config";

@Module({
    imports: [
        TypeOrmModule.forRootAsync({
            useFactory: () => {
                return {
                    type: 'postgres',
                    host: process.env.DB_HOST,
                    port: +process.env.DB_PORT,
                    username: process.env.DB_USER,
                    password: process.env.DB_PASSWORD,
                    database: process.env.DB_NAME,
                    ssl: getDbSslConfig(),
                    entities: [
                        __dirname + '/../**/*.entity{.ts,.js}'
                    ],
                    synchronize: false,
                    migrationsRun: true,
                    migrations: [__dirname + '/migrations/*{.ts,.js}'],
                    connectTimeoutMS: 10000
                }
            }
        })
    ]
})

export class DatabaseModule { };
