import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
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
import extremeLazyRoutes from './routes/extremeLazy.js';
import { startScheduler, isSchedulerRunning } from './scheduler.js';

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
  <p><textarea id="links" placeholder="把 smzdm 文章链接粘贴到这里，每行一个，或任意含链接的文本"></textarea></p>
  <p><button id="imp">导入好价</button> <span class="tip">（链接形如 https://www.smzdm.com/p/123456789/ ）</span></p>
  <div id="msg"></div>
</div>
<script>
(function(){
  var bm=document.getElementById('bm');
  var bk="javascript:(function(){var L=[].slice.call(document.querySelectorAll('a')).filter(function(a){return a.href&&a.href.indexOf('/p/')!==-1;}).map(function(a){return a.href;}).filter(function(v,i,arr){return arr.indexOf(v)===i;});var sep=String.fromCharCode(10);var t=L.join(sep);function sh(){window.prompt('已抓取 '+L.length+' 条，请复制：',t);}try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){alert('已复制 '+L.length+' 条好价链接，去 zdmclock 粘贴导入');},sh);}else{sh();}}catch(e){sh();}})();";
  bm.href=bk;
  var btn=document.getElementById('imp');
  var msg=document.getElementById('msg');
  btn.addEventListener('click',function(){
    var text=document.getElementById('links').value;
    var token=document.getElementById('token').value.trim();
    if(!text.trim()){msg.className='err';msg.textContent='请先粘贴链接';return;}
    var url='/api/baoliao/bulk'+(token?('?token='+encodeURIComponent(token)):'');
    btn.disabled=true;msg.className='';msg.textContent='导入中…';
    fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text})})
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
  // CORS：默认仅同源（生产由本服务托管前端、开发由 Vite 代理，正常情况下无需跨域）。
  // 如需跨域部署（前端在独立域名），设置环境变量 CORS_ORIGIN="https://your.domain"
  // 或逗号分隔的多个域名；未设置时 origin:false 不返回 Access-Control-Allow-Origin，杜绝任意域调用。
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : false;
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json());

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      env: config.nodeEnv,
      adapter: config.smzdmAdapter,
      scheduler: isSchedulerRunning() ? 'on' : 'off', // b8：如实反映调度状态
      port: config.port
    });
  });

  // API 路由
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
  app.use('/api/extreme-lazy', extremeLazyRoutes);

  // 好价批量导入页（同源、免构建；服务端抓不到 smzdm 好价，改由浏览器导入）
  app.get('/baoliao-import', (req, res) => {
    res.type('html').send(BAOLIAO_IMPORT_HTML);
  });

  // 生产环境：托管前端构建产物（单进程对外）
  if (config.nodeEnv === 'production' && fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.get('*', (req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  // 兜底错误处理
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
    // S10：生产环境不向外暴露内部错误细节（可能含路径），返回泛化消息
    const message = config.nodeEnv === 'production' ? '服务器内部错误' : err.message;
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
    if (config.apiTokenIsDefault) {
      // eslint-disable-next-line no-console
      console.warn(
        '[zdmclock][安全] 未设置 API_TOKEN，本次已生成随机 Token（重启后变更）。' +
          '如需固定 Token 或启用鉴权，请在 .env 显式设置 API_TOKEN。'
      );
    }
    if (config.adminPasswordIsDefault && config.requireAuth) {
      // eslint-disable-next-line no-console
      console.warn('[zdmclock][安全] 仍在使用默认管理员密码 admin123，请尽快设置强 ADMIN_PASSWORD。');
    }
  });
}

export { app };
