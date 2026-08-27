// ==UserScript==
// @name         zdmclock 一键推送 Cookie + 自动导入好价
// @namespace    https://github.com/125540947/zdmclock-clone-
// @version      1.2.0
// @description  在 smzdm 页面：①一键把登录 Cookie 推送到你的 zdmclock 服务；②访问好价列表页时自动把文章抓取导入爆料箱（全自动，零点击）。服务地址与 Token 已由本服务自动写入，无需手动配置。
// @match        https://www.smzdm.com/*
// @match        https://m.smzdm.com/*
// @match        https://zhiyou.smzdm.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @connect      __CONNECT__
// ==/UserScript==

(function () {
  'use strict';

  // 以下两项由本服务的「一键安装」自动注入（服务地址 + 鉴权 Token），
  // 普通用户无需在油猴菜单里手填——这也是 v1.1 相比旧版最大的简化点。
  const ZDMC_SERVER = __SERVER__;
  const ZDMC_TOKEN = __TOKEN__;

  function toast(msg, ok) {
    let el = document.getElementById('zdm_toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'zdm_toast';
      el.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;' +
        'padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.5;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.25);background:#222;color:#fff;opacity:0;' +
        'transition:opacity .2s;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = ok === false ? '#b00' : '#222';
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.opacity = '0';
    }, 3500);
  }

  // v1.1.3 修复：① 主路径用 domain 抓全（含通配域 sess/__ckguid）；
  // ② 看门狗：若 domain 方式不回调/返回空（部分油猴实现不支持 domain 参数），
  //    2.5s 后自动退回多 url 列举（含 apex https://smzdm.com/，能抓到通配/apex 登录态）；
  // ③ 兼容两种回调签名 (cookies,error) 与 (error,cookies)；④ 全程 console 调试日志。
  function collectCookie(done) {
    let settled = false;
    const merge = (cookies) => {
      const map = {};
      (cookies || []).forEach((c) => {
        if (!c || !c.name) return;
        const isWild = c.domain && c.domain.indexOf('.smzdm.com') !== -1;
        const existing = map[c.name];
        if (!existing || (isWild && !existing.wild)) map[c.name] = { value: c.value, wild: isWild };
      });
      return map;
    };
    const finish = (map) => {
      if (settled) return;
      settled = true;
      const str = Object.keys(map).map((k) => k + '=' + map[k].value).join('; ');
      console.log('[zdmclock] cookie 拼接完成，键数=', Object.keys(map).length,
        '含sess=', !!map.sess, '含__ckguid=', !!map.__ckguid);
      done(str);
    };

    if (typeof GM_cookie === 'object' && GM_cookie && typeof GM_cookie.list === 'function') {
      try {
        GM_cookie.list({ domain: 'smzdm.com' }, function (a, b) {
          const cookies = Array.isArray(a) ? a : (Array.isArray(b) ? b : null);
          console.log('[zdmclock] domain 方式回调，cookie 数=', cookies ? cookies.length : 0);
          if (cookies && cookies.length) finish(merge(cookies));
          // 空/无效则不动，等看门狗走 url 兜底
        });
      } catch (e) {
        console.log('[zdmclock] domain 方式异常，转 url 兜底:', e && e.message);
      }
      // 看门狗：domain 无回调或返回空 → 多 url 列举兜底
      setTimeout(function () {
        if (!settled) {
          console.log('[zdmclock] domain 超时/空，启用 url 兜底');
          fallbackUrlCollect(finish);
        }
      }, 2500);
    } else {
      console.log('[zdmclock] 无 GM_cookie，退回 document.cookie');
      done(document.cookie || '');
    }
  }

  // 兜底：按多个 url（含 apex）列举再合并（首个来源优先，不覆盖）
  function fallbackUrlCollect(cb) {
    const urls = [
      'https://smzdm.com/',
      'https://www.smzdm.com/',
      'https://m.smzdm.com/',
      'https://zhiyou.smzdm.com/',
      'https://user-api.smzdm.com/'
    ];
    const perUrl = [];
    let pending = urls.length;
    const finish = () => {
      const out = {};
      for (const m of perUrl) for (const k in m) if (!(k in out)) out[k] = m[k];
      cb(out);
    };
    urls.forEach((u, idx) => {
      try {
        GM_cookie.list({ url: u }, (cookies, error) => {
          perUrl[idx] = {};
          if (!error && Array.isArray(cookies)) cookies.forEach((c) => { if (c && c.name) perUrl[idx][c.name] = c.value; });
          if (--pending === 0) finish();
        });
      } catch {
        perUrl[idx] = {};
        if (--pending === 0) finish();
      }
    });
  }

  function pushCookie() {
    if (!ZDMC_SERVER) {
      toast('脚本未写入服务地址，请重新从 zdmclock 页面「一键安装」', false);
      return;
    }
    toast('正在读取 Cookie…');
    collectCookie((cookie) => {
      if (!cookie) {
        toast('未读取到任何 smzdm Cookie，请先登录 smzdm', false);
        return;
      }
      const url = String(ZDMC_SERVER).replace(/\/+$/, '') + '/api/users/import';
      const headers = { 'Content-Type': 'application/json' };
      if (ZDMC_TOKEN) headers['Authorization'] = 'Bearer ' + ZDMC_TOKEN;
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers,
        data: JSON.stringify({ cookie }),
        onload: (r) => {
          let msg = '推送成功';
          try {
            const j = JSON.parse(r.responseText);
            if (j.nickname)
              msg = '已导入：' + j.nickname + (j.upserted ? '（更新）' : '（新建）');
            else if (j.message) msg = j.message;
          } catch {
            /* ignore parse */
          }
          toast(msg, true);
        },
        onerror: (e) => {
          toast(
            '推送失败：' + (e.error || '网络错误') + '（检查服务地址 / 跨域）',
            false
          );
        }
      });
    });
  }

  // ---------- 好价自动导入（v1.2.0） ----------
  // 从当前页提取所有 smzdm 文章链接（/p/<id>），去重后返回 {url,title} 列表。
  function extractBaoliaoLinks() {
    const anchors = Array.from(document.querySelectorAll('a[href*="/p/"]'));
    const seen = new Set();
    const items = [];
    for (const a of anchors) {
      const href = a.href || '';
      const m = href.match(/\/p\/(\d+)/);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const title = (a.getAttribute('title') || a.textContent || '').trim().slice(0, 200);
      items.push({ url: 'https://www.smzdm.com/p/' + id, title: title || ('文章 ' + id) });
    }
    return items;
  }

  // 仅对「好价列表/频道/首页」生效，跳过文章详情页（/p/ 在路径里）与无内容的页。
  function isListPage() {
    if (/\/p\/\d+/.test(location.pathname)) return false;
    return extractBaoliaoLinks().length >= 3;
  }

  function pushBaoliao(items, silent) {
    if (!items || !items.length) {
      if (!silent) toast('本页未找到好价文章链接', false);
      return;
    }
    if (!ZDMC_SERVER) {
      if (!silent) toast('脚本未写入服务地址，请重新从 zdmclock 页面「一键安装」', false);
      return;
    }
    const url = String(ZDMC_SERVER).replace(/\/+$/, '') + '/api/baoliao/bulk';
    const headers = { 'Content-Type': 'application/json' };
    // 跨域脚本无法携带 HttpOnly 会话 Cookie，凭窄权限 INSTALL_TOKEN（即本脚本注入的 ZDMC_TOKEN）鉴权，
    // 后端 /baoliao/bulk 已放宽为 authRequiredOrInstall 接受该令牌。
    if (ZDMC_TOKEN) headers['Authorization'] = 'Bearer ' + ZDMC_TOKEN;
    GM_xmlhttpRequest({
      method: 'POST',
      url,
      headers,
      data: JSON.stringify({ items }),
      onload: (r) => {
        let added = 0, received = 0, ok = false;
        try {
          const j = JSON.parse(r.responseText);
          ok = j.ok; added = j.added || 0; received = j.received || 0;
        } catch { /* ignore */ }
        if (ok) {
          if (added > 0) toast('好价自动导入：新增 ' + added + ' / 本页 ' + received, true);
          else if (!silent) toast('好价已是最新（本页 ' + received + ' 条均已导入）', true);
        } else if (!silent) {
          toast('好价导入失败：' + (r.responseText || r.status) , false);
        }
      },
      onerror: (e) => {
        if (!silent) toast('好价导入失败：' + (e.error || '网络错误'), false);
      }
    });
  }

  // 自动路径：列表页加载即导入一次；常开标签页每 15 分钟轮询刷新（mergeBaoliao 按 url 去重，重复导入 added=0，不会爆库）。
  function autoBaoliao() {
    if (!isListPage()) return;
    pushBaoliao(extractBaoliaoLinks(), true); // 静默：自动轮询不打扰
    if (!window.__zdm_baoliao_timer) {
      window.__zdm_baoliao_timer = setInterval(() => {
        if (isListPage()) pushBaoliao(extractBaoliaoLinks(), true);
      }, 15 * 60 * 1000);
    }
  }

  function manualBaoliao() {
    if (!isListPage()) {
      toast('请在好价列表/频道页使用（详情页无批量链接）', false);
      return;
    }
    pushBaoliao(extractBaoliaoLinks(), false);
  }

  function addButton(id, text, bg, handler) {
    if (document.getElementById(id)) return;
    const btn = document.createElement('div');
    btn.id = id;
    btn.textContent = text;
    btn.style.cssText =
      'position:fixed;right:16px;z-index:2147483647;cursor:pointer;' +
      'padding:8px 12px;border-radius:8px;color:#fff;' +
      'font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.25);background:' + bg + ';';
    btn.addEventListener('click', handler);
    document.body.appendChild(btn);
    return btn;
  }

  function addButtons() {
    // 顶部：推送 Cookie
    addButton('zdm_push_btn', '🍪 推送到 zdmclock', '#e63946', pushCookie);
    // 顶部下方：手动抓好价（自动路径已零点击，此按钮作兜底/详情页手动触发）
    const bl = addButton('zdm_baoliao_btn', '📥 抓好价', '#2a9d8f', manualBaoliao);
    if (bl) bl.style.top = '108px';
    // 自动路径：列表页加载即后台导入（无提示打扰）
    autoBaoliao();
  }

  const init = () => {
    if (document.body) addButtons();
    else setTimeout(init, 500);
  };
  init();
})();
