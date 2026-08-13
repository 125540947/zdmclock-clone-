// M-07 修复回归：响应体必须「流式 + 边读边限」大小，超限立即取消后续读取，
// 不得先把完整响应缓冲进内存再判断（否则异常/受控上游仍可占满内存）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { readBodyCapped, readJsonCapped, BodyTooLargeError } = await import('../src/notifier.js');

// 构造一个具备 body.getReader() 的伪 Response（模拟 fetch 流式响应）
function fakeStreamingResponse(chunks, onCancel) {
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (i < chunks.length) {
              const value = chunks[i++];
              return Promise.resolve({ done: false, value });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
          cancel() {
            if (onCancel) onCancel();
            return Promise.resolve();
          }
        };
      }
    }
  };
}

function fakeNoStreamResponse(buf) {
  return { ok: true, status: 200, arrayBuffer: async () => buf };
}

test('readBodyCapped：小响应完整读取且文本正确', async () => {
  const chunks = [Buffer.from('{"ok":'), Buffer.from('true}')];
  const text = await readBodyCapped(fakeStreamingResponse(chunks), { maxBytes: 100 });
  assert.equal(text, '{"ok":true}');
});

test('readBodyCapped：超限立即取消后续读取，不再继续下载（M-07 核心）', async () => {
  // 每块 1MB，共 4 块（4MB）；上限 2MB → 读到第 3 块即超限，必须停止且 cancel。
  const big = Buffer.alloc(1_000_000, 'a');
  const chunks = [big, big, big, big];
  let cancelled = false;
  let reads = 0;
  const body = {
    getReader() {
      return {
        read() {
          reads += 1;
          if (reads <= chunks.length) return Promise.resolve({ done: false, value: chunks[reads - 1] });
          return Promise.resolve({ done: true });
        },
        cancel() {
          cancelled = true;
          return Promise.resolve();
        }
      };
    }
  };
  await assert.rejects(
    () => readBodyCapped({ ok: true, status: 200, body }, { maxBytes: 2_000_000 }),
    BodyTooLargeError,
    '超限必须抛 BodyTooLargeError'
  );
  assert.ok(cancelled, '超限后应调用 reader.cancel() 终止下载');
  assert.ok(reads < chunks.length, `超限后应停止读取（实际读 ${reads} 块，共 ${chunks.length}）`);
});

test('readBodyCapped：无 body.getReader 时退化 arrayBuffer 仍钳制大小', async () => {
  await assert.rejects(
    () => readBodyCapped(fakeNoStreamResponse(Buffer.alloc(3_000_000)), { maxBytes: 2_000_000 }),
    BodyTooLargeError
  );
  const ok = await readBodyCapped(fakeNoStreamResponse(Buffer.alloc(10)), { maxBytes: 2_000_000 });
  assert.equal(ok, Buffer.alloc(10).toString('utf8'));
});

test('readJsonCapped：小 JSON 正常解析', async () => {
  const j = await readJsonCapped(fakeStreamingResponse([Buffer.from('{"code":0}')]));
  assert.deepEqual(j, { code: 0 });
});

test('readJsonCapped：超限抛出 BodyTooLargeError（由调用方 .catch 兜底为 {}）', async () => {
  const big = Buffer.alloc(1_000_000, 'a');
  await assert.rejects(
    () => readJsonCapped(fakeStreamingResponse([big, big, big, big])),
    BodyTooLargeError
  );
});
