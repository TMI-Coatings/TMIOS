import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seedSql } from "../../scripts/make-seed-sql";

/**
 * A throwaway local Postgres database with the migrations and sample seed applied.
 * Point TEST_DATABASE_URL at a local server. Refuses anything that looks like a hosted
 * Supabase project (hard rule 1: never touch tmi-ops-prod).
 */
export const TEST_WEEK = "2026-10-30";
/** The tests pretend today is the Monday of that week, whatever the real date is. */
export const TEST_TODAY = "2026-10-26";
const BASE = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
if (/supabase\.(co|com)|tmi-ops-prod|pooler/i.test(BASE)) throw new Error("Database tests only run against a local Postgres.");

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function freshDatabase(): Promise<{ db: pg.Client; close: () => Promise<void> }> {
  const name = `tmi_ops_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: BASE });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const url = new URL(BASE);
  url.pathname = "/" + name;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(readFileSync(root + "tests/db/supabase-shim.sql", "utf8"));
  for (const f of readdirSync(root + "supabase/migrations").sort()) {
    await db.query(readFileSync(root + "supabase/migrations/" + f, "utf8"));
  }
  await db.query(`alter database ${name} set app.today = '${TEST_TODAY}'`);
  await db.query(`set app.today = '${TEST_TODAY}'`);
  await db.query(seedSql(TEST_WEEK));
  // Sign every sample user in: an auth user per app user, linked by id.
  await db.query(`insert into auth.users (id, email) select id, email from public.app_users`);
  await db.query(`update public.app_users set auth_user_id = id`);
  return {
    db,
    close: async () => {
      await db.end();
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}

export type Result = { ok: true; rows: any[]; rowCount: number } | { ok: false; error: string; code?: string };

/** Run statements as a signed-in user, inside a transaction that is always rolled back. */
export async function asUser(db: pg.Client, userId: string | null, email: string, fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<pg.QueryResult | void>): Promise<Result> {
  await db.query("begin");
  try {
    await db.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId, email, role: "authenticated" } : { role: "anon" })]);
    const r = await fn((sql, params) => db.query(sql, params as any[]));
    return { ok: true, rows: r?.rows ?? [], rowCount: r?.rowCount ?? 0 };
  } catch (e: any) {
    return { ok: false, error: e.message, code: e.code };
  } finally {
    await db.query("rollback");
  }
}
