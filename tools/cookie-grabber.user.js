// ==UserScript==
// @name         zdmclock 一键推送 Cookie
// @namespace    https://github.com/125540947/zdmclock-clone-
// @version      1.1.3
// @description  在 smzdm 页面一键把登录 Cookie 推送到你的 zdmclock 服务（自动签到助手）。服务地址与 Token 已由本服务自动写入，无需在油猴菜单里手动配置。
// @match        https://www.smzdm.com/*
// @match        https://m.smzdm.com/*
// @match        https://zhiyou.smzdm.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @connect      *
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

  function addButton() {
    if (document.getElementById('zdm_push_btn')) return;
    const btn = document.createElement('div');
    btn.id = 'zdm_push_btn';
    btn.textContent = '🍪 推送到 zdmclock';
    btn.style.cssText =
      'position:fixed;right:16px;top:64px;z-index:2147483647;cursor:pointer;' +
      'padding:8px 12px;border-radius:8px;background:#e63946;color:#fff;' +
      'font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.25);';
    btn.addEventListener('click', pushCookie);
    document.body.appendChild(btn);
  }

  const init = () => {
    if (document.body) addButton();
    else setTimeout(init, 500);
  };
  init();
})();
