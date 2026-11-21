import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

test('advertised agent MCP inputs match board and proposal engine limits', async () => {
  const client = new Client({ name: 'contract-regression', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('packages/mcp/dist/server.js')], stderr: 'pipe' }));
  try {
    const { tools } = await client.listTools();
    for (const name of ['spark_list_missions', 'spark_list_open_tasks', 'spark_list_publications', 'spark_discover_missions', 'spark_discover_tasks', 'spark_discover_publications', 'spark_get_mission', 'spark_get_decision_gate', 'spark_read_board']) {
      const fields = tools.find(tool => tool.name === name).inputSchema.properties;
      assert.equal(fields.limit.maximum, 50, `${name} must cap reads`);
      assert.ok(fields.cursor, `${name} must expose continuation`);
    }
    for (const name of ['spark_post_board_entry', 'spark_reply_to_board_entry']) {
      const fields = tools.find(tool => tool.name === name).inputSchema.properties;
      assert.equal(fields.summary.maxLength, 200);
      assert.equal(fields.details.maxLength, 1000);
      assert.equal(fields.tags.maxItems, 5);
      assert.equal(fields.evidence.items.properties.summary.maxLength, 200);
    }
    const proposal = tools.find(tool => tool.name === 'spark_submit_decision_proposal').inputSchema.properties;
    assert.equal(proposal.summary.maxLength, 1000);
    const ballot = tools.find(tool => tool.name === 'spark_submit_decision_ballot').inputSchema.properties;
    assert.equal(ballot.rationale.maxLength, 500);
    assert.ok(!ballot.rankedProposalIds.minItems);
  } finally { await client.close(); }
});
