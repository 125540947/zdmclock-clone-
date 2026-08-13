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

// 判断一个 IP 是否为「非公开」（私有 / 回环 / 链路本地 / 保留 / 无法识别）。
// 返回 true 表示不应被信任（保守拒绝）。
export function isPrivateOrReservedIp(ip) {
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
    if (p[0] >= 224) return true; // 组播 / 保留（224/4 ~ 255/8）
    return false;
  }
  if (net.isIPv6(ip)) {
    const lc = ip.toLowerCase();
    if (lc === '::1') return true; // 回环
    if (lc === '::') return true; // 未指定
    if (lc.startsWith('fe80:')) return true; // 链路本地
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
