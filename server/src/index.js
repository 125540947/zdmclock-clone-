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
import { sendError } from './httpError.js';

// 全局未捕获异常兜底（P1-10）：best-effort 的异步推送/解析若遗漏 try/catch，
// 可能触发 unhandledRejection / uncaughtException 导致进程退出。这里统一记录日志、
// 避免静默崩进程；注意：仅记录不自动退出，保证主服务可用。
process.on('unhandledRejection', (reason, _promise) => {
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
  <p class="tip">已登录状态下无需填写 Token——浏览器会自动携带会话 Cookie 完成鉴权（同域请求，不暴露在地址栏）。若提示未授权，请先在主界面登录。</p>
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
    var channelId=cid.value.trim();
    if(!text.trim()){msg.className='err';msg.textContent='请先粘贴链接';return;}
    // M-03 修复：不再把全权限 API Token 拼入查询字符串（会落入代理访问日志/浏览器历史/网络记录），
    // 改用同域会话 Cookie（zb_token，HttpOnly）自动携带完成鉴权。
    var url='/api/baoliao/bulk';
    btn.disabled=true;msg.className='';msg.textContent='导入中…';
    fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,channelId:channelId})})
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
// rateLimit 默认开启（生产安全）；测试可传 { rateLimit: false } 关闭，避免高频写/认证接口
// 的固定窗口限流在「同一测试进程内连续多次登录/录入」时被误触（属测试产物，非真实爆破场景）。
// 限流逻辑本身由 rateLimit.test.js 独立覆盖，关闭不影响逻辑验证。
export function createApp({ rateLimit: enableRateLimit = true } = {}) {
  const app = express();
  // 纵深加固：隐藏技术栈标识，避免响应头 X-Powered-By: Express 泄露服务端框架信息（轻微信息泄露面）。
  app.disable('x-powered-by');
  // 信任代理：开启后 Express 仅当连接来自「受信任代理网段」时才采信 X-Forwarded-For 计算 req.ip。
  // H-01 修复：不再无差别 `true`（那样直连暴露的客户端可伪造 XFF 绕过限流与网段隔离），
  // 而是绑定到具体可信网段（PROXY_TRUSTED_SUBNET，留空默认 loopback 匹配本机 nginx 反代）。
  // 这样 req.ip / 限流键 / 开放模式网段判定统一以「可信来源的真实访客 IP」为准；直连非代理连接仍用网络层 IP。
  app.set('trust proxy', config.trustProxy ? (config.proxyTrustedSubnet || 'loopback') : false);
  // CORS：默认仅同源（生产由本服务托管前端、开发由 Vite 代理，正常情况下无需跨域）。
  // 如需跨域部署（前端在独立域名），设置环境变量 CORS_ORIGIN="https://your.domain"
  // 或逗号分隔的多个域名；未设置时 origin:false 不返回 Access-Control-Allow-Origin，杜绝任意域调用。
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : false;
  // M-08 修复：分域部署（前端在独立域名）时，后端 CORS 必须同时返回
  // Access-Control-Allow-Credentials: true，否则浏览器不会在跨域请求中携带 HttpOnly 会话 Cookie，
  // 登录与全部受保护 API 将失效。同源部署（corsOrigins=false）无需凭据头。
  app.use(cors({ origin: corsOrigins, credentials: !!corsOrigins }));
  // P2-11：内容安全策略（CSP）。前端为 Vue SPA，构建产物均为外部 JS/CSS 文件（无内联脚本），
  // 故 script-src 限定 'self' 即可阻断任何内联 / 第三方脚本执行，显著降低 HttpOnly 会话 Cookie 被 XSS 窃取的风险。
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
  // 禁止浏览器缓存 API 响应（P2 修复）：默认 Express 给 JSON 响应加 ETag，浏览器据此发
  // If-None-Match 条件请求，命中回 304（空 body），前端 axios 解析到空 data → 误判空列表
  // （如「获取模型」服务端返回 11 个模型、浏览器却显「未获取到模型列表」）。统一加 no-store
  // 杜绝陈旧/空缓存造成的「服务端有数据、浏览器显空」错位。
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
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
  if (enableRateLimit) {
    app.post('/api/auth/login', rateLimit({ windowMs: 60000, max: 10, message: '登录尝试过于频繁，请稍后再试' }));
    app.post('/api/users', rateLimit({ windowMs: 60000, max: 20, message: '录入请求过于频繁，请稍后再试' }));
    app.post('/api/users/import', rateLimit({ windowMs: 60000, max: 20, message: '导入请求过于频繁，请稍后再试' }));
    app.post('/api/baoliao/bulk', rateLimit({ windowMs: 60000, max: 30, message: '好价导入过于频繁，请稍后再试' }));
    app.use('/api/admin', rateLimit({ windowMs: 60000, max: 30, message: '管理接口请求过于频繁，请稍后再试' }));
  }
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
        // L-01 修复：/assets/* 的文件名已含内容哈希，可长期缓存（public + immutable），
        // 无需 no-store——此前的统一 no-store 导致每次页面访问都重传 JS/CSS，浪费带宽与静态 IO。
        // index.html 等 HTML 仍由下方 SPA 兜底强制 no-store（见 L-01）。
        setHeaders: (res, filePath) => {
          if (/[\\/]assets[\\/]/.test(String(filePath))) {
            res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-store, must-revalidate');
          }
        }
      })
    );
    // 未知 /api 路由返回 JSON 404（须位于所有 API 路由器之后、SPA 兜底之前），
    // 避免被下方 SPA 兜底以 200 HTML 吞掉，干扰 API 客户端的错误判定与监控。
    app.use('/api', (req, res) => {
      res.status(404).json({ error: 'not_found', message: '未知接口' });
    });
    // SPA 兜底：读取 index.html，给 /assets/* 注入 ?v=<构建戳>，保证每次部署都拉最新资源
    // A-04：缓存 index.html 文本，仅当文件 mtime 变化才重新读取，避免每个 SPA 兜底请求都 fs.readFile（高频路径）。
    let spaCache = { mtime: 0, html: null };
    function loadSpaHtml() {
      const htmlPath = path.join(config.webDist, 'index.html');
      let mtime = 0;
      try { mtime = fs.statSync(htmlPath).mtimeMs; } catch { /* 文件不存在 */ }
      if (spaCache.html === null || spaCache.mtime !== mtime) {
        try {
          spaCache = { mtime, html: fs.readFileSync(htmlPath, 'utf8') };
        } catch {
          spaCache = { mtime, html: null };
        }
      }
      return spaCache.html;
    }
    app.get('*', (req, res) => {
      const html = loadSpaHtml();
      if (html === null) {
        res.status(404).send('前端未构建：请先 npm run build');
        return;
      }
      const stamp = String(Math.floor(spaCache.mtime));
      const busted = html.replace(
        /(href|src)="(\/assets\/[^"?]+)"/g,
        (_m, a, u) => `${a}="${u}?v=${stamp}"`
      );
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.type('html').send(busted);
    });
  }

  // 兜底错误处理
  app.use((err, req, res, _next) => {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
    // S10：生产环境不向外暴露内部错误细节（可能含路径），返回泛化消息
    // S10 纵深加固：默认泛化错误响应，仅显式 ZDM_DEBUG=1 才回显内部 err.message（避免 VPS 未设 NODE_ENV=production 时泄露内部细节）
    const message = config.debug ? err.message : '服务器内部错误';
    // A-09：统一错误信封——全局兜底也返回 { ok:false, error, message }，与业务成功 { ok:true, ... } 对称。
    sendError(res, { status: 500, error: 'server_error', message });
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

  // 致命配置校验（Phase 2 代理认证加固 / H-05 修复）：TRUST_PROXY_AUTH=true 时，必须同时配置
  // PROXY_AUTH_HEADER（已认证用户请求头）与 PROXY_TRUSTED_IPS（来源 IP 白名单）。
  // 缺 PROXY_AUTH_HEADER：任何人直连 /login 都能拿到 Token，等同后台裸奔公网；
  // 缺 PROXY_TRUSTED_IPS：来源 IP 白名单退化为「不限制」（ipInCidrList 空列表返回 true），
  // 直连暴露时攻击者可自带头绕过代理认证拿到 Token —— 两种误配均直接拒绝启动。
  if (config.trustProxyAuth && (!config.proxyAuthHeader || !config.proxyTrustedIps)) {
    console.error(
      '[zdmclock][致命] TRUST_PROXY_AUTH=true 但缺少 PROXY_AUTH_HEADER 或 PROXY_TRUSTED_IPS —— ' +
        '缺少任一项都会让 /login 代理鉴权分支退化为「任意来源/任意请求」可放行，等同把后台裸奔到公网，' +
        '已拒绝启动。请同时设置 PROXY_AUTH_HEADER 与 PROXY_TRUSTED_IPS（绑定可信网段）或关闭 TRUST_PROXY_AUTH。'
    );
    process.exit(1);
  }

  // M-06 修复：非法 IANA 时区在 Intl.DateTimeFormat 构造时抛 RangeError，
  // 调度 tick 捕获后整轮跳过、依赖日期的同步 API 经全局错误处理返回 500，错误配置不在启动阶段暴露。
  // 这里强制校验 ZDM_TZ：仅允许 'local' / 'UTC' / 合法 IANA 时区，否则拒绝启动（fail-fast）。
  const isValidTimeZone = (t) => {
    if (!t || t === 'local' || t === 'UTC') return true;
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: t });
      return true;
    } catch {
      return false;
    }
  };
  if (!isValidTimeZone(config.tz)) {
    console.error(
      `[zdmclock][致命] ZDM_TZ=${JSON.stringify(config.tz)} 不是合法时区（仅支持 'local' / 'UTC' / IANA 时区如 'Asia/Shanghai'）——` +
        '已拒绝启动。请修正 ZDM_TZ 后重试。'
    );
    process.exit(1);
  }

  // M-08 安全提示：跨站部署（CORS_ORIGIN 指向独立域名）时，会话 Cookie 会被设为 SameSite=None; Secure，
  // 必须经 TLS 传输才能被浏览器存储/发送，否则登录失效。未启用 HTTPS（COOKIE_SECURE!=1 且非 production）时提前告警。
  if (process.env.CORS_ORIGIN && process.env.COOKIE_SECURE !== '1' && config.nodeEnv !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(
      '[zdmclock][安全] 已配置 CORS_ORIGIN（跨站前端）但未启用 TLS（COOKIE_SECURE!=1 且非 production）。' +
        '跨站凭据 Cookie 需经 HTTPS 传输，否则浏览器不会存储会话 Cookie，登录将失效。请配置 HTTPS 后部署。'
    );
  }

  app.listen(config.port, config.bindAddress, () => {
    // R4：仅在 production 启动定时调度，避免开发态意外触发真实签到
    if (config.nodeEnv === 'production') {
      startScheduler();
    } else {
      // eslint-disable-next-line no-console
      console.warn('[zdmclock] 非 production 环境，定时调度已禁用（开发态不会自动真实签到）。');
    }
    // eslint-disable-next-line no-console
    console.log(
      `[zdmclock] server listening on http://${config.bindAddress}:${config.port} ` +
        `(env=${config.nodeEnv}, adapter=${config.smzdmAdapter}, auth=${config.requireAuth}, ` +
        `trustProxy=${config.trustProxy ? (config.proxyTrustedSubnet || 'loopback') : 'off'}, ` +
        `scheduler=${isSchedulerRunning() ? 'on' : 'off'})`
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
    if (config.adminPasswordGenerated) {
      // eslint-disable-next-line no-console
      console.warn(
        '[zdmclock][安全] 未设置 ADMIN_PASSWORD，已自动生成随机管理员密码（本次启动有效）：' +
          config.adminPassword +
          ' —— 请尽快在 .env 显式设置固定强密码，否则重启后将变更。'
      );
    }
    if (config.adminPasswordIsWeak && config.requireAuth && !config.trustProxyAuth) {
      // eslint-disable-next-line no-console
      console.warn('[zdmclock][安全] 仍在使用弱管理员密码（admin123 / 空 / 常见弱口令）。请尽快设置强 ADMIN_PASSWORD，否则公网暴露等同于无鉴权。');
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
