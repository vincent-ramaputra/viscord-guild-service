import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { getDbSslConfig } from './ssl.config';

export const dataSourceOptions: DataSourceOptions = {
    type: 'postgres',
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: getDbSslConfig(),
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    synchronize: false,
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
