// 自动更新核心逻辑单测（node:test）：用可注入的假 runner 模拟 git/npm 输出，
// 覆盖仓库状态解析、落后/领先计数、ff-only 更新、依赖/前端变更判定、脏工作区/Docker/无远程拒绝。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRepoState,
  checkUpdate,
  runUpdate,
  scheduleRestart,
  shouldReexec,
  updateSupported
} from '../src/selfUpdate.js';

function okOut(stdout) {
  return { ok: true, code: 0, stdout, stderr: '' };
}
function failOut(stderr, code = 1) {
  return { ok: false, code, stdout: '', stderr };
}

// 基础假 runner：默认返回"干净、有远程、main 分支"的仓库；可用 overrides 覆盖特定命令。
function baseRunner(overrides = {}) {
  return async (cmd, args = []) => {
    const a = args.join(' ');
    const key = cmd + '|' + a;
    if (overrides[key] !== undefined) {
      const v = overrides[key];
      return typeof v === 'function' ? v() : v;
    }
    if (cmd === 'git') {
      if (a === 'rev-parse --is-inside-work-tree') return okOut('true');
      if (a === 'rev-parse --show-toplevel') return okOut('/repo');
      if (a === 'branch --show-current') return okOut('main');
      if (a === 'rev-parse HEAD') return okOut('abc123def456');
      if (a === 'log -1 --format=%s') return okOut('feat: base');
      if (a === 'remote get-url origin') return okOut('https://github.com/x/y.git');
      if (a === 'status --porcelain') return okOut(overrides._status || '');
      if (a.startsWith('fetch')) return okOut('');
      if (a.startsWith('rev-list --count HEAD..origin')) return okOut(overrides._behind ?? '0');
      if (a.startsWith('rev-list --count origin')) return okOut(overrides._ahead ?? '0');
      if (a.startsWith('rev-parse origin')) return okOut('def789');
      if (a.startsWith('pull')) return okOut('Already up to date.');
      if (a.startsWith('diff --name-only')) return okOut(overrides._diff || '');
    }
    if (cmd === 'npm') {
      if (a === 'install') return okOut('added 0 packages');
      if (a === 'run build') return okOut('built');
    }
    return okOut('');
  };
}

test('getRepoState：解析分支/提交/远程/是否脏', async () => {
  const r = await getRepoState({ runner: baseRunner() });
  assert.equal(r.isRepo, true);
  assert.equal(r.branch, 'main');
  assert.equal(r.commitShort, 'abc123d'); // 'abc123def456'.slice(0,7)
  assert.equal(r.commitMsg, 'feat: base');
  assert.equal(r.hasRemote, true);
  assert.equal(r.dirty, false);
  assert.equal(r.channel, 'native');
});

test('M3：未跟踪文件(??)不视为脏，脏仅针对被追踪修改', async () => {
  const r = await getRepoState({
    runner: baseRunner({ _status: '?? temp.log\n?? .env.generated\n M server/src/x.js' })
  });
  assert.equal(r.dirty, true, '被追踪修改 M 应判脏');
  assert.equal(r.dirtyFiles.length, 1);
  assert.equal(r.untrackedFiles.length, 2, '未跟踪文件应单独列出、不影响更新');
});

test('M3：仅有未跟踪文件时 dirty=false（不会误拒更新）', async () => {
  const r = await getRepoState({
    runner: baseRunner({ _status: '?? temp.log\n?? data/local.json' })
  });
  assert.equal(r.dirty, false);
  assert.equal(r.untrackedFiles.length, 2);
});

test('getRepoState：非仓库时给出错误', async () => {
  const r = await getRepoState({
    runner: async (cmd, args) =>
      cmd === 'git' && args.join(' ') === 'rev-parse --is-inside-work-tree'
        ? failOut('not a tree')
        : okOut('')
  });
  assert.equal(r.isRepo, false);
  assert.ok(r.error);
});

test('updateSupported：仅 native + 仓库 + 有远程 为 true', () => {
  assert.equal(updateSupported({ isRepo: true, hasRemote: true, channel: 'native' }), true);
  assert.equal(updateSupported({ isRepo: true, hasRemote: true, channel: 'docker' }), false);
  assert.equal(updateSupported({ isRepo: false, hasRemote: true, channel: 'native' }), false);
});

test('checkUpdate：解析落后/领先提交数', async () => {
  const r = await checkUpdate(
    { repoRoot: '/repo', branch: 'main', commit: 'abc' },
    baseRunner({ _behind: '3', _ahead: '0' })
  );
  assert.equal(r.ok, true);
  assert.equal(r.behind, 3);
  assert.equal(r.ahead, 0);
  assert.equal(r.remoteCommit, 'def789');
});

test('runUpdate：无文件变更 → 跳过 install/build，标记重启', async () => {
  const r = await runUpdate({ restart: true, runner: baseRunner({ _diff: '' }) });
  assert.equal(r.ok, true);
  assert.equal(r.needInstall, false);
  assert.equal(r.needBuild, false);
  assert.equal(r.restarting, true);
  assert.ok(!r.log.some((l) => l.includes('依赖安装完成')));
  assert.ok(!r.log.some((l) => l.includes('前端构建完成')));
});

test('runUpdate：依赖/前端变更 → 执行 install+build', async () => {
  const r = await runUpdate({
    restart: true,
    runner: baseRunner({ _diff: 'package.json\nweb/src/App.vue' })
  });
  assert.equal(r.ok, true);
  assert.equal(r.needInstall, true);
  assert.equal(r.needBuild, true);
  assert.ok(r.log.some((l) => l.includes('依赖安装完成')));
  assert.ok(r.log.some((l) => l.includes('前端构建完成')));
});

test('runUpdate：工作区脏 → 拒绝更新', async () => {
  const r = await runUpdate({ runner: baseRunner({ _status: ' M server/src/x.js' }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /提交|stash/);
});

test('runUpdate：无 origin 远程 → 拒绝更新', async () => {
  const r = await runUpdate({ runner: baseRunner({ 'git|remote get-url origin': okOut('') }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /远程/);
});

test('runUpdate：Docker 通道 → 拒绝并提示 compose', async () => {
  const prev = process.env.DOCKER_CONTAINER;
  process.env.DOCKER_CONTAINER = '1';
  try {
    const r = await runUpdate({ runner: baseRunner({}) });
    assert.equal(r.ok, false);
    assert.equal(r.channel, 'docker');
    assert.match(r.error, /docker compose/);
  } finally {
    if (prev === undefined) delete process.env.DOCKER_CONTAINER;
    else process.env.DOCKER_CONTAINER = prev;
  }
});

test('scheduleRestart：NODE_ENV=test 时不真正重启进程', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    // 不应抛出，也不应退出进程
    scheduleRestart(0);
    assert.ok(true);
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});

test('shouldReexec：决策矩阵（测试环境/ supervisor 托管）', () => {
  const prev = { ...process.env };
  try {
    process.env.NODE_ENV = 'test';
    assert.equal(shouldReexec(), false, '测试环境不重启');

    process.env.NODE_ENV = 'production';
    delete process.env.SELF_UPDATE_NO_REEXEC;
    assert.equal(shouldReexec(), true, '生产 + 未设标志 → 自行 re-exec');

    process.env.SELF_UPDATE_NO_REEXEC = '1';
    assert.equal(shouldReexec(), false, 'SELF_UPDATE_NO_REEXEC=1 → 交 supervisor');
    process.env.SELF_UPDATE_NO_REEXEC = 'true';
    assert.equal(shouldReexec(), false);
    process.env.SELF_UPDATE_NO_REEXEC = 'yes';
    assert.equal(shouldReexec(), false);
    process.env.SELF_UPDATE_NO_REEXEC = '0';
    assert.equal(shouldReexec(), true, '=0 视为未托管');
  } finally {
    process.env.NODE_ENV = prev.NODE_ENV;
    if (prev.SELF_UPDATE_NO_REEXEC === undefined) delete process.env.SELF_UPDATE_NO_REEXEC;
    else process.env.SELF_UPDATE_NO_REEXEC = prev.SELF_UPDATE_NO_REEXEC;
  }
});

// M-13：依赖/构建失败 → 回滚 HEAD 到更新前提交（原子性，避免重启加载坏代码）
test('M-13：npm install 失败 → 回滚 HEAD 到更新前提交', async () => {
  let resetArgs = null;
  const runner = async (cmd, args = []) => {
    const a = args.join(' ');
    if (cmd === 'git') {
      if (a === 'rev-parse --is-inside-work-tree') return okOut('true');
      if (a === 'rev-parse --show-toplevel') return okOut('/repo');
      if (a === 'branch --show-current') return okOut('main');
      if (a === 'log -1 --format=%s') return okOut('feat: base');
      if (a === 'remote get-url origin') return okOut('https://github.com/x/y.git');
      if (a === 'status --porcelain') return okOut('');
      if (a.startsWith('fetch')) return okOut('');
      if (a.startsWith('rev-list --count HEAD..origin')) return okOut('0');
      if (a.startsWith('rev-list --count origin')) return okOut('0');
      if (a.startsWith('rev-parse origin')) return okOut('def789');
      if (a.startsWith('pull')) return okOut('Fast-forward');
      if (a.startsWith('diff --name-only')) return okOut('package.json');
      if (a === 'rev-parse HEAD') return okOut('abc123def456');
      if (a.startsWith('reset --hard')) {
        resetArgs = args.slice(2);
        return okOut('HEAD is now at abc123d');
      }
    }
    if (cmd === 'npm') {
      if (a === 'install') return failOut('npm ERR! code 1');
      if (a === 'run build') return okOut('built');
    }
    return okOut('');
  };
  const r = await runUpdate({ restart: false, runner });
  assert.equal(r.ok, false, 'install 失败应返回 ok=false');
  assert.equal(r.rolledBack, true);
  assert.equal(r.beforeCommit, 'abc123def456', '应记录回滚到的更新前提交');
  assert.equal(r.rollbackOk, true);
  assert.deepEqual(resetArgs, ['abc123def456'], '应执行 git reset --hard <更新前提交>');
});

test('M-13：npm run build 失败 → 回滚 HEAD 到更新前提交', async () => {
  let resetArgs = null;
  const runner = async (cmd, args = []) => {
    const a = args.join(' ');
    if (cmd === 'git') {
      if (a === 'rev-parse --is-inside-work-tree') return okOut('true');
      if (a === 'rev-parse --show-toplevel') return okOut('/repo');
      if (a === 'branch --show-current') return okOut('main');
      if (a === 'log -1 --format=%s') return okOut('feat: base');
      if (a === 'remote get-url origin') return okOut('https://github.com/x/y.git');
      if (a === 'status --porcelain') return okOut('');
      if (a.startsWith('fetch')) return okOut('');
      if (a.startsWith('rev-list --count HEAD..origin')) return okOut('0');
      if (a.startsWith('rev-list --count origin')) return okOut('0');
      if (a.startsWith('rev-parse origin')) return okOut('def789');
      if (a.startsWith('pull')) return okOut('Fast-forward');
      if (a.startsWith('diff --name-only')) return okOut('web/src/App.vue');
      if (a === 'rev-parse HEAD') return okOut('abc123def456');
      if (a.startsWith('reset --hard')) {
        resetArgs = args.slice(2);
        return okOut('HEAD is now at abc123d');
      }
    }
    if (cmd === 'npm') {
      if (a === 'install') return okOut('added 0');
      if (a === 'run build') return failOut('vite build failed');
    }
    return okOut('');
  };
  const r = await runUpdate({ restart: false, runner });
  assert.equal(r.ok, false, 'build 失败应返回 ok=false');
  assert.equal(r.rolledBack, true);
  assert.equal(r.beforeCommit, 'abc123def456');
  assert.deepEqual(resetArgs, ['abc123def456'], '应回滚 HEAD（含 web/dist 这类入库产物的跟踪文件）');
});

// M-05：runUpdate 必须报告"更新后"的提交号（此前用的是更新前 state.commit，会把旧提交号误报为已更新版本）。
test('M-05：runUpdate 返回更新后提交号（非更新前 state.commit）', async () => {
  let headCalls = 0;
  const runner = async (cmd, args = []) => {
    const a = args.join(' ');
    if (cmd === 'git') {
      if (a === 'rev-parse --is-inside-work-tree') return okOut('true');
      if (a === 'rev-parse --show-toplevel') return okOut('/repo');
      if (a === 'branch --show-current') return okOut('main');
      if (a === 'log -1 --format=%s') return okOut('feat: base');
      if (a === 'remote get-url origin') return okOut('https://github.com/x/y.git');
      if (a === 'status --porcelain') return okOut('');
      if (a.startsWith('fetch')) return okOut('');
      if (a.startsWith('rev-list --count HEAD..origin')) return okOut('0');
      if (a.startsWith('rev-list --count origin')) return okOut('0');
      if (a.startsWith('rev-parse origin')) return okOut('def789');
      if (a.startsWith('pull')) return okOut('Fast-forward');
      if (a.startsWith('diff --name-only')) return okOut('server/src/x.js');
      if (a === 'rev-parse HEAD') {
        headCalls += 1;
        // 前两次（getRepoState / pull 前）= 旧提交；第三次（pull 后）= 新提交
        return okOut(headCalls <= 2 ? 'abc123def456' : 'zzz999yyy888');
      }
    }
    if (cmd === 'npm') {
      if (a === 'install') return okOut('added 0');
      if (a === 'run build') return okOut('built');
    }
    return okOut('');
  };
  const r = await runUpdate({ restart: false, runner });
  assert.equal(r.ok, true);
  assert.equal(r.commit, 'zzz999yyy888', '应报告更新后提交号');
  assert.equal(r.commitShort, 'zzz999y');
});
