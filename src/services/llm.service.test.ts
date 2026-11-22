import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { llmService } from './llm.service.js';
import { userRepo } from '../db/user.repo.js';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

describe('LLM Service Tool-Calling Pipeline (Groq)', () => {
  const testUserId = 882233;
  let userObj: any;

  beforeEach(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    const { user } = await userRepo.findOrCreate(testUserId, testUserId, 'Aman', 'en');
    await userRepo.setOnboardingState(user.id, 'ACTIVE');
    userObj = user;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE telegram_user_id = $1', [String(testUserId)]);
    await pool.end();
  });

  it('extracts create_task tool call from deadline message', async () => {
    const result = await llmService.interpret(
      userObj,
      'Submit DBMS assignment by Friday 6pm'
    );

    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    const taskCall = result.toolCalls.find((t) => t.name === 'create_task' || t.name === 'create_reminder');
    expect(taskCall).toBeDefined();

    const titleOrText = taskCall?.args.title || taskCall?.args.text;
    expect(titleOrText.toLowerCase()).toContain('dbms');

    // Verify call logged to llm_calls table
    const logRes = await pool.query('SELECT * FROM llm_calls WHERE user_id = $1', [userObj.id]);
    expect(logRes.rowCount).toBeGreaterThanOrEqual(1);
    expect(logRes.rows[0].model).toBe(config.llm.model);
  }, 30000);

  it('extracts save_note tool call for thoughts without deadlines', async () => {
    const result = await llmService.interpret(
      userObj,
      'Great article on distributed databases https://martin.kleppmann.com'
    );

    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    const noteCall = result.toolCalls.find((t) => t.name === 'save_note');
    expect(noteCall).toBeDefined();
    const textInNote = `${noteCall?.args.title || ''} ${noteCall?.args.content || ''}`;
    expect(textInNote).toContain('distributed databases');
  }, 30000);

  it('detects out_of_scope tool call for chit-chat', async () => {
    const result = await llmService.interpret(
      userObj,
      'Tell me a funny joke about programming'
    );

    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    const oosCall = result.toolCalls.find((t) => t.name === 'out_of_scope');
    expect(oosCall).toBeDefined();
  }, 30000);
});
