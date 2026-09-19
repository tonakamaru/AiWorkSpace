import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deliver, readResult, completeHistory, History } from './history-runner.mjs';

const target = { threadId: '00000000-0000-0000-0000-000000000001', expectedTitle: '日本語', message: '日本\n"quoted" $env:USERNAME $(echo nope)' };
const turn = (id, message = 'old', status = 'completed', answer = 'answer') => ({ id, status, items: [
  { type: 'userMessage', id: id + '-u', content: [{ type: 'text', text: message }] },
  { type: 'agentMessage', id: id + '-a', text: answer }
] });
function event(turns, { cursor = null, nextCursor = null, hasMore = false, status = 'idle' } = {}) {
  return { type: 'mcp_tool_call', server: 'codex_app', tool: 'read_thread', status: 'completed',
    arguments: { threadId: target.threadId, ...(cursor ? { cursor } : {}) },
    result: { content: [{ type: 'text', text: JSON.stringify({
      thread: { id: target.threadId, title: target.expectedTitle, kind: 'chatgpt', status: { type: status } },
      page: { order: 'newest_first', hasMore, nextCursor }, turns
    }) }] } };
}
const sent = { type: 'mcp_tool_call', server: 'codex_app', tool: 'send_message_to_thread', status: 'completed', arguments: { threadId: target.threadId, prompt: target.message } };
function setup(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-history-test-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return { cwd, target, replyWaitMs: 0 };
}
const rows = config => fs.readFileSync(path.join(config.cwd, 'history', target.threadId + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
test('all pages persisted BEFORE send; exact reply stdout; repeat import deduplicates; revisions append', async t => {
  const config = setup(t);
  let output = '';
  const execute = async (c, phase, prompt, receive) => {
    if (phase === 'history') {
      receive(event([turn('two')], { nextCursor: 'two', hasMore: true }));
      receive(event([turn('one')], { cursor: 'two' }));
    } else {
      assert.deepEqual(rows(config).map(r => r.turn.id), ['one', 'two']);
      receive(sent);
      receive(event([turn('two')])); // stale read must never pass as the answer
      receive(event([turn('new', target.message, 'in_progress', 'partial')]));
      receive(event([turn('new', target.message, 'completed', '返答\n引用 " $()')]));
    }
  };
  await deliver(config, execute, x => output += x, () => {});
  assert.equal(output, '返答\n引用 " $()\n');
  assert.deepEqual(rows(config).map(r => r.turn.id), ['one', 'two', 'new', 'new']);
  const h = new History(path.join(config.cwd, 'history', target.threadId + '.jsonl'), target);
  h.append([turn('one'), turn('two'), turn('new', target.message, 'completed', '返答\n引用 " $()')]);
  assert.equal(rows(config).length, 4);
});
test('incomplete history blocks sending', async t => {
  const config = setup(t);
  let phases = [];
  await assert.rejects(deliver(config, async (c, phase, p, receive) => {
    phases.push(phase); receive(event([turn('one')], { nextCursor: 'one', hasMore: true }));
  }, () => {}, () => {}), /Incomplete history/);
  assert.deepEqual(phases, ['history']);
});
test('busy target, corrupt log and wrong title block send', async t => {
  const config = setup(t);
  await assert.rejects(deliver(config, async (c, phase, p, receive) => {
    assert.equal(phase, 'history'); receive(event([], { status: 'active' }));
  }, () => {}, () => {}), /BUSY/);
  const wrong = event([]); wrong.arguments.threadId = 'wrong';
  assert.throws(() => readResult(wrong, target), /TARGET_ERROR/);
  fs.writeFileSync(path.join(config.cwd, 'history', target.threadId + '.jsonl'), '{broken');
  await assert.rejects(deliver(config, () => { throw new Error('must not execute'); }, () => {}, () => {}), /incomplete last line/);
});
test('old same-message reply is not success; no automatic resend', async t => {
  const config = setup(t);
  let sends = 0, output = '';
  await assert.rejects(deliver(config, async (c, phase, p, receive) => {
    if (phase === 'send') { sends++; receive(sent); }
    receive(event([turn('old', target.message)]));
  }, x => output += x, () => {}), /SUBMITTED_UNCONFIRMED/);
  assert.equal(sends, 1); assert.equal(output, '');
});
test('unconfirmed user turn is saved; next history import recovers its answer', async t => {
  const config = setup(t);
  await assert.rejects(deliver(config, async (c, phase, p, receive) => {
    if (phase === 'history') receive(event([]));
    else { receive(sent); receive(event([turn('late', target.message, 'in_progress', '')])); }
  }, () => {}, () => {}), /SUBMITTED_UNCONFIRMED/);
  const h = new History(path.join(config.cwd, 'history', target.threadId + '.jsonl'), target);
  h.append([turn('late', target.message)]);
  assert.deepEqual(rows(config).map(r => r.turn.status), ['in_progress', 'completed']);
});
test('lock prevents concurrent senders and is released on failure', async t => {
  const config = setup(t);
  let release;
  const pending = deliver(config, () => new Promise(resolve => { release = resolve; }), () => {}, () => {});
  await assert.rejects(deliver(config, () => {}, () => {}, () => {}), /locked/);
  release(); await assert.rejects(pending, /Incomplete history/);
  assert.equal(fs.existsSync(path.join(config.cwd, 'history', target.threadId + '.jsonl.lock')), false);
});
test('real CLI event fixture parses when locally available', t => {
  const filename = new URL('./probe-events.jsonl', import.meta.url);
  if (!fs.existsSync(filename)) { t.skip('Local integration fixture is not committed.'); return; }
  const events = fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const item = events.find(e => e.type === 'item.completed' && e.item.tool === 'read_thread').item;
  const data = JSON.parse(item.result.content[0].text);
  const page = readResult(item, { threadId: data.thread.id, expectedTitle: data.thread.title });
  assert.equal(page.turns.length, 1);
});
test('history write failure prevents send and releases lock', async t => {
  const config = setup(t);
  let sends = 0;
  await assert.rejects(deliver(config, async (c, phase, p, receive) => {
    if (phase === 'send') sends++;
    receive(event([turn('old')]));
    // Make the destination unwritable after retrieval, before persistence.
    fs.mkdirSync(path.join(config.cwd, 'history', target.threadId + '.jsonl'));
  }, () => {}, () => {}));
  assert.equal(sends, 0);
  assert.equal(fs.existsSync(path.join(config.cwd, 'history', target.threadId + '.jsonl.lock')), false);
});
test('send failure preserves baseline and never retries or prints a reply', async t => {
  const config = setup(t);
  let sends = 0, output = '';
  await assert.rejects(deliver(config, async (c, phase, p, receive) => {
    if (phase === 'history') receive(event([turn('old')]));
    else { sends++; receive(sent); throw new Error('Connection lost'); }
  }, x => output += x, () => {}), /Delivery may be uncertain/);
  assert.equal(sends, 1); assert.equal(output, '');
  assert.equal(rows(config)[0].turn.id, 'old');
});
test('host polls after worker stops early, without sending again', async t => {
  const config = { ...setup(t), replyWaitMs: 5000, pollIntervalMs: 0 };
  let reads = 0, sends = 0, output = '';
  await deliver(config, async (c, phase, p, receive) => {
    if (phase === 'send') { sends++; receive(sent); receive(event([turn('old')])); }
    else {
      reads++;
      receive(event(reads < 3 ? [turn('old')] : [turn('new', target.message, 'completed', 'late answer')]));
    }
  }, x => output += x, () => {});
  assert.equal(sends, 1); assert.equal(reads, 3); assert.equal(output, 'late answer\n');
});
