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

/** Everything that has to be set for a connection to be possible. */
function getStoreDatabaseConfig() {
  return {
    bastionHost: getRequiredEnv('BASTION_HOST'),
    bastionUsername: getRequiredEnv('BASTION_USERNAME'),
    sshKey: getRequiredEnv('BASTION_SSH_KEY'),
    databaseHost: getRequiredEnv('STORE_PRODUCTION_READ_HOST'),
    databaseUsername: getRequiredEnv('STORE_PRODUCTION_READ_USERNAME'),
    password: getRequiredEnv('STORE_PRODUCTION_READ_PASSWORD'),
    database: getRequiredEnv('STORE_PRODUCTION_READ_DATABASE'),
  };
}

/**
 * The part of a mysql2 connection a query needs. Narrowing it keeps the connection's
 * lifecycle the business of `queryStoreDatabase`, which is what tears it down.
 */
export type StoreConnection = Pick<Connection, 'execute'>;

/**
 * Runs a callback against the MUI store production database, reached by forwarding
 * a channel through the SSH bastion. The connection and the SSH client are always
 * torn down, including when the callback throws.
 */
export async function queryStoreDatabase<T>(
  execute: (connection: StoreConnection) => Promise<T>,
): Promise<T> {
  const {
    bastionHost,
    bastionUsername,
    sshKey,
    databaseHost,
    databaseUsername,
    password,
    database,
  } = getStoreDatabaseConfig();

  const [{ Client }, mysql] = await Promise.all([import('ssh2'), import('mysql2/promise')]);

  const ssh = new Client();

  // The handshake is inside the try: a rejected key or an unreachable bastion would
  // otherwise leave the client behind, and this path is reachable by anonymous callers.
  try {
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

    // mysql2 reports a fatal socket failure by emitting 'error' on the connection when
    // no query is waiting for it. Unhandled, an EventEmitter 'error' takes the whole
    // server down rather than this one request, and tearing the tunnel down below is
    // exactly the moment that can happen.
    connection.on('error', () => {});

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
