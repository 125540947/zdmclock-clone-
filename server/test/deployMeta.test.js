// 部署溯源（AUDIT 2026-09-04 中优先级）：运行版本快照采集逻辑单测。
// 仅校验结构与「非密钥」约束，不依赖 git 是否可用（commit 可能为 'unknown'）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { deployMeta, getDeployMeta } = await import('../src/deployMeta.js');

test('deployMeta 含 commit / buildTime / config 三字段', () => {
  assert.ok('commit' in deployMeta, '应有 commit');
  assert.ok('buildTime' in deployMeta, '应有 buildTime');
  assert.ok('config' in deployMeta, '应有 config');
});

test('commit 为 40 位 hex 或 unknown（best-effort）', () => {
  assert.ok(
    /^[0-9a-f]{40}$/.test(deployMeta.commit) || deployMeta.commit === 'unknown',
    `commit 应为 40 位 hex 或 unknown，实际=${deployMeta.commit}`
  );
});

test('buildTime 为合法 ISO8601（进程启动时刻）', () => {
  const t = new Date(deployMeta.buildTime);
  assert.ok(!Number.isNaN(t.getTime()), 'buildTime 应为可解析的时间');
  assert.ok(deployMeta.buildTime.endsWith('Z') || deployMeta.buildTime.includes('+'), '应为带时区的 ISO 字符串');
});

test('config 仅暴露非密钥开关，不含凭据/数据', () => {
  const c = deployMeta.config;
  for (const k of ['nodeEnv', 'adapter', 'requireAuth', 'openMode', 'trustProxy', 'bindAddress', 'port', 'tz', 'smzdmDebug', 'apiTokenSet', 'adminTokenSet', 'gptEnabled']) {
    assert.ok(k in c, `config 应含 ${k}`);
  }
  // 绝不泄露任何疑似凭据的字段（允许 *Set 布尔存在性字段，如 apiTokenSet/adminTokenSet）
  const leaked = Object.keys(c).filter((k) => /token|password|cookie|key|secret/i.test(k) && !/Set$/.test(k));
  assert.equal(leaked.length, 0, `config 不应包含凭据类字段，发现：${leaked.join(',')}`);
  // 凭据仅以布尔存在性暴露，不以原值暴露
  assert.equal(typeof c.apiTokenSet, 'boolean', 'apiTokenSet 应为布尔（存在性，非值）');
  assert.equal(typeof c.adminTokenSet, 'boolean', 'adminTokenSet 应为布尔（存在性，非值）');
});

test('getDeployMeta 返回同样的单例', () => {
  assert.equal(getDeployMeta(), deployMeta, '应返回模块级单例');
});
