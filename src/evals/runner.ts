import fs from 'fs';
import path from 'path';
import { llmService, ToolCall } from '../services/llm.service.js';
import { User } from '../db/user.repo.js';

export interface EvalCase {
  id: string;
  text: string;
  category: string;
  expect: {
    tool: string;
    title_has?: string;
    text_has?: string;
    content_has?: string;
    query_has?: string;
    text_hint?: string;
    time_is_explicit?: boolean;
  };
}

export interface EvalResult {
  total: number;
  passed: number;
  failed: number;
  accuracy: number;
  categoryScores: Record<string, { total: number; passed: number; accuracy: number }>;
  failures: Array<{ id: string; text: string; expected: string; received: string }>;
}

export class EvalRunner {
  loadDataset(filePath?: string): EvalCase[] {
    const target = filePath || path.resolve(process.cwd(), 'src/evals/evals.jsonl');
    const content = fs.readFileSync(target, 'utf8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  }

  async run(cases: EvalCase[], mockUser: User): Promise<EvalResult> {
    let passed = 0;
    const failures: EvalResult['failures'] = [];
    const catMap: Record<string, { total: number; passed: number }> = {};

    const openTasks = [
      { id: '101', title: 'Submit DBMS assignment' },
      { id: '102', title: 'Math quiz preparation' },
    ];

    for (const c of cases) {
      if (!catMap[c.category]) catMap[c.category] = { total: 0, passed: 0 };
      catMap[c.category].total += 1;

      try {
        const res = await llmService.interpret(mockUser, c.text, openTasks);
        const matched = this.evaluateCase(c, res.toolCalls);

        if (matched) {
          passed += 1;
          catMap[c.category].passed += 1;
        } else {
          failures.push({
            id: c.id,
            text: c.text,
            expected: JSON.stringify(c.expect),
            received: JSON.stringify(res.toolCalls),
          });
        }
      } catch (err: any) {
        failures.push({
          id: c.id,
          text: c.text,
          expected: JSON.stringify(c.expect),
          received: `ERROR: ${err.message}`,
        });
      }
    }

    const categoryScores: EvalResult['categoryScores'] = {};
    for (const [k, v] of Object.entries(catMap)) {
      categoryScores[k] = {
        total: v.total,
        passed: v.passed,
        accuracy: Math.round((v.passed / v.total) * 100),
      };
    }

    return {
      total: cases.length,
      passed,
      failed: cases.length - passed,
      accuracy: Math.round((passed / cases.length) * 100),
      categoryScores,
      failures,
    };
  }

  private evaluateCase(c: EvalCase, tools: ToolCall[]): boolean {
    if (tools.length === 0) return false;
    const exp = c.expect;

    const tool = tools.find((t) => t.name === exp.tool);
    if (!tool) {
      // create_task and create_reminder can cross-fulfill task requests
      if (exp.tool === 'create_task' && tools.some((t) => t.name === 'create_reminder')) {
        const rTool = tools.find((t) => t.name === 'create_reminder')!;
        return !exp.title_has || (rTool.args.text || '').toLowerCase().includes(exp.title_has.toLowerCase());
      }
      return false;
    }

    if (exp.title_has) {
      const title = (tool.args.title || tool.args.text || '').toLowerCase();
      if (!title.includes(exp.title_has.toLowerCase())) return false;
    }

    if (exp.content_has) {
      const content = `${tool.args.title || ''} ${tool.args.content || ''}`.toLowerCase();
      if (!content.includes(exp.content_has.toLowerCase())) return false;
    }

    if (exp.query_has) {
      const q = (tool.args.query || '').toLowerCase();
      if (!q.includes(exp.query_has.toLowerCase())) return false;
    }

    if (exp.time_is_explicit !== undefined) {
      if (tool.args.time_is_explicit !== exp.time_is_explicit) return false;
    }

    return true;
  }
}

export const evalRunner = new EvalRunner();
