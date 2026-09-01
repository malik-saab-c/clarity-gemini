const { test } = require('node:test');
const assert = require('node:assert');
process.env.CLARITY_TEST = '1';
const { safeCalc, makeZip, safePath, wsRoot, createThinkFilter, registerApproval, getApproval, clearApproval, executeApproval } = require('../server.js');
const fs = require('fs');
const path = require('path');

test('safeCalc handles arithmetic', () => { assert.equal(safeCalc('10 + 5 * 2'), 20); });
test('safeCalc rejects unsafe input', () => { assert.throws(() => safeCalc('process.exit()'), /allowed/); });
test('makeZip produces valid zip (PK magic + central dir)', () => {
  const zip = makeZip([{ name: 'a.txt', data: 'hello' }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});
test('safePath blocks traversal', () => { assert.throws(() => safePath('../etc/passwd'), /Invalid|escapes/); });
test('workspace dir exists', () => { assert.ok(fs.existsSync(wsRoot)); });
test('uploads dir exists', () => { assert.ok(fs.existsSync(path.join(wsRoot, 'uploads'))); });
test('provider registry includes gemini provider', () => {
  const { providers } = require('../server.js');
  assert.ok(providers.gemini);
});

test('createThinkFilter cleanly parses <think> tags into reasoning and delta', () => {
  let reasoning = '';
  let delta = '';
  const filter = createThinkFilter(
    (chunk) => { reasoning += chunk; },
    (chunk) => { delta += chunk; }
  );

  filter.push('<think>Thinking step 1... ');
  filter.push('step 2 completed.</think>Here is ');
  filter.push('the actual answer.');
  filter.end();

  assert.equal(reasoning, 'Thinking step 1... step 2 completed.');
  assert.equal(delta, 'Here is the actual answer.');
});

test('registerApproval, getApproval and clearApproval manage pending actions by approvalId', () => {
  const approval = registerApproval({
    type: 'write',
    path: 'sample.txt',
    content: 'hello test',
    reason: 'Create sample test file'
  });

  assert.ok(approval.id, 'Approval should have generated UUID');
  const retrieved = getApproval(approval.id);
  assert.equal(retrieved.path, 'sample.txt');
  assert.equal(retrieved.type, 'write');

  // Fallback retrieval when ID is omitted
  const fallback = getApproval();
  assert.equal(fallback.id, approval.id);

  clearApproval(approval.id);
  assert.equal(getApproval(approval.id), null);
});

test('executeApproval performs approved workspace file operations safely', async () => {
  const approval = registerApproval({
    type: 'write',
    path: 'test-auto.txt',
    content: 'Autonomous task execution verified',
    reason: 'Create test-auto.txt file'
  });

  const result = await executeApproval(approval);
  assert.equal(result.ok, true);
  assert.ok(/wrote/i.test(result.text));

  // Clean up
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(wsRoot, 'test-auto.txt');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
});

test('TOOL_DEFINITIONS contains all local standalone tools', () => {
  const { TOOL_DEFINITIONS } = require('../server.js');
  assert.ok(Array.isArray(TOOL_DEFINITIONS));
  const toolNames = TOOL_DEFINITIONS.map(t => t.function.name);
  assert.ok(toolNames.includes('execute_bash'));
  assert.ok(toolNames.includes('execute_python'));
  assert.ok(toolNames.includes('file_write'));
  assert.ok(toolNames.includes('file_read'));
  assert.ok(toolNames.includes('file_delete'));
  assert.ok(toolNames.includes('web_search'));
  assert.ok(toolNames.includes('zip_package'));
});

test('executeLocalTool handles file_writer and file_reader', async () => {
  const { executeLocalTool } = require('../server.js');
  const writeRes = await executeLocalTool('file_writer', { path: 'local_tool_test.txt', content: 'Local execution works!' });
  assert.equal(writeRes.status, 'success');

  const readRes = await executeLocalTool('file_reader', { path: 'local_tool_test.txt' });
  assert.equal(readRes.content, 'Local execution works!');

  // Clean up
  const filePath = path.join(wsRoot, 'local_tool_test.txt');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
});

test('executeLocalTool file_delete requires human approval', async () => {
  const { executeLocalTool } = require('../server.js');
  // Create dummy file
  const testFile = path.join(wsRoot, 'to_delete.txt');
  fs.writeFileSync(testFile, 'dummy');

  const delRes = await executeLocalTool('file_delete', { path: 'to_delete.txt' });
  assert.equal(delRes.status, 'needs_approval');
  assert.ok(delRes.approvalId);

  // Clean up
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }
});

