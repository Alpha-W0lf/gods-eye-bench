/**
 * The reference agent: no model. It makes each question's reference tool
 * calls through the replay server and reads the answer from their results,
 * the way a careful agent would. It must score 100% (ADR 0003).
 */

import { performance } from 'node:perf_hooks';
import { connectMcp } from '../mcpClient.js';
import { TEMPLATES } from '../questions/catalog.js';
import { toolStatus } from '../questions/template.js';
import { BENCH_VERSION } from '../config.js';

export default {
  name: 'reference',
  async describe() {
    return { name: 'gods-eye-bench reference agent', version: BENCH_VERSION };
  },
  async run({ question, mcpServer }) {
    const started = performance.now();
    const client = await connectMcp(mcpServer);
    try {
      const template = TEMPLATES[question.template];
      const results = [];
      for (const [name, args] of template.plan(question.params))
        results.push(
          await client.callTool(
            name,
            typeof args === 'function' ? args(results) : args,
          ),
        );
      const status = toolStatus(results);
      const answer =
        status === 'unavailable'
          ? null
          : template.read(results, question.params);
      return {
        finalText: `ANSWER: ${JSON.stringify({ answer, data_status: status })}`,
        usage: null,
        durationMs: Math.round(performance.now() - started),
        harnessToolCalls: [],
        rawLog: null,
      };
    } finally {
      client.close();
    }
  },
};
