import type { Connection } from 'mysql2/promise';
import type { ClientChannel } from 'ssh2';

// mysql2 and ssh2 are server-only, they are dynamically imported to avoid bundling issues.

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Env variable ${name} not configured`);
  }
  return value;
}

/**
 * Runs a callback against the MUI store production database, reached by forwarding
 * a channel through the SSH bastion. The connection and the SSH client are always
 * torn down, including when the callback throws.
 */
export async function queryStoreDatabase<T>(
  execute: (connection: Connection) => Promise<T>,
): Promise<T> {
  const sshKey = getRequiredEnv('BASTION_SSH_KEY');
  const password = getRequiredEnv('STORE_PRODUCTION_READ_PASSWORD');
  const databaseHost = getRequiredEnv('STORE_PRODUCTION_READ_HOST');

  const {
    BASTION_HOST,
    BASTION_USERNAME,
    STORE_PRODUCTION_READ_USERNAME,
    STORE_PRODUCTION_READ_DATABASE,
  } = process.env;

  const [{ Client }, mysql] = await Promise.all([import('ssh2'), import('mysql2/promise')]);

  const ssh = new Client();
  await new Promise<void>((resolve, reject) => {
    ssh
      .on('ready', () => resolve())
      .on('error', reject)
      .connect({
        host: BASTION_HOST,
        port: 22,
        username: BASTION_USERNAME,
        privateKey: sshKey.replace(/\\n/g, '\n'),
      });
  });

  try {
    // Forward a channel through the bastion to the database and hand it to mysql2
    // directly as its socket, so no local TCP port needs to be opened.
    const stream = await new Promise<ClientChannel>((resolve, reject) => {
      ssh.forwardOut('127.0.0.1', 0, databaseHost, 3306, (error, channel) =>
        error ? reject(error) : resolve(channel),
      );
    });

    const connection = await mysql.createConnection({
      stream,
      user: STORE_PRODUCTION_READ_USERNAME,
      password,
      database: STORE_PRODUCTION_READ_DATABASE,
    });

    try {
      return await execute(connection);
    } finally {
      try {
        await connection.end();
      } catch (error) {
        // Best effort: the SSH client is torn down next, which closes the channel anyway.
        console.error(error);
      }
    }
  } finally {
    ssh.end();
  }
}
