// DNS 重绑定（DNS Rebinding）防护工具（Phase 2 · #182）
//
// 背景：白名单只校验「主机名」（如仅放行 smzdm.com 及其子域），但连接时的实际目标由 DNS 解析决定。
// 若攻击者可操纵本机/上游 DNS 解析（投毒、恶意解析器、或把合法域名指向内网 IP），白名单形同虚设——
// Cookie / 推送数据可能被发往内网地址（如 169.254.169.254 云元数据、10/8 内网）。
//
// 对策：在真正发请求前，解析目标主机名并确认其解析到的「所有」IP 均为公开地址（非私有 / 回环 /
// 链路本地 / 保留）。任一地址非公开即拒绝连接。
//
// 解析器可注入（setDnsResolver），便于单测不触发真实网络；默认用 node:dns.promises.lookup。
import net from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

// 测试专用：允许把内网/回环地址视为「公开」，以便在本地服务器上验证 pinnedFetch 的成功路径（不影响生产）。
let _allowPrivateIpsForTest = false;
export function __testSetAllowPrivateIps(v) {
  _allowPrivateIpsForTest = !!v;
}

// 判断一个 IP 是否为「非公开」（私有 / 回环 / 链路本地 / 保留 / 无法识别）。
// 返回 true 表示不应被信任（保守拒绝）。
//
// H-03 修复：补齐此前遗漏的多类保留/非公网地址段，避免 DNS 重绑定防护被绕过：
//   IPv4：100.64.0.0/10（运营商级 NAT / CGNAT）、192.0.0.0/24（IETF 协议分配）、
//         198.18.0.0/15（基准网络 / 网络设备自检）。
//   IPv6：fe80::/10 链路本地（此前仅匹配 fe80: 前缀，fe90::/febf:: 等同样属链路本地却判为公开）、
//         ff00::/8 组播（组播地址不可作为单播连接目标，且唯一本地地址也算保留）。
export function isPrivateOrReservedIp(ip) {
  if (_allowPrivateIpsForTest) return false; // 测试专用：放行内网/回环以便本地验证
  if (!ip || typeof ip !== 'string') return true; // 无法识别 → 保守拒绝
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p.some((x) => Number.isNaN(x) || x > 255)) return true;
    if (p[0] === 0) return true; // 0.0.0.0/8
    if (p[0] === 10) return true; // 10/8
    if (p[0] === 127) return true; // 127/8 回环
    if (p[0] === 169 && p[1] === 254) return true; // 169.254/16 链路本地（云元数据）
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true; // 192.168/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // 100.64.0.0/10（CGNAT）
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true; // 192.0.0.0/24（IETF 协议分配）
    if (p[0] === 198 && p[1] >= 18 && p[1] <= 19) return true; // 198.18.0.0/15（基准网络）
    if (p[0] >= 224) return true; // 组播 / 保留（224/4 ~ 255/8）
    return false;
  }
  if (net.isIPv6(ip)) {
    const lc = ip.toLowerCase();
    if (lc === '::1') return true; // 回环
    if (lc === '::') return true; // 未指定
    // 按首 hextet 判定范围（避免此前仅 `fe80:` 前缀匹配漏掉 fe90::/febf:: 等链路本地）：
    //   fe80::/10    链路本地  → 首段 [0xfe80, 0xfebf]
    //   ff00::/8     组播      → 首段 [0xff00, 0xffff]
    //   fc00::/7     唯一本地  → 首段 [0xfc00, 0xfdff]
    const firstHex = lc.split(':')[0];
    const firstVal = parseInt(firstHex, 16);
    if (!Number.isNaN(firstVal)) {
      if (firstVal >= 0xfe80 && firstVal <= 0xfebf) return true; // 链路本地 fe80::/10
      if ((firstVal & 0xff00) === 0xff00) return true; // 组播 ff00::/8
      if (firstVal >= 0xfc00 && firstVal <= 0xfdff) return true; // 唯一本地 fc00::/7
    }
    // 兜底（首 hextet 无法解析时）：fc/fd 前缀仍判保留
    if (lc.startsWith('fc') || lc.startsWith('fd')) return true; // 唯一本地（ULA）
    // IPv4 映射地址 ::ffff:x.x.x.x / ::ffff:x.x.x.x%zone
    const v4 = lc.startsWith('::ffff:') ? lc.slice('::ffff:'.length).split('%')[0] : null;
    if (v4 && net.isIPv4(v4)) return isPrivateOrReservedIp(v4);
    return false; // 其余公开 IPv6（生产环境少见，放行）
  }
  return true; // 非标准格式 → 保守拒绝
}

let _lookup = (host, opts) => dns.promises.lookup(host, opts);
// 注入自定义解析器（主要用于单测，避免触发真实网络）。
export function setDnsResolver(fn) {
  _lookup = fn;
}
export function getDnsResolver() {
  return _lookup;
}

// 解析 hostname 并要求所有地址均为公开 IP。返回地址数组（便于上层 pin / 审计）。
// 任一地址非公开 → 抛出（疑似 DNS 重绑定）。
//
// ⚠️ 残留限制（H-03，零依赖方案）：Node 内置 fetch 不支持把解析结果「钉死」到具体 IP 再连接，
// 因此这里在发请求前解析一次并校验（收紧保留地址段），但 fetch 仍会自行再次解析，两者之间存在
// 极小的 DNS 重绑定时间窗。在数据中心 IP 反爬 / 凭据出口场景下，本校验已能拦住绝大多数重绑定攻击；
// 若要求绝对消除该窗口，需引入 undici 的 dispatcher（pin IP）并把 realAdapter 的 fetch 替换为 undici 请求，
// 但这会破坏本项目「源码直拉 + 零 npm install」的部署模型，故当前采用零依赖方案，文档标注此残留。
export async function assertPublicDns(hostname, lookup = _lookup) {
  let addrs;
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new Error(`DNS 解析失败，已拒绝连接 @ ${hostname}`);
  }
  if (!Array.isArray(addrs) || addrs.length === 0) {
    throw new Error(`DNS 解析无结果，已拒绝连接 @ ${hostname}`);
  }
  for (const a of addrs) {
    const addr = typeof a === 'string' ? a : a && a.address;
    if (addr == null) continue;
    if (isPrivateOrReservedIp(addr)) {
      throw new Error(`目标解析到非公开地址（疑似 DNS 重绑定）@ ${hostname} → ${addr}`);
    }
  }
  return addrs.map((a) => (typeof a === 'string' ? a : a.address));
}

// M-09 修复：DNS 重绑定 TOCTOU 闭环（零依赖，不引入 undici，保持「源码直拉 + 零 npm install」部署模型）。
//
// 背景：本文件 assertPublicDns 先用 dns.lookup 校验「域名解析到的所有 IP 均为公开地址」，随后若交给
// 内置 fetch 再次独立解析域名并发起连接，两次解析之间存在可被攻击者利用的时间窗——DNS 在两次解析间
// 若返回内网/云元数据地址，完整 Cookie 等凭据可能被导到非预期目标。
//
// 修复：把校验通过的 IP「钉死」到本次 TCP 连接——用内置 http/https 的自定义 lookup 直接返回已校验 IP，
// 使实际连接目标 == 已校验 IP，fetch 不再二次解析域名，从根上消除 TOCTOU。
//   - TLS 仍按原始主机名校验证书（servername 取自 URL host），Host 请求头保持原主机名；
//   - redirect:'manual' 由调用方处理（本函数不跟随重定向）；
//   - 透明处理 gzip/deflate/br 压缩（与 fetch 默认行为一致）；
//   - 返回对象兼容 fetch 的 Response 契约（status / ok / headers.get / body.getReader / arrayBuffer / text / json），
//     以便 readBodyCapped 等既有消费方无需改动。
async function _pinnedRequest(u, init) {
  // 校验域名解析到的所有 IP 均公开（含保留地址段收紧），并取回已校验地址集用于钉死。
  const addrs = await assertPublicDns(u.hostname);
  // 优先 IPv4，其次 IPv6；assertPublicDns 已保证全部公开。
  const pinned = addrs.find((a) => net.isIPv4(a)) || addrs[0];
  const family = net.isIPv4(pinned) ? 4 : 6;
  const lib = u.protocol === 'https:' ? https : http;
  const method = (init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers || {}) };
  // 默认接受压缩（与 fetch 行为一致），下方按 content-encoding 透明解压
  if (!('accept-encoding' in headers || 'Accept-Encoding' in headers)) {
    headers['accept-encoding'] = 'gzip, deflate, br';
  }
  const body = init.body != null ? init.body : null;
  if (body != null && typeof body === 'string' && !('content-length' in headers || 'Content-Length' in headers)) {
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  const signal = init.signal || null;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      u,
      {
        method,
        headers,
        // 钉死连接目标：无论 DNS 后续如何解析，本次连接只去已校验的 IP（消除两次解析间重绑定窗口）
        // 注意：Node http.request 以 { all: true } 调用 lookup，回调签名为 (err, [{address, family}])；
        // 但部分路径以 all:false 调用，签名为 (err, address, family)。两种形态都需兼容。
        lookup: (_hostname, opts, cb) => {
          if (opts && opts.all) cb(null, [{ address: pinned, family }]);
          else cb(null, pinned, family);
        }
      },
      (res) => {
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        let stream = res;
        if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
        else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
        else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());
        const bodyStream = Readable.toWeb(stream);
        const getHeader = (k) => {
          const v = res.headers[String(k).toLowerCase()];
          return v != null ? (Array.isArray(v) ? v.join(', ') : v) : null;
        };
        const resp = {
          url: u.toString(),
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: { get: getHeader },
          body: bodyStream,
          arrayBuffer: async () => {
            const chunks = [];
            for await (const c of bodyStream) chunks.push(Buffer.from(c));
            return Buffer.concat(chunks);
          },
          text: async () => {
            const chunks = [];
            for await (const c of bodyStream) chunks.push(Buffer.from(c));
            return Buffer.concat(chunks).toString('utf8');
          },
          json: async () => JSON.parse(await resp.text())
        };
        resolve(resp);
      }
    );
    const onAbort = () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      req.destroy(err);
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('error', (e) => reject(e));
    if (body != null) {
      if (typeof body === 'string' || Buffer.isBuffer(body)) req.write(body);
      else if (body && typeof body.pipe === 'function') body.pipe(req);
      else req.write(String(body));
    }
    req.end();
  });
}

// M-09：对外凭据出口（realAdapter.call）与用户 webhook（notifier.safePushFetch）使用的「校验 + 钉死」请求封装。
// 调用方仍需各自先做白名单校验（isSafeSmzdmUrl / isSafePushUrl）；本函数只负责 DNS 重绑定闭环与兼容性适配。
export async function pinnedFetch(url, init = {}) {
  const u = new URL(url);
  return _pinnedRequest(u, init);
}
