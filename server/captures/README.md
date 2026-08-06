# 抓包导入：你不用懂抓包

目标：把 smzdm App 的抽奖 / 转盘 / 每日任务等真实接口补进 zdmclock，
全程不用手写 URL。

## 三步
1. **抓**：在手机/电脑上用任意抓包工具捕获 smzdm 的请求
   - 最简单：手机用 Charles / 小黄鸟(HTTP Catcher) 或电脑浏览器抓包插件，
     打开 smzdm App 点一下「抽奖 / 转盘 / 做任务」，
     在抓包列表里找到 `zhiyou.smzdm.com` 或 `user-api.smzdm.com` 的请求。
2. **导**：把该请求导出
   - Charles/Fiddler：右键 → Export Session → 选 HAR，存为 `xxx.har`
   - 浏览器/任意工具：「复制为 cURL」，粘贴进 `xxx.curl.txt`
   把文件放进本目录（`server/captures/`）。
3. **转**：在本目录运行
   ```
   node tools/importCapture.mjs
   ```
   生成 `detected.json`；然后到前端「自动任务 → 抓包导入」勾选并应用即可。

## 说明
- 抽奖/转盘（`jsonp_draw`）需要 `active_id`（在专题页请求里），工具会自动带上你抓到的那个。
- 每日任务领奖需要 `task_id`（每天变化），请用本工具抓「领奖」那次请求。
- 导入器只读取你提供的抓包文件，绝不伪造任何接口或响应。
- `detected.json` 与样例 `*.har` / `*.curl.txt` 已被 .gitignore 忽略，不会进仓库。
