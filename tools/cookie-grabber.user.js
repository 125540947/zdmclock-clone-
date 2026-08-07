// ==UserScript==
// @name         zdmclock 一键推送 Cookie
// @namespace    https://github.com/125540947/zdmclock-clone-
// @version      1.1.0
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

  // 收集 smzdm 域下的全部 Cookie（含 HttpOnly，document.cookie 拿不到）。
  // ⚠️ 关键修复：用 url 参数（而非 domain）匹配。domain:'smzdm.com' 这种写法常常匹配不到
  // 实际 domain 为 .smzdm.com（带点前缀、覆盖所有子域）的 cookie，会漏掉 HttpOnly 的登录会话，
  // 导致推上去的 cookie 不含有效 session —— smzdm /robot/token 直接回「请先登录」。
  // 改为按 url 列举该站点归属的全部 cookie（含 .smzdm.com 通配 + 各子域 + HttpOnly），最稳妥。
  function collectCookie(done) {
    const urls = [
      'https://www.smzdm.com/',
      'https://m.smzdm.com/',
      'https://zhiyou.smzdm.com/',
      'https://user-api.smzdm.com/'
    ];
    if (typeof GM_cookie === 'object' && GM_cookie && typeof GM_cookie.list === 'function') {
      const out = {};
      let pending = urls.length;
      const finish = () => {
        const str = Object.keys(out)
          .map((k) => k + '=' + out[k])
          .join('; ');
        done(str);
      };
      urls.forEach((u) => {
        try {
          GM_cookie.list({ url: u }, (cookies, error) => {
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
    if (!ZDMC_SERVER) {
      toast('脚本未写入服务地址，请重新从 zdmclock 页面「一键安装」', false);
      return;
    }
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
