// ==UserScript==
// @name         zdmclock 一键推送 Cookie
// @namespace    https://github.com/125540947/zdmclock-clone-
// @version      1.0.0
// @description  在 smzdm 页面一键把登录 Cookie 推送到你的 zdmclock 服务（自动签到助手）。
//               比手动去 DevTools 复制 Cookie 更安全省事：不碰你的 smzdm 密码，且能读取 HttpOnly 的会话 Cookie。
// @match        https://www.smzdm.com/*
// @match        https://m.smzdm.com/*
// @match        https://zhiyou.smzdm.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const getServer = () => (GM_getValue('zdm_server') || '').trim();
  const getToken = () => (GM_getValue('zdm_token') || '').trim();

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

  function openSettings() {
    const server = prompt(
      'zdmclock 服务地址（含端口），例如 http://1.2.3.4:3000',
      getServer()
    );
    if (server === null) return;
    const token = prompt(
      'API_TOKEN（在 .env / 部署输出里，留空则不带鉴权）',
      getToken()
    );
    if (token === null) return;
    GM_setValue('zdm_server', server.trim());
    GM_setValue('zdm_token', token.trim());
    toast('已保存设置：' + server.trim());
  }

  // 收集 smzdm 域下的全部 Cookie（含 HttpOnly，document.cookie 拿不到）。
  function collectCookie(done) {
    const domains = [
      'smzdm.com',
      '.smzdm.com',
      'www.smzdm.com',
      'm.smzdm.com',
      'zhiyou.smzdm.com'
    ];
    if (typeof GM_cookie === 'object' && GM_cookie && typeof GM_cookie.list === 'function') {
      const out = {};
      let pending = domains.length;
      const finish = () => {
        const str = Object.keys(out)
          .map((k) => k + '=' + out[k])
          .join('; ');
        done(str);
      };
      domains.forEach((d) => {
        try {
          GM_cookie.list({ domain: d }, (cookies, error) => {
            if (!error && Array.isArray(cookies)) {
              cookies.forEach((c) => {
                out[c.name] = c.value;
              });
            }
            if (--pending === 0) finish();
          });
        } catch {
          if (--pending === 0) finish();
        }
      });
    } else {
      // 兜底：仅能拿到非 HttpOnly 的 Cookie
      done(document.cookie || '');
    }
  }

  function pushCookie() {
    const server = getServer();
    const token = getToken();
    if (!server) {
      toast('请先在 Tampermonkey 菜单「⚙ zdmclock 设置」里填写服务地址', false);
      openSettings();
      return;
    }
    collectCookie((cookie) => {
      if (!cookie) {
        toast('未读取到任何 smzdm Cookie，请先登录 smzdm', false);
        return;
      }
      const url = server.replace(/\/+$/, '') + '/api/users/import';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
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
            '推送失败：' + (e.error || '网络错误') + '（检查服务地址 / Token / 跨域）',
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

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙ zdmclock 设置', openSettings);
  }

  const init = () => {
    if (document.body) addButton();
    else setTimeout(init, 500);
  };
  init();
})();
