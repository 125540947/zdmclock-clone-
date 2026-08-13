import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { load, flushPersist } from './store.js';
import { rateLimit } from './middleware/rateLimit.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import clockRoutes from './routes/clock.js';
import taskRoutes from './routes/tasks.js';
import adminRoutes from './routes/admin.js';
import baoliaoRoutes from './routes/baoliao.js';
import gptRoutes from './routes/gpt.js';
import notifyRoutes from './routes/notify.js';
import assetsRoutes from './routes/assets.js';
import healthRoutes from './routes/health.js';
import updateRoutes from './routes/update.js';
import { probeHealth } from './health.js';
import { startScheduler, isSchedulerRunning } from './scheduler.js';

// 全局未捕获异常兜底（P1-10）：best-effort 的异步推送/解析若遗漏 try/catch，
// 可能触发 unhandledRejection / uncaughtException 导致进程退出。这里统一记录日志、
// 避免静默崩进程；注意：仅记录不自动退出，保证主服务可用。
process.on('unhandledRejection', (reason, promise) => {
  // eslint-disable-next-line no-console
  console.error('[zdmclock][未捕获 Promise 拒绝]', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[zdmclock][未捕获异常]', err && err.stack ? err.stack : err);
});

// 好价批量导入页（同源、免构建）：服务端无法抓取 smzdm 好价（反爬挡死），
// 改由用户浏览器导入。页面内嵌「拖拽书签」一键复制 smzdm 文章链接 + 粘贴导入文本框。
// 注意：字符串内不含反引号/`${`/反斜杠，以便安全包裹在模板字符串中。
const BAOLIAO_IMPORT_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>好价批量导入 - zdmclock</title>
<style>
  body{font-family:system-ui,'PingFang SC','Microsoft YaHei',sans-serif;max-width:780px;margin:24px auto;padding:0 16px;color:#222;line-height:1.6}
  h1{font-size:20px} h3{font-size:15px;margin:0 0 8px}
  .card{border:1px solid #e3e3e3;border-radius:10px;padding:14px 16px;margin:14px 0;background:#fafafa}
  textarea{width:100%;height:170px;box-sizing:border-box;font-family:monospace;font-size:13px;padding:8px;border:1px solid #ccc;border-radius:8px}
  button{background:#e4393c;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:14px;cursor:pointer}
  button:disabled{opacity:.6}
  input[type=text]{padding:8px;border:1px solid #ccc;border-radius:8px;width:300px;box-sizing:border-box}
  .tip{color:#666;font-size:13px}
  code{background:#eee;padding:1px 5px;border-radius:4px}
  .bm{display:inline-block;background:#2b6cb0;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600}
  #msg{margin-top:10px;font-size:14px;white-space:pre-wrap}
  .ok{color:#1a7f37}.err{color:#c0392b}
</style>
</head>
<body>
<h1>好价批量导入</h1>
<p class="tip">服务端无法抓取 smzdm 好价（被反爬拦截），因此数据从你的浏览器导入。两步：① 用下方书签在 smzdm 好价页一键复制链接；② 粘贴到文本框导入。</p>
<div class="card">
  <h3>① 安装书签</h3>
  <p class="tip">把下面这个按钮<strong>拖到浏览器书签栏</strong>（或右键收藏）：</p>
  <p><a class="bm" id="bm" href="#">📋 抓取好价链接</a></p>
  <p class="tip">然后打开任意 smzdm 好价页（如 <code>https://www.smzdm.com/</code> 或分类页），点击该书签，会自动复制页面上所有文章链接（HTTP 下若复制失败会弹框供手动复制）。</p>
</div>
<div class="card">
  <h3>② 粘贴并导入</h3>
  <p class="tip">Token（开启鉴权时需要，默认 <code>zdmclock</code>；未开启可留空）：</p>
  <p><input type="text" id="token" placeholder="API Token，可留空"></p>
  <p><input type="text" id="channelId" placeholder="频道 ID（可选；好价贴必填真实频道，否则点赞/收藏会失败）">
  <button type="button" id="remember" style="background:#2b6cb0">📌 记住</button>
  <button type="button" id="forget" style="background:#888">清除</button>
  <span id="remembered" class="tip"></span></p>
  <p><textarea id="links" placeholder="把 smzdm 文章链接粘贴到这里，每行一个，或任意含链接的文本"></textarea></p>
  <p><button id="imp">导入好价</button> <span class="tip">（链接形如 https://www.smzdm.com/p/123456789/ ）</span></p>
  <div id="msg"></div>
</div>
<script nonce="__NONCE__">
(function(){
  var CH_KEY='zdmclock.channelId';
  var bm=document.getElementById('bm');
  var bk="javascript:(function(){var L=[].slice.call(document.querySelectorAll('a')).filter(function(a){return a.href&&a.href.indexOf('/p/')!==-1;}).map(function(a){return a.href;}).filter(function(v,i,arr){return arr.indexOf(v)===i;});var sep=String.fromCharCode(10);var t=L.join(sep);function sh(){window.prompt('已抓取 '+L.length+' 条，请复制：',t);}try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){alert('已复制 '+L.length+' 条好价链接，去 zdmclock 粘贴导入');},sh);}else{sh();}}catch(e){sh();}})();";
  bm.href=bk;
  var btn=document.getElementById('imp');
  var msg=document.getElementById('msg');
  var cid=document.getElementById('channelId');
  var rememberBtn=document.getElementById('remember');
  var forgetBtn=document.getElementById('forget');
  var remembered=document.getElementById('remembered');
  function showRemembered(){
    var v=localStorage.getItem(CH_KEY);
    remembered.textContent=v?('📌 已记住频道：'+v+'（存于本浏览器，刷新不丢）'):'（未记住，刷新后需重填）';
  }
  function saveRemembered(){
    if(cid.value.trim()){localStorage.setItem(CH_KEY,cid.value.trim());msg.className='ok';msg.textContent='已记住频道 '+cid.value.trim()+'，下次自动填入。';}
    else{localStorage.removeItem(CH_KEY);msg.className='';msg.textContent='频道 ID 为空，已取消记住。';}
    showRemembered();
  }
  function forget(){
    localStorage.removeItem(CH_KEY);cid.value='';msg.className='';msg.textContent='已清除记住的频道。';showRemembered();
  }
  // 输入时即时记住 + 页面加载恢复
  cid.addEventListener('input',function(){if(cid.value.trim())localStorage.setItem(CH_KEY,cid.value.trim());showRemembered();});
  rememberBtn.addEventListener('click',saveRemembered);
  forgetBtn.addEventListener('click',forget);
  var saved=localStorage.getItem(CH_KEY);
  if(saved){cid.value=saved;}
  showRemembered();
  btn.addEventListener('click',function(){
    var text=document.getElementById('links').value;
    var token=document.getElementById('token').value.trim();
    var channelId=cid.value.trim();
    if(!text.trim()){msg.className='err';msg.textContent='请先粘贴链接';return;}
    var url='/api/baoliao/bulk'+(token?('?token='+encodeURIComponent(token)):'');
    btn.disabled=true;msg.className='';msg.textContent='导入中…';
    fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,channelId:channelId})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(o){btn.disabled=false;
        if(o.ok&&o.j.ok){msg.className='ok';msg.textContent='成功：解析 '+o.j.received+' 条，新增 '+o.j.added+' 条，列表共 '+o.j.total+' 条。现在可以去「自动任务」选「从好价列表取」了。';}
        else{msg.className='err';msg.textContent='失败：'+(o.j&&o.j.message?o.j.message:'未知错误');}
      })
      .catch(function(e){btn.disabled=false;msg.className='err';msg.textContent='请求出错：'+e.message;});
  });
})();
</script>
</body>
</html>`;

// 构建并配置 Express 应用（不在此处监听端口，便于测试复用同一份中间件装配）
export function createApp() {
  const app = express();
  // 信任代理：开启后 req.ip 取真实访客 IP（经 X-Forwarded-For）。
  // 开放录入的「同IP段可见」依赖真实访客 IP，故 OPEN_MODE 开启时默认开；否则默认关。
  app.set('trust proxy', config.trustProxy);
  // CORS：默认仅同源（生产由本服务托管前端、开发由 Vite 代理，正常情况下无需跨域）。
  // 如需跨域部署（前端在独立域名），设置环境变量 CORS_ORIGIN="https://your.domain"
  // 或逗号分隔的多个域名；未设置时 origin:false 不返回 Access-Control-Allow-Origin，杜绝任意域调用。
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : false;
  app.use(cors({ origin: corsOrigins }));
  // P2-11：内容安全策略（CSP）。前端为 Vue SPA，构建产物均为外部 JS/CSS 文件（无内联脚本），
  // 故 script-src 限定 'self' 即可阻断任何内联 / 第三方脚本执行，显著降低 localStorage 会话 token 被 XSS 窃取的风险。
  // style-src 允许 'unsafe-inline'（Vue 的 :style 绑定会生成内联样式）；字体来自 Google Fonts 需放行对应源。
  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
      ].join('; ')
    );
    next();
  });
  app.use(express.json({ limit: '256kb' })); // P1：限制请求体大小，防超大 payload DoS

  // 健康检查：并发探测依赖（DB 可读 + real 模式探 smzdm 可达性），整体受 deadline 约束，
  // 任一依赖慢/超时只标 degraded，不拖垮就绪探针（#187）。
  app.get('/api/health', async (req, res) => {
    const db = load();
    const checks = [];
    if (config.smzdmAdapter === 'real') {
      // 仅在 real 模式探外部可达性：HEAD 探 smzdm 关键基址，超时/失败标 degraded（不致命）。
      // 用 { name, fn } 形式显式命名，确保超时（未能返回）时 details 仍能定位到 smzdm 这一路依赖。
      checks.push({
        name: 'smzdm',
        fn: async ({ signal }) => {
          try {
            await fetch('https://user-api.smzdm.com/', { method: 'HEAD', signal, redirect: 'manual' });
            return { name: 'smzdm', ok: true };
          } catch (e) {
            return { name: 'smzdm', ok: false, degraded: true, error: e && e.message };
          }
        }
      });
    }
    const h = await probeHealth(db, { timeoutMs: 2000, checks });
    res.json({
      ok: h.ok,
      degraded: h.degraded,
      details: h.details,
      env: config.nodeEnv,
      adapter: config.smzdmAdapter,
      scheduler: isSchedulerRunning() ? 'on' : 'off', // b8：如实反映调度状态
      port: config.port
    });
  });

  // API 路由
  // P1-1：匿名暴露的高频写/认证接口加固定窗口限流（防爆破 / 防刷量撑爆 db）。
  // 限流状态存内存，按访客 IP 计数；仅对 POST 生效（GET 不受影响）。
  app.post('/api/auth/login', rateLimit({ windowMs: 60000, max: 10, message: '登录尝试过于频繁，请稍后再试' }));
  app.post('/api/users', rateLimit({ windowMs: 60000, max: 20, message: '录入请求过于频繁，请稍后再试' }));
  app.post('/api/users/import', rateLimit({ windowMs: 60000, max: 20, message: '导入请求过于频繁，请稍后再试' }));
  app.post('/api/baoliao/bulk', rateLimit({ windowMs: 60000, max: 30, message: '好价导入过于频繁，请稍后再试' }));
  app.use('/api/admin', rateLimit({ windowMs: 60000, max: 30, message: '管理接口请求过于频繁，请稍后再试' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/clock', clockRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/baoliao', baoliaoRoutes);
  app.use('/api/gpt', gptRoutes);
  app.use('/api/notify', notifyRoutes);
  app.use('/api/assets', assetsRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/update', updateRoutes);

  // 好价批量导入页（同源、免构建；服务端抓不到 smzdm 好价，改由浏览器导入）
  // 该页内嵌可信的「拖拽书签 + 粘贴导入」脚本（服务端生成），需通过 nonce 放行内联脚本——
  // 全局 CSP 默认 script-src 'self' 会拦截内联脚本导致导入按钮失效，故此处用 per-request nonce 单独放行。
  app.get('/baoliao-import', (req, res) => {
    const nonce = randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'nonce-" + nonce + "'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
      ].join('; ')
    );
    res.type('html').send(BAOLIAO_IMPORT_HTML.replace('__NONCE__', nonce));
  });

  // 托管前端构建产物（单进程对外）。
  // 对所有前端响应强制 no-store，并给 index.html 里的资源 URL 追加「构建戳」查询参数，
  // 彻底杜绝浏览器/反向代理缓存旧 JS/CSS 导致“代码已更新但页面仍跑旧逻辑”
  // 的诡异问题（抓包导入「应用失败」反复出现的根因）：
  //   - no-cache 只是“重新校验”，缓存仍可能用 304 命中旧的 index.html；
  //   - no-store 要求任何缓存都不得存储；再叠加 ?v=<构建戳> 使每次部署的资源 URL 都变化，
  //     连不规范的代理缓存也能绕开。
  if (fs.existsSync(config.webDist)) {
    app.use(
      express.static(config.webDist, {
        // index:false 让根路径 "/" 落到下方兜底中间件，以便注入构建戳；
        // 真实资源文件（/assets/*）仍由静态中间件直接服务。
        index: false,
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, must-revalidate')
      })
    );
    // SPA 兜底：读取 index.html，给 /assets/* 注入 ?v=<构建戳>，保证每次部署都拉最新资源
    app.get('*', (req, res) => {
      const htmlPath = path.join(config.webDist, 'index.html');
      fs.readFile(htmlPath, 'utf8', (err, html) => {
        if (err) {
          res.status(404).send('前端未构建：请先 npm run build');
          return;
        }
        let stamp = '0';
        try {
          stamp = String(Math.floor(fs.statSync(htmlPath).mtimeMs));
        } catch {
          /* ignore */
        }
        const busted = html.replace(
          /(href|src)="(\/assets\/[^"?]+)"/g,
          (_m, a, u) => `${a}="${u}?v=${stamp}"`
        );
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.type('html').send(busted);
      });
    });
  }

  // 兜底错误处理
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
    // S10：生产环境不向外暴露内部错误细节（可能含路径），返回泛化消息
    // S10 纵深加固：默认泛化错误响应，仅显式 ZDM_DEBUG=1 才回显内部 err.message（避免 VPS 未设 NODE_ENV=production 时泄露内部细节）
    const message = config.debug ? err.message : '服务器内部错误';
    res.status(500).json({ error: 'server_error', message });
  });

  return app;
}

const app = createApp();

const __filename = fileURLToPath(import.meta.url);
// 仅当以入口模块方式运行（node src/index.js / npm start）才真正监听，
// 被测试动态 import 时不触发，避免测试进程绑定端口 / 启动真实调度。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMain) {
  // 优雅退出：收到 SIGTERM/SIGINT（如 systemd restart）时，先把 debounce 窗口内的修改同步落盘，
  // 再退出，避免合并写（persistSoon）延迟期内进程被杀导致最近改动丢失（P1-4 兜底）。
  let stopping = false;
  const gracefulStop = async (sig) => {
    if (stopping) return;
    stopping = true;
    // eslint-disable-next-line no-console
    console.warn(`[zdmclock] 收到 ${sig}，正在落盘并退出…`);
    try {
      // flushPersist 现已异步：先等待在途的异步落盘（单写者）完成，再做最终同步落盘，
      // 确保 debounce 窗口内与尚未完成的写都不丢失，然后才退出。
      await flushPersist();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[zdmclock] flushPersist 失败', e && e.message);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => { gracefulStop('SIGTERM'); });
  process.on('SIGINT', () => { gracefulStop('SIGINT'); });

  // 致命配置校验（Phase 2 代理认证加固）：TRUST_PROXY_AUTH=true 但未配 PROXY_AUTH_HEADER 时，
  // 任何人直连 /login 都能拿到 apiToken+adminToken，等同把后台裸奔到公网 —— 直接拒绝启动。
  if (config.trustProxyAuth && !config.proxyAuthHeader) {
    console.error(
      '[zdmclock][致命] TRUST_PROXY_AUTH=true 但未配置 PROXY_AUTH_HEADER —— ' +
        '任何人可经 /login 获取管理员 Token，已拒绝启动。请设置 PROXY_AUTH_HEADER（并建议 PROXY_TRUSTED_IPS 绑定可信网段）或关闭 TRUST_PROXY_AUTH。'
    );
    process.exit(1);
  }

  app.listen(config.port, () => {
    // R4：仅在 production 启动定时调度，避免开发态意外触发真实签到
    if (config.nodeEnv === 'production') {
      startScheduler();
    } else {
      // eslint-disable-next-line no-console
      console.warn('[zdmclock] 非 production 环境，定时调度已禁用（开发态不会自动真实签到）。');
    }
    // eslint-disable-next-line no-console
    console.log(
      `[zdmclock] server listening on http://localhost:${config.port} ` +
        `(env=${config.nodeEnv}, adapter=${config.smzdmAdapter}, auth=${config.requireAuth}, scheduler=${isSchedulerRunning() ? 'on' : 'off'})`
    );
    // 安全告警：默认配置偏向「开箱即跑」，但公网暴露前必须收紧
    if (!config.requireAuth) {
      // eslint-disable-next-line no-console
      console.warn(
        '[zdmclock][安全] REQUIRE_AUTH=false —— 所有写接口与管理接口免鉴权。' +
          '公网部署前务必设为 true 并修改 ADMIN_PASSWORD / API_TOKEN。'
      );
    }
    if (config.openMode) {
      // eslint-disable-next-line no-console
      console.warn(
        '[zdmclock][安全] OPEN_MODE=true —— 已启用开放模式，所有业务/数据接口对匿名访客直接放行，' +
          '无需登录/Token。仅限受信任或隔离网络使用；公网裸奔将导致任何人可录入/修改/删除数据。' +
          '系统更新等高危操作仍受 ADMIN_TOKEN 保护。'
      );
    }
    if (config.apiTokenIsDefault) {
      // eslint-disable-next-line no-console
      console.warn(
        '[zdmclock][安全] 未设置 API_TOKEN，本次已生成随机 Token（重启后变更）。' +
          '如需固定 Token 或启用鉴权，请在 .env 显式设置 API_TOKEN。'
      );
    }
    if (config.adminPasswordIsDefault && config.requireAuth && !config.trustProxyAuth) {
      // eslint-disable-next-line no-console
      console.warn('[zdmclock][安全] 仍在使用默认管理员密码 admin123，请尽快设置强 ADMIN_PASSWORD。');
    }
    if (config.openMode && !config.adminToken) {
      // eslint-disable-next-line no-console
      console.warn(
        '[zdmclock][安全] OPEN_MODE=true 但未设置 ADMIN_TOKEN —— 所有改/删/触发类操作对任何人都将拒绝' +
          '（含持 API_TOKEN 者），开放模式将无法执行写操作。如需开放写能力，请设置强 ADMIN_TOKEN。'
      );
    }
  });
}

export { app };
