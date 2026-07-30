import type { Connection } from 'mysql2/promise';
import type { ClientChannel } from 'ssh2';

// mysql2 and ssh2 are server-only, they are dynamically imported to avoid bundling issues.

/** Everything that has to be set for a connection to be possible. */
export const STORE_DATABASE_REQUIRED_ENV = [
  'BASTION_HOST',
  'BASTION_USERNAME',
  'BASTION_SSH_KEY',
  'STORE_PRODUCTION_READ_HOST',
  'STORE_PRODUCTION_READ_USERNAME',
  'STORE_PRODUCTION_READ_PASSWORD',
  'STORE_PRODUCTION_READ_DATABASE',
];

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
  const [bastionHost, bastionUsername, sshKey, databaseHost, databaseUsername, password, database] =
    STORE_DATABASE_REQUIRED_ENV.map(getRequiredEnv);

  const [{ Client }, mysql] = await Promise.all([import('ssh2'), import('mysql2/promise')]);

  const ssh = new Client();
  await new Promise<void>((resolve, reject) => {
    ssh
      .on('ready', () => resolve())
      .on('error', reject)
      .connect({
        host: bastionHost,
        port: 22,
        username: bastionUsername,
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
      user: databaseUsername,
      password,
      database,
    });

    try {
      return await execute(connection);
    } finally {
      // destroy() rather than end(): the SSH transport goes away on the next line, so
      // there is no point spending a round trip on a polite MySQL goodbye.
      connection.destroy();
    }
  } finally {
    ssh.end();
  }
}
