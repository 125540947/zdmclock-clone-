// 自动从 Git 仓库更新（P1 运维）：拉取最新代码 + 按需重建前端 + 自重启。
//
// 设计原则（安全第一）：
//  - 仅 fast-forward 合并（git pull --ff-only）：绝不自动 merge/rebase，避免覆盖本地提交或产生冲突。
//  - 工作区有未提交修改（被追踪文件）时拒绝更新，避免丢改动。
//  - Docker 容器内禁用"容器内 pull"：镜像层不可变，pull 不会在容器重建后保留，改为提示用
//    `docker compose pull && docker compose up -d` 更新镜像。
//  - 仅 native 部署（裸 Node）才支持自动重启：通过 re-exec 当前进程实现，端口释放后由新进程接管。
//  - 所有外部命令经可注入的 runner（默认 execFile），便于单元测试脱离真实 git/网络。
//
// runner 约定：async (cmd, args[], opts) => { ok, code, stdout, stderr }

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { flushPersist } from './store.js';

// 真实执行器：封装 execFile，统一返回结构并兜底超时。
export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeout ?? 120_000, ...opts },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (err.killed ? 'TIMEOUT' : err.code ?? 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          killed: !!err && !!err.killed
        });
      }
    );
  });
}

// 运行通道：docker 容器内 pull 无效；否则 native。
export function detectChannel() {
  if (fs.existsSync('/.dockerenv') || process.env.DOCKER_CONTAINER) return 'docker';
  return 'native';
}

async function gitRoot(runner = run) {
  const r = await runner('git', ['rev-parse', '--show-toplevel']);
  if (r.ok && r.stdout.trim()) return r.stdout.trim();
  return process.cwd();
}

// 读取本地仓库状态（是否仓库 / 远程 / 分支 / 当前提交 / 是否有未提交修改）。
export async function getRepoState({ cwd, runner = run } = {}) {
  const root = cwd || (await gitRoot(runner));
  const s = {
    isRepo: false,
    hasRemote: false,
    channel: detectChannel(),
    repoRoot: root,
    branch: '',
    commit: '',
    commitShort: '',
    commitMsg: '',
    dirty: false,
    dirtyFiles: [],
    error: ''
  };
  const inside = await runner('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root });
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    s.error = '当前目录不是 Git 仓库，无法自动更新';
    return s;
  }
  s.isRepo = true;
  const [bR, hR, mR, rR, stR] = await Promise.all([
    runner('git', ['branch', '--show-current'], { cwd: root }),
    runner('git', ['rev-parse', 'HEAD'], { cwd: root }),
    runner('git', ['log', '-1', '--format=%s'], { cwd: root }),
    runner('git', ['remote', 'get-url', 'origin'], { cwd: root }),
    runner('git', ['status', '--porcelain'], { cwd: root })
  ]);
  s.branch = bR.stdout.trim();
  s.commit = hR.stdout.trim();
  s.commitShort = s.commit.slice(0, 7);
  s.commitMsg = mR.stdout.trim();
  s.hasRemote = rR.ok && !!rR.stdout.trim();
  // 注意：git pull --ff-only 不会因"未跟踪文件（??）"而失败，只有被追踪文件的修改才会
  // 阻碍 fast-forward。因此这里只把"被追踪文件的修改"视为脏，避免本地产物 / 临时文件
  // （如 .env.generated、*.log、data/ 下未忽略文件）误拒自动更新（修复 M3）。
  const all = stR.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
  const untracked = all.filter((l) => l.startsWith('??'));
  const tracked = all.filter((l) => !l.startsWith('??'));
  s.dirty = tracked.length > 0;
  s.dirtyFiles = tracked;
  s.untrackedFiles = untracked;
  return s;
}

// 是否支持"自动更新"：仓库 + 有 origin 远程 + 非 Docker 通道。
export function updateSupported(state) {
  return !!state && state.isRepo && state.hasRemote && state.channel === 'native';
}

// 检查远程是否有新提交（先 fetch，再比较 HEAD 与 origin/<branch> 的领先/落后）。
export async function checkUpdate(state, runner = run) {
  const root = state.repoRoot;
  const fetch = await runner('git', ['fetch', 'origin', state.branch], { cwd: root });
  if (!fetch.ok) {
    return {
      ok: false,
      error: 'git fetch 失败：' + (fetch.stderr.trim() || fetch.code),
      behind: 0,
      ahead: 0
    };
  }
  const [behindR, aheadR, remoteR] = await Promise.all([
    runner('git', ['rev-list', '--count', `HEAD..origin/${state.branch}`], { cwd: root }),
    runner('git', ['rev-list', '--count', `origin/${state.branch}..HEAD`], { cwd: root }),
    runner('git', ['rev-parse', `origin/${state.branch}`], { cwd: root })
  ]);
  const behind = parseInt(behindR.stdout.trim(), 10) || 0;
  const ahead = parseInt(aheadR.stdout.trim(), 10) || 0;
  return {
    ok: true,
    behind,
    ahead,
    localCommit: state.commit,
    remoteCommit: remoteR.stdout.trim(),
    branch: state.branch
  };
}

// 执行更新：ff-only 拉取 → 按变更文件决定是否 npm install / build → 可选自重启。
// onLog(line)：可选回调，用于把进度实时推给调用方（如 HTTP 轮询），避免长任务无反馈。
export async function runUpdate({ restart = true, onLog, runner = run } = {}) {
  const log = [];
  const push = (line) => {
    log.push(line);
    if (typeof onLog === 'function') onLog(line);
  };

  const state = await getRepoState({ runner });
  if (!state.isRepo) {
    push(state.error || '不是 Git 仓库');
    return { ok: false, log, error: state.error || '不是 Git 仓库' };
  }
  if (state.channel === 'docker') {
    push('检测到运行在 Docker 容器内。');
    return {
      ok: false,
      channel: 'docker',
      log,
      error:
        '容器内 git pull 不会在容器重建后保留，请用 `docker compose pull && docker compose up -d` 更新镜像（详见 DEPLOY.md）'
    };
  }
  if (!state.hasRemote) {
    push('未配置 origin 远程仓库');
    return { ok: false, log, error: '未配置 origin 远程仓库，无法拉取更新' };
  }
  if (state.dirty) {
    push(`工作区有 ${state.dirtyFiles.length} 个未提交修改，拒绝自动合并以免丢失改动。`);
    return {
      ok: false,
      log,
      error: '请先提交或 stash 本地修改后再更新',
      dirtyFiles: state.dirtyFiles
    };
  }

  const root = state.repoRoot;
  const beforeR = await runner('git', ['rev-parse', 'HEAD'], { cwd: root });
  const before = beforeR.stdout.trim();

  // M-16 修复：回滚须为真正的事务——除还原受控源码外，还要：
  //  1) 重建 node_modules 以匹配回滚后的旧依赖清单（install 已改变依赖树）；
  //  2) 清理新构建产生的未跟踪产物（web/dist 中未被 git 跟踪的新哈希文件），
  //     否则"源码=旧而依赖/产物=新"状态并不一致，与"全有或全无"注释矛盾。
  // 同时：git diff 退出码必须检查；命令失败不能当作"无变更"而静默跳过 install/build。
  let needInstall = false;
  let needBuild;
  const rollback = async (reason) => {
    push('✖ ' + reason + '，回滚到更新前提交…');
    const rb = await runner('git', ['reset', '--hard', before], { cwd: root });
    let depsRestored = true;
    if (needInstall) {
      push('• 重建 node_modules 以匹配回滚后的依赖清单…');
      const ri = await runner('npm', ['install'], { cwd: root, timeout: 300_000 });
      depsRestored = ri.ok;
      if (!ri.ok) push('⚠️ 依赖重建失败（' + (ri.stderr.trim() || ri.code) + '），请手动 npm install');
    }
    const clean = await runner('git', ['clean', '-fd', 'web/dist'], { cwd: root });
    if (rb.ok) {
      if (clean.ok) push('↩ 已回滚到 ' + before.slice(0, 7));
      else push('⚠️ 清理构建产物异常（' + (clean.stderr.trim() || clean.code) + '），请手动清理 web/dist');
    } else {
      push('⚠️ 回滚命令异常（' + (rb.stderr.trim() || rb.code) + '），请手动 git reset --hard ' + before);
    }
    return {
      ok: false,
      log,
      error: reason,
      rolledBack: true,
      beforeCommit: before,
      rollbackOk: rb.ok && depsRestored,
      depsRestored
    };
  };

  push(`▶ 拉取 origin/${state.branch} …`);
  const pull = await runner('git', ['pull', '--ff-only', 'origin', state.branch], { cwd: root });
  if (!pull.ok) {
    push(pull.stderr.trim() || 'git pull 失败');
    return {
      ok: false,
      log,
      error: 'git pull 失败（可能存在本地提交或冲突），请手动处理后再更新'
    };
  }
  push(
    pull.stdout.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 4).join(' ｜ ') ||
      '已是最新'
  );
  // M-05 修复：报告"更新后"的提交号（此前用的是更新前 state.commit，会把旧提交号误报为已更新版本）。
  const afterR = await runner('git', ['rev-parse', 'HEAD'], { cwd: root });
  const afterCommit = afterR.ok ? afterR.stdout.trim() : state.commit;

  // M-16 修复：git diff 退出码必须检查。命令失败时绝不能把变更集合当作空集合并跳过
  // install/build（否则可能在依赖/前端已变化却未重建时仍报告更新成功）。
  const diff = await runner('git', ['diff', '--name-only', `${before} HEAD`], { cwd: root });
  if (!diff.ok) {
    return rollback('git diff 失败，无法确定变更范围');
  }
  const changed = diff.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
  needInstall = changed.some((f) => /(^|\/)package\.json$|^package-lock\.json$/.test(f));
  needBuild = needInstall || changed.some((f) => /^web\//.test(f));

  if (needInstall) {
    push('▶ 依赖变化，执行 npm install …');
    const inst = await runner('npm', ['install'], { cwd: root, timeout: 300_000 });
    if (!inst.ok) {
      push(inst.stderr.split('\n').slice(-3).join('\n'));
      return rollback('npm install 失败');
    }
    push('依赖安装完成');
  } else {
    push('• 依赖无变化，跳过 npm install');
  }

  if (needBuild) {
    push('▶ 重建前端，执行 npm run build …');
    const b = await runner('npm', ['run', 'build'], { cwd: root, timeout: 300_000 });
    if (!b.ok) {
      push(b.stderr.split('\n').slice(-3).join('\n'));
      return rollback('npm run build 失败');
    }
    push('前端构建完成');
  } else {
    push('• 前端无变化，跳过构建');
  }

  push('✔ 更新完成');
  const restarting = !!restart && state.channel === 'native';
  if (restarting) push('↻ 即将重启服务以加载新代码…');
  return {
    ok: true,
    log,
    restarting,
    channel: state.channel,
    commit: afterCommit,
    commitShort: afterCommit.slice(0, 7),
    needInstall,
    needBuild
  };
}

// 是否应由应用自身 re-exec 重启（纯决策，便于测试）。
//  - 测试环境（NODE_ENV=test）不重启，避免误杀测试进程。
//  - 若由 supervisor（systemd / pm2 / docker）托管，设 SELF_UPDATE_NO_REEXEC=1 后返回 false，
//    改为直接退出、交给 supervisor 拉起，避免孤儿进程 / 双进程，并让崩溃可被自动恢复（缓解 H1）。
export function shouldReexec() {
  if (process.env.NODE_ENV === 'test') return false;
  const supervised = ['1', 'true', 'yes'].includes(
    String(process.env.SELF_UPDATE_NO_REEXEC || '').toLowerCase()
  );
  return !supervised;
}

// 退出前先落盘（M-05）：re-exec / 退出前等待在途写完成，避免丢失 debounce 窗口内的已确认写入。
// flushPersist 内部先 await 写链再同步立即落盘；无论成功失败都照常退出，不阻塞重启。
function exitAfterFlush() {
  flushPersist().finally(() => process.exit(0));
}

// 自重启：re-exec 当前进程（detached），由新进程接管端口，旧进程退出。
export function scheduleRestart(delayMs = 900) {
  if (!shouldReexec()) {
    // 交给 supervisor 重启：仅退出，不自己派生子进程。
    setTimeout(exitAfterFlush, delayMs);
    return;
  }
  setTimeout(() => {
    try {
      const child = spawn(process.argv[0], process.argv.slice(1), {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch {
      /* 重启失败则保持当前进程继续运行 */
    }
    exitAfterFlush();
  }, delayMs);
}
