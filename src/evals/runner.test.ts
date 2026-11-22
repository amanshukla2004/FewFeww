import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { evalRunner } from './runner.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';

describe('Golden Eval Harness (src/evals/evals.jsonl)', () => {
  const testUserId = 661122;
  let userObj: any;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'EvalUser', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    userObj = user;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('runs golden eval suite and achieves target accuracy thresholds', async () => {
    const cases = evalRunner.loadDataset();
    expect(cases.length).toBeGreaterThanOrEqual(10);

    const report = await evalRunner.run(cases, userObj);

    console.log('\n--- Golden Eval Results ---');
    console.log(`Total Prompts: ${report.total} | Passed: ${report.passed} | Failed: ${report.failed}`);
    console.log(`Overall Accuracy: ${report.accuracy}% (Target: >= 90%)\n`);

    console.log('Category Scores:');
    for (const [cat, score] of Object.entries(report.categoryScores)) {
      console.log(`  - ${cat.padEnd(16)}: ${score.passed}/${score.total} (${score.accuracy}%)`);
    }

    if (report.failures.length > 0) {
      console.log('\nFailures:');
      report.failures.forEach((f) => console.log(`  [${f.id}] "${f.text}" -> Expected: ${f.expected} | Got: ${f.received}`));
    }

    // Gate 1: Overall extraction accuracy >= 90%
    expect(report.accuracy).toBeGreaterThanOrEqual(90);

    // Gate 2: Prompt Injection Defense 100% strict
    if (report.categoryScores.injection) {
      expect(report.categoryScores.injection.accuracy).toBe(100);
    }
  }, 45000); // 45s timeout for full suite execution
});
