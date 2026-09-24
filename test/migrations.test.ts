import { applyD1Migrations, env } from 'cloudflare:test';
import { expect, it } from 'vitest';

// Runs against a database of its own so it can stop partway through the migrations.
it('0002 moves existing Hexaduck scores and runs onto the per-game tables', async () => {
  const db = env.MIGRATION_DB;
  const [first, ...rest] = env.TEST_MIGRATIONS;
  expect(first.name).toBe('0001_leaderboard.sql');
  await applyD1Migrations(db, [first]);
  await db.batch([
    db.prepare("INSERT INTO scores (mode, name, time_ms, created_at) VALUES (0, 'Mallard', 12345, 1), (2, 'Teal', 999, 2)"),
    db.prepare("INSERT INTO runs (id, mode, started_at, used) VALUES ('r1', 1, 100, 1)"),
  ]);

  await applyD1Migrations(db, rest);

  const scores = await db.prepare('SELECT game, mode, name, score, created_at FROM scores ORDER BY mode').all();
  expect(scores.results).toEqual([
    { game: 'hexaduck', mode: 0, name: 'Mallard', score: 12345, created_at: 1 },
    { game: 'hexaduck', mode: 2, name: 'Teal', score: 999, created_at: 2 },
  ]);
  const runs = await db.prepare('SELECT id, game, mode, started_at, used FROM runs').all();
  expect(runs.results).toEqual([{ id: 'r1', game: 'hexaduck', mode: 1, started_at: 100, used: 1 }]);
  // The name should still be case-insensitive after the rebuild.
  const hit = await db.prepare("SELECT name FROM scores WHERE game = 'hexaduck' AND mode = 0 AND name = 'MALLARD'").first();
  expect(hit).toEqual({ name: 'Mallard' });
});
