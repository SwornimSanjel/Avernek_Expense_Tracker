import { Pool, type QueryResultRow } from "pg";

/**
 * Direct Postgres access. No PostgREST, no Supabase, no network hop to a third
 * party — the app talks to its own database with credentials from .env.
 *
 * NOT usable from middleware: `pg` needs Node APIs and middleware runs on the
 * edge runtime. Middleware verifies the signed session cookie instead, which is
 * why sign-in state costs zero queries per request.
 */

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is missing. Expected postgres://user:password@host:5432/dbname"
    );
  }

  return new Pool({
    connectionString,
    // Managed Postgres usually presents a certificate that is not in Node's
    // trust store. DATABASE_SSL=true keeps the transport encrypted without
    // demanding a chain we cannot verify.
    ssl:
      process.env.DATABASE_SSL?.trim() === "true"
        ? { rejectUnauthorized: false }
        : undefined,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

// Next.js reloads modules on every edit in dev; without this the pool is
// recreated each time until Postgres runs out of connections.
const globalForPool = globalThis as unknown as { __avernekPool?: Pool };

/**
 * The pool is built on first use, never at import.
 *
 * `next build` imports every route module to collect page data. Constructing
 * the pool at module scope made the build demand a live DATABASE_URL, so the
 * image could not be built without production credentials. Deferring it means
 * the build needs no secrets at all.
 */
export function getPool(): Pool {
  if (!globalForPool.__avernekPool) {
    const pool = createPool();

    // An idle client erroring (server restart, network blip) surfaces here.
    // With no listener, Node treats it as unhandled and kills the process.
    pool.on("error", (error) => {
      console.error("[db] idle client error:", error.message);
    });

    globalForPool.__avernekPool = pool;
  }

  return globalForPool.__avernekPool;
}

/** Run a query and return every row. Always use $1/$2 params, never interpolation. */
export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

/** Run a query expecting at most one row. */
export async function one<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run a statement and return how many rows it affected. */
export async function exec(
  text: string,
  params: unknown[] = []
): Promise<number> {
  const result = await getPool().query(text, params);
  return result.rowCount ?? 0;
}

type Row = Record<string, unknown>;
type Queryable = { query: (text: string, params?: unknown[]) => Promise<unknown> };

/** Quote an identifier so a column named e.g. "source" cannot collide with a keyword. */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Insert one or more rows, taking columns from the first row's keys.
 *
 * Rows are written from object literals assembled out of form data, so the
 * column list is not known statically. Values still go through $n placeholders;
 * only the identifiers are interpolated, and those come from code, never input.
 */
export async function insertRows(
  table: string,
  rows: Row[],
  client?: Queryable
): Promise<void> {
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0]);
  const params: unknown[] = [];

  const tuples = rows.map((row) => {
    const placeholders = columns.map((column) => {
      params.push(row[column] ?? null);
      return `$${params.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const text = `insert into ${table} (${columns.map(ident).join(", ")}) values ${tuples.join(", ")}`;

  if (client) await client.query(text, params);
  else await exec(text, params);
}

/** Update a single row by id from a patch object. */
export async function updateRow(
  table: string,
  patch: Row,
  id: string,
  client?: Queryable
): Promise<void> {
  const columns = Object.keys(patch);
  if (columns.length === 0) return;

  const params: unknown[] = [];
  const assignments = columns.map((column) => {
    params.push(patch[column] ?? null);
    return `${ident(column)} = $${params.length}`;
  });

  params.push(id);
  const text = `update ${table} set ${assignments.join(", ")} where id = $${params.length}`;

  if (client) await client.query(text, params);
  else await exec(text, params);
}

/**
 * Run several statements as one transaction, rolling back on any throw.
 * Used where a write spans tables — an expense and its shares must both land
 * or neither, otherwise the split no longer sums to the total.
 */
export async function transaction<T>(
  fn: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
