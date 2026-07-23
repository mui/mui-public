import mysql from 'mysql2/promise';
import SSH2Promise from 'ssh2-promise';

export type QueryStoreDatabaseExecute = (connection: mysql.Connection) => Promise<any>;

export async function queryStoreDatabase(execute: QueryStoreDatabaseExecute) {
  if (!process.env.STORE_PRODUCTION_READ_PASSWORD) {
    throw new Error(`Env variable STORE_PRODUCTION_READ_PASSWORD not configured`);
  }
  if (!process.env.BASTION_SSH_KEY) {
    throw new Error(`Env variable BASTION_SSH_KEY not configured`);
  }

  const ssh = new SSH2Promise({
    host: process.env.BASTION_HOST,
    port: 22,
    username: process.env.BASTION_USERNAME,
    privateKey: process.env.BASTION_SSH_KEY.replace(/\\n/g, '\n'),
  });

  const tunnel = await ssh.addTunnel({
    remoteAddr: process.env.STORE_PRODUCTION_READ_HOST,
    remotePort: 3306,
  });

  const connection = await mysql.createConnection({
    host: 'localhost',
    port: tunnel.localPort,
    user: process.env.STORE_PRODUCTION_READ_USERNAME,
    password: process.env.STORE_PRODUCTION_READ_PASSWORD,
    database: process.env.STORE_PRODUCTION_READ_DATABASE,
  });

  try {
    return await execute(connection);
  } finally {
    await connection.end().catch((ex) => console.error(ex));
    await ssh.close().catch((ex) => console.error(ex));
  }
}
