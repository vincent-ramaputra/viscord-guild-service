import { TlsOptions } from 'tls';

/**
 * DB_SSL=true                        -> enable TLS to Postgres
 * DB_SSL_REJECT_UNAUTHORIZED=false   -> skip server cert validation (only when DB_SSL=true)
 */
export function getDbSslConfig(): TlsOptions | false {
    if (process.env.DB_SSL !== 'true') {
        return false;
    }

    return {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
}
