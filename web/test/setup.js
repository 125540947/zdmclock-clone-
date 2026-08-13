// M-09 配套：localStorage 兼容垫片。
// 不同 jsdom / Node 版本下 localStorage 可用性不一致：Node 25 + jsdom 对 opaque origin 的
// localStorage 访问会抛错，导致多个前端测试失败。当真实 localStorage 不可用或访问抛错时，
// 提供一个进程级内存 shim，使测试行为不依赖具体 jsdom 版本（真实可用时保持原样，零影响）。
function installLocalStorageShim() {
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? String(store.get(k)) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => (i >= 0 && i < store.size ? [...store.keys()][i] : null),
    get length() {
      return store.size;
    }
  };
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true });
  }
}

try {
  const probe = globalThis.localStorage;
  if (probe && typeof probe.getItem === 'function') {
    probe.getItem('__zdm_probe__');
  } else {
    installLocalStorageShim();
  }
} catch {
  installLocalStorageShim();
}
