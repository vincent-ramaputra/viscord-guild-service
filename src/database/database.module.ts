import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

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
                    ssl: process.env.NODE_ENV === "development"
                        ? { rejectUnauthorized: false }
                        : undefined,
                    entities: [
                        __dirname + '/../**/*.entity{.ts,.js}'
                    ],
                    synchronize: true,
                }
            }
        })
    ]
})

export class DatabaseModule { };
