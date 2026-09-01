// A-09：统一错误响应信封。所有「业务失败」响应返回 { ok:false, error, message }，
// 与成功响应的 { ok:true, ... } 对称，调用方（前端 / 自动化）只需判断 ok 字段，
// 无需同时区分「HTTP 200 + ok:false」与「HTTP 500 + message」两套语义。
// status 缺省 400；error 为机器可读错误码，message 为可展示中文说明。
export function sendError(res, { status = 400, error = 'bad_request', message = '' } = {}) {
  return res.status(status).json({ ok: false, error, message });
}
