<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>自动任务</h1>
        <div class="sub">启用后由后端按 cron 自动执行（已接入调度器），对所有已录入账号生效</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay: 0.05s">
      <div v-for="t in tasks" :key="t.id" class="task">
        <div class="task-ico">{{ t.icon }}</div>
        <div class="task-meta">
          <div class="t">{{ t.name }}</div>
          <div class="d">
            {{ t.type }} · {{ t.cron }}
            <span v-if="t.lastRun" class="muted"> · 上次 {{ t.lastRun }}</span>
          </div>
          <div v-if="t.lastResult" class="res">{{ t.lastResult }}</div>
          <div v-if="['comment','favorite','point'].includes(t.type)" class="art">
            <div class="src-toggle">
              <button
                type="button"
                :class="['chip', (t.articleSource || 'manual') !== 'baoliao' && 'on']"
                @click="setSource(t, 'manual')"
              >手动指定ID</button>
              <button
                type="button"
                :class="['chip', t.articleSource === 'baoliao' && 'on']"
                @click="setSource(t, 'baoliao')"
              >从好价列表取</button>
            </div>
            <input
              v-if="t.articleSource !== 'baoliao'"
              class="input sm"
              v-model="t.articleId"
              placeholder="目标文章ID或链接，如 123456 / https://www.smzdm.com/p/123456"
              @change="saveArticleId(t)"
            />
            <span class="hint-sm" v-if="t.articleSource === 'baoliao'">将对你好价列表中的文章自动取 ID 执行（无需手填）</span>
            <span class="hint-sm" v-else>评论/收藏/点赞需指定目标文章，否则运行会报错</span>
          </div>
          <div v-else-if="t.type === 'fetch'" class="art">
            <div class="row-limit">
              <label>每次抓取条数</label>
              <input
                class="input sm"
                type="number"
                min="1"
                max="50"
                v-model.number="t.limit"
                @change="saveLimit(t)"
              />
            </div>
            <span class="hint-sm">定时从 smzdm 公开好价列表抓取并写入爆料箱（自动去重），供评论/收藏/点赞与 GPT 生成取用</span>
          </div>
          <div v-else-if="t.needsEndpoint" class="art">
            <span v-if="!t.configured" class="badge warn">⚠ 待抓包：未配置真实接口，运行会提示待抓包</span>
            <span v-else class="badge ok">✓ 已配置接口</span>
            <button class="btn ghost sm" @click="toggleConfig(t)">
              {{ expandedId === t.id ? '收起' : '配置接口' }}
            </button>
            <div v-if="expandedId === t.id" class="ep-form">
              <p class="hint-sm">
                从 smzdm App 抓包得到该任务的真实请求，填入下方。系统不会内置任何伪造端点；
                仅当你提供真实 URL/参数后才真正发起请求。资产字段映射用于把响应中的金币/碎银/经验/等级提取进资产账本。
              </p>
              <label class="lbl">接口 URL（完整 http(s) 或 /path）</label>
              <input class="input sm full" v-model="form.endpoint" placeholder="如 https://user-api.smzdm.com/xxx/lottery" />
              <label class="lbl">方法</label>
              <select class="input sm" v-model="form.method">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
              <label class="lbl">请求体（JSON 或 key=value，支持 {{uid}} {{smzdmId}} 占位符）</label>
              <textarea class="input sm full area" v-model="form.body" placeholder='{"act":"lottery"}' rows="3"></textarea>
              <label class="lbl">资产字段映射（响应 JSON 路径，如 data.gold）</label>
              <div class="af-grid">
                <input class="input sm" v-model="form.gold" placeholder="金币路径" />
                <input class="input sm" v-model="form.silver" placeholder="碎银路径" />
                <input class="input sm" v-model="form.exp" placeholder="经验路径" />
                <input class="input sm" v-model="form.level" placeholder="等级路径" />
                <input class="input sm" v-model="form.message" placeholder="结果文案路径" />
              </div>
              <label class="lbl">备注</label>
              <input class="input sm full" v-model="form.note" placeholder="便于回忆该接口来源/版本" />
              <div class="ep-row">
                <button class="btn ghost sm" type="button" @click="loadTemplate(t)">加载推荐模板</button>
                <label class="ck"><input type="checkbox" v-model="form.jsonp" /> JSONP 响应</label>
                <label class="ck"><input type="checkbox" v-model="form.robotToken" /> 需 robot token</label>
              </div>
              <label class="lbl">Referer（JSONP 抽奖常需 m.smzdm.com）</label>
              <input class="input sm full" v-model="form.referer" placeholder="如 https://m.smzdm.com/" />
              <label class="lbl">自定义请求头（JSON，可选，如 x-requested-with）</label>
              <textarea class="input sm full area" v-model="form.headersText" rows="2" placeholder='{"x-requested-with":"com.smzdm.client.android"}'></textarea>
              <div class="ep-actions">
                <button class="btn primary sm" :disabled="saving" @click="saveConfig(t)">保存接口</button>
              </div>
            </div>
          </div>
        </div>
        <div class="task-actions">
          <label class="switch">
            <input type="checkbox" :checked="t.enabled" @change="toggle(t, $event)" />
            <span class="slider"></span>
          </label>
          <button class="btn ghost sm" :disabled="busy === t.id" @click="run(t)">运行</button>
        </div>
      </div>
    </section>

    <section class="card rise cap-card" style="animation-delay: 0.1s">
      <h2>🪝 抓包导入（你不用懂抓包）</h2>
      <p class="hint-sm">
        把 smzdm App 的请求 HAR 或 cURL 放进 <code>server/captures/</code>，运行
        <code>node tools/importCapture.mjs</code>，再点下方「扫描」即可一键载入真实端点。
        动态参数（如转盘 active_id、任务 task_id）会用你抓到的实际值。
      </p>
      <button class="btn ghost sm" :disabled="scanning" @click="scanCaptures">扫描 captures 目录</button>
      <div v-if="capHint" class="cap-hint-msg">{{ capHint }}</div>
      <div v-if="captures.length" class="cap-list">
        <div v-for="(c, i) in captures" :key="i" class="cap-item">
          <select class="input sm" v-model="c.type">
            <option v-for="opt in customTypeOptions" :key="opt" :value="opt">{{ opt }}</option>
          </select>
          <div class="cap-meta">
            <span class="cap-method" :class="c.method === 'GET' ? 'get' : 'post'">{{ c.method }}</span>
            <span class="cap-url">{{ c.endpoint }}</span>
          </div>
          <div v-if="c.jsonp" class="cap-tag">JSONP</div>
          <div v-if="c.robotToken" class="cap-tag">需token</div>
          <div v-if="c.assetHint && c.assetHint.length" class="cap-hint">资产字段候选：{{ c.assetHint.join(', ') }}</div>
        </div>
        <button class="btn primary sm" :disabled="applying" @click="submitCaptures">应用所选端点</button>
      </div>
    </section>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api, {
  getTaskEndpoints,
  saveTaskEndpoint,
  getTaskTemplates,
  getCaptures,
  applyCaptures
} from '../api/client.js';

const tasks = ref([]);
const endpoints = ref({});
const busy = ref('');
const toast = ref('');
const toastType = ref('ok');
const expandedId = ref('');
const templates = ref({});
const form = ref({
  endpoint: '',
  method: 'POST',
  body: '',
  gold: '',
  silver: '',
  exp: '',
  level: '',
  message: '',
  note: '',
  jsonp: false,
  robotToken: false,
  referer: '',
  headersText: ''
});
const saving = ref(false);

// 抓包导入相关
const captures = ref([]);
const scanning = ref(false);
const applying = ref(false);
const capHint = ref('');
const customTypeOptions = ['lottery', 'turntable', 'crowdtest', 'follow', 'share'];

function showToast(m, t = 'ok') {
  toast.value = m;
  toastType.value = t;
  setTimeout(() => (toast.value = ''), 2400);
}

async function load() {
  const [{ data }, ep] = await Promise.all([api.get('/tasks'), getTaskEndpoints()]);
  endpoints.value = ep.endpoints || {};
  templates.value = ep.templates || {};
  // GPT 批量生成任务由 GPT 自动回复页统一管理，这里只展示互动类任务
  tasks.value = (data.list || []).filter((t) => t.type !== 'gpt');
}
async function toggle(t, e) {
  await api.put(`/tasks/${t.id}`, { enabled: e.target.checked });
  t.enabled = e.target.checked;
  showToast('已更新');
}
async function saveArticleId(t) {
  try {
    await api.put(`/tasks/${t.id}`, { articleId: t.articleId || '' });
    showToast('已保存目标文章');
  } catch (e) {
    showToast(e.response?.data?.message || '保存失败', 'err');
  }
}
async function setSource(t, src) {
  t.articleSource = src;
  try {
    await api.put(`/tasks/${t.id}`, { articleSource: src });
    showToast('已切换文章来源');
  } catch (e) {
    showToast(e.response?.data?.message || '保存失败', 'err');
  }
}
async function saveLimit(t) {
  const lim = Math.min(50, Math.max(1, Number(t.limit) || 20));
  t.limit = lim;
  try {
    await api.put(`/tasks/${t.id}`, { limit: lim });
    showToast('已保存抓取条数');
  } catch (e) {
    showToast(e.response?.data?.message || '保存失败', 'err');
  }
}
async function run(t) {
  busy.value = t.id;
  try {
    const { data } = await api.post(`/tasks/${t.id}/run`);
    showToast(data.result?.message || '执行完成');
    await load();
  } catch (e) {
    showToast(e.response?.data?.message || '执行失败', 'err');
  } finally {
    busy.value = '';
  }
}

// 打开/收起某自定义任务的接口配置（抓包结果）
function toggleConfig(t) {
  if (expandedId.value === t.id) {
    expandedId.value = '';
    return;
  }
  const ep = endpoints.value[t.type] || {};
  form.value = {
    endpoint: ep.endpoint || '',
    method: ep.method || 'POST',
    body: ep.body ? (typeof ep.body === 'string' ? ep.body : JSON.stringify(ep.body, null, 2)) : '',
    gold: (ep.assetFields && ep.assetFields.gold) || '',
    silver: (ep.assetFields && ep.assetFields.silver) || '',
    exp: (ep.assetFields && ep.assetFields.exp) || '',
    level: (ep.assetFields && ep.assetFields.level) || '',
    message: (ep.assetFields && ep.assetFields.message) || '',
    note: ep.note || '',
    jsonp: !!ep.jsonp,
    robotToken: !!ep.robotToken,
    referer: ep.referer || '',
    headersText: ep.headers ? JSON.stringify(ep.headers) : ''
  };
  expandedId.value = t.id;
}

// 加载推荐模板（社区逆向的真实端点形态）：对应类型有则用，否则用每日任务领奖模板
function loadTemplate(t) {
  const tpl = templates.value[t.type] || templates.value.taskReceive;
  if (!tpl) {
    showToast('暂无推荐模板', 'err');
    return;
  }
  form.value.endpoint = tpl.endpoint || '';
  form.value.method = tpl.method || 'POST';
  form.value.body = tpl.body ? (typeof tpl.body === 'string' ? tpl.body : JSON.stringify(tpl.body, null, 2)) : '';
  const af = tpl.assetFields || {};
  form.value.gold = af.gold || '';
  form.value.silver = af.silver || '';
  form.value.exp = af.exp || '';
  form.value.level = af.level || '';
  form.value.message = af.message || '';
  form.value.note = tpl.note || '';
  form.value.jsonp = !!tpl.jsonp;
  form.value.robotToken = !!tpl.robotToken;
  form.value.referer = tpl.referer || '';
  form.value.headersText = tpl.headers ? JSON.stringify(tpl.headers) : '';
  showToast('已载入推荐模板，请核对/替换动态参数后保存');
}

async function saveConfig(t) {
  saving.value = true;
  try {
    const af = {};
    for (const k of ['gold', 'silver', 'exp', 'level', 'message']) {
      if (form.value[k] && form.value[k].trim()) af[k] = form.value[k].trim();
    }
    let headers = undefined;
    if (form.value.headersText && form.value.headersText.trim()) {
      try {
        headers = JSON.parse(form.value.headersText);
      } catch {
        showToast('自定义请求头不是合法 JSON', 'err');
        saving.value = false;
        return;
      }
    }
    const payload = {
      endpoint: form.value.endpoint.trim(),
      method: form.value.method,
      body: form.value.body.trim() || null,
      assetFields: af,
      note: form.value.note.trim(),
      jsonp: form.value.jsonp,
      robotToken: form.value.robotToken,
      referer: form.value.referer.trim() || undefined,
      headers
    };
    const { data } = await saveTaskEndpoint(t.type, payload);
    endpoints.value = data.endpoints || {};
    showToast('已保存接口配置');
    await load();
  } catch (e) {
    showToast(e.response?.data?.message || '保存失败', 'err');
  } finally {
    saving.value = false;
  }
}

// 扫描 captures 目录（读取 importCapture.mjs 生成的 detected.json）
async function scanCaptures() {
  scanning.value = true;
  capHint.value = '';
  try {
    const items = await getCaptures();
    captures.value = items.map((c) => ({
      ...c,
      type: customTypeOptions.includes(c.guessedType) ? c.guessedType : 'follow'
    }));
    if (!captures.value.length) {
      capHint.value = '未识别到抓包文件。请把 HAR / cURL 放进 server/captures/ 并运行 node tools/importCapture.mjs';
    }
  } catch (e) {
    capHint.value = e.response?.data?.message || '扫描失败';
  } finally {
    scanning.value = false;
  }
}

// 应用抓包结果：把前端选定的端点写入任务接口配置
async function submitCaptures() {
  applying.value = true;
  try {
    const items = captures.value.map((c) => {
      let body = c.body;
      if (body && typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          /* keep string */
        }
      }
      return {
        type: c.type,
        endpoint: c.endpoint,
        method: c.method,
        body,
        assetFields: c.assetHint && c.assetHint.length ? { message: c.assetHint[0] } : {},
        jsonp: c.jsonp,
        robotToken: c.robotToken,
        referer: c.referer,
        headers: c.headers
      };
    });
    const { data } = await applyCaptures(items);
    endpoints.value = data.endpoints || {};
    showToast(`已应用 ${data.applied} 个抓包端点`);
    await load();
    captures.value = [];
  } catch (e) {
    showToast(e.response?.data?.message || '应用失败', 'err');
  } finally {
    applying.value = false;
  }
}
onMounted(load);
</script>

<style scoped>
.task {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.task:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.task-ico {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 20px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.task-meta {
  flex: 1;
}
.task-meta .t {
  font-size: 15px;
  font-weight: 600;
}
.task-meta .d {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}
.task-meta .res {
  font-size: 12px;
  color: var(--gold);
  margin-top: 3px;
}
.task-meta .art {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.task-meta .art .input {
  width: 100%;
  max-width: 360px;
}
.input.sm {
  padding: 7px 10px;
  font-size: 12px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  outline: none;
}
.input.sm:focus {
  border-color: var(--primary);
}
.hint-sm {
  font-size: 10px;
  color: var(--text-faint);
}
.row-limit {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.row-limit label {
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
}
.row-limit .input.sm {
  width: 90px;
}
.badge {
  display: inline-block;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  margin-right: 6px;
}
.badge.warn {
  color: #ffcf6b;
  border: 1px solid rgba(255, 207, 107, 0.5);
  background: rgba(255, 207, 107, 0.08);
}
.badge.ok {
  color: #79e08f;
  border: 1px solid rgba(120, 224, 143, 0.5);
  background: rgba(120, 224, 143, 0.08);
}
.ep-form {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ep-form .lbl {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 4px;
}
.input.sm.full {
  width: 100%;
  max-width: none;
}
.input.sm.area {
  width: 100%;
  max-width: none;
  resize: vertical;
  font-family: ui-monospace, monospace;
}
.af-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}
.ep-actions {
  margin-top: 8px;
}
.btn.primary.sm {
  padding: 8px 14px;
  font-size: 12px;
  border-radius: 10px;
  background: var(--primary);
  color: #fff;
  border: none;
  cursor: pointer;
}
.btn.primary.sm:disabled {
  opacity: 0.5;
}
.src-toggle {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.src-toggle .chip {
  flex: none;
  padding: 5px 11px;
  font-size: 11px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-dim);
  cursor: pointer;
  transition: 0.15s;
}
.src-toggle .chip.on {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
}
.task-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.btn.sm {
  padding: 8px 12px;
  font-size: 12px;
  border-radius: 10px;
}
.switch {
  position: relative;
  display: inline-block;
  width: 42px;
  height: 24px;
}
.switch input {
  display: none;
}
.slider {
  position: absolute;
  inset: 0;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 999px;
  transition: 0.2s;
}
.slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 3px;
  top: 2px;
  border-radius: 50%;
  background: var(--text-dim);
  transition: 0.2s;
}
.switch input:checked + .slider {
  background: var(--primary-soft);
  border-color: var(--primary);
}
.switch input:checked + .slider::before {
  transform: translateX(18px);
  background: var(--primary);
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 100px;
  transform: translateX(-50%);
  z-index: 50;
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 14px;
  background: rgba(20, 17, 15, 0.92);
  border: 1px solid var(--border-strong);
}
.toast.ok {
  border-color: rgba(120, 224, 143, 0.5);
  color: #b7f3c6;
}
.toast.err {
  border-color: rgba(255, 90, 77, 0.6);
  color: #ffb3ac;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}
.cap-card h2 {
  font-size: 15px;
  margin: 0 0 6px;
}
.cap-card code {
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 11px;
}
.cap-hint-msg {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.cap-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cap-item {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 10px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cap-item .input.sm {
  width: 130px;
  flex: none;
}
.cap-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  flex-wrap: wrap;
}
.cap-method {
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 6px;
}
.cap-method.get {
  color: #79e08f;
  background: rgba(120, 224, 143, 0.12);
}
.cap-method.post {
  color: #ffcf6b;
  background: rgba(255, 207, 107, 0.12);
}
.cap-url {
  color: var(--text-dim);
  word-break: break-all;
}
.cap-tag {
  display: inline-block;
  font-size: 10px;
  color: var(--primary);
  border: 1px solid var(--primary);
  border-radius: 999px;
  padding: 0 7px;
  width: fit-content;
}
.cap-hint {
  font-size: 10px;
  color: var(--text-faint);
}
.ep-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.ep-row .ck {
  font-size: 11px;
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
</style>
