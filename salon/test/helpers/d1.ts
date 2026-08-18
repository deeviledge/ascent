import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// node:sqlite はまだ Vite の組み込みモジュール一覧に載っていないため、
// import 文だと解決に失敗する。require 経由で読む。
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof DatabaseSync>;

type Row = Record<string, unknown>;

/**
 * テスト用の最小 D1 互換シム。SQL 自体（UPSERT の上限ガードなど）を
 * 本物の SQLite に当てて検証するためのもの。
 */
class FakeStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, params);
  }

  async first<T = Row>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...(this.params as never[])) as T | undefined) ?? null;
  }

  async all<T = Row>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { meta: { changes: Number(result.changes) } };
  }
}

export type FakeD1 = {
  prepare(sql: string): FakeStatement;
  batch(statements: FakeStatement[]): Promise<unknown[]>;
};

export function createTestDb(
  schemaPath: URL = new URL('../../migrations/0001_init.sql', import.meta.url),
): FakeD1 {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(schemaPath, 'utf8'));
  return {
    prepare: (sql: string) => new FakeStatement(db, sql),
    batch: (statements: FakeStatement[]) => Promise.all(statements.map((s) => s.run())),
  };
}

export async function seedTenant(db: FakeD1, id = 'ten_1', quota = 3): Promise<void> {
  await db
    .prepare(
      'INSERT INTO tenants (id, name, ai_quota_monthly, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, 'テストサロン', quota, 0, 0)
    .run();
}
