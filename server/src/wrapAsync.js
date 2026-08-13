// M-15 修复：Express 4 不会自动捕获 async 路由处理器中 reject 的 Promise，
// 未处理的拒绝会使 HTTP 请求永久挂起（客户端一直转圈），且异常被吞掉难以排查。
// wrapAsync 把 async 处理器包成 (req,res,next) => Promise.resolve().then(...).catch(next)，
// 将异常转交 Express 错误中间件（index.js 末尾的兜底 500），保证：① 请求必然响应；② 异常被记录。
// 仅用于「未自带 try/catch 的 async 路由处理器」；已显式 try/catch 的无需包裹。
export function wrapAsync(fn) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  };
}
