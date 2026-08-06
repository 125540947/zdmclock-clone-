<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>好价爆料</h1>
        <div class="sub">发现好价，记录并提交到后端（持久化存储）</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay:.02s">
      <div class="refresh-row">
        <div>
          <div class="rt">🔄 从 smzdm 抓取好价</div>
          <div class="rh">实时抓取公开好价列表并写入爆料箱（自动去重）。real 模式抓真实数据，mock 模式返回示例。</div>
        </div>
        <button class="btn ghost" :disabled="refreshing" @click="refresh">
          {{ refreshing ? '抓取中…' : '立即刷新' }}
        </button>
      </div>
    </section>

    <section class="card rise" style="animation-delay:.05s">
      <div class="field">
        <label>标题</label>
        <input v-model="form.title" class="input" placeholder="如：京东 某品牌耳机 到手 ¥199" />
      </div>
      <div class="field">
        <label>链接</label>
        <input v-model="form.url" class="input" placeholder="https://..." />
      </div>
      <div class="row2">
        <div class="field" style="margin:0">
          <label>到手价</label>
          <input v-model="form.price" class="input" placeholder="199" />
        </div>
        <div class="field" style="margin:0">
          <label>分类</label>
          <input v-model="form.cat" class="input" placeholder="数码 / 家电" />
        </div>
      </div>
      <div class="field">
        <label>补充说明（可选）</label>
        <textarea v-model="form.content" class="input" rows="2" placeholder="入手渠道、凑单技巧…"></textarea>
      </div>
      <button class="btn block" :disabled="!form.title || saving" @click="save">
        {{ saving ? '保存中…' : '保存到爆料箱' }}
      </button>
      <p class="hint">爆料保存在后端数据库（JSON 文件），多端同步、刷新不丢；点「提交到 smzdm」会经适配器上报（mock 模式返回仿真结果）。</p>
    </section>

    <section class="card rise" style="animation-delay:.1s" v-if="accounts.length">
      <div class="row2" style="align-items:flex-end;margin:0">
        <div class="field" style="margin:0;flex:1">
          <label>提交所用账号</label>
          <select v-model="submitUserId" class="input">
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.nickname || a.smzdmId || a.id }}</option>
          </select>
        </div>
      </div>
    </section>

    <section class="card rise" style="animation-delay:.15s" v-if="items.length">
      <p class="card-title">📣 爆料箱（{{ items.length }}）</p>
      <div v-for="d in items" :key="d.id" class="draft">
        <div class="dh">
          <span class="dt">{{ d.title }}</span>
          <span class="badge" :class="d.status">{{ statusText(d.status) }}</span>
        </div>
        <div class="dm">
          <span class="tag" v-if="d.price">¥{{ d.price }}</span>
          <span class="tag" v-if="d.cat">{{ d.cat }}</span>
          <a v-if="safeUrl(d.url)" :href="safeUrl(d.url)" target="_blank" rel="noopener noreferrer" class="tag on">原链接</a>
          <a v-if="safeUrl(d.smzdmUrl)" :href="safeUrl(d.smzdmUrl)" target="_blank" rel="noopener noreferrer" class="tag on">smzdm</a>
        </div>
        <div class="actions">
          <button class="mini" :disabled="d.status === 'submitted' || !submitUserId" @click="submit(d)">
            {{ d.status === 'submitted' ? '已提交' : '提交到 smzdm' }}
          </button>
          <button class="mini danger" @click="del(d.id)">删除</button>
        </div>
        <div class="result" v-if="d.lastResult">{{ d.lastResult }}</div>
      </div>
    </section>

    <p v-if="!items.length && !loading" class="empty">爆料箱还是空的，先记一条好价吧。</p>
    <p v-if="msg" class="msg" :class="msgType">{{ msg }}</p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api, listBaoliao, createBaoliao, deleteBaoliao, submitBaoliao, refreshBaoliao } from '../api/client.js';

const form = ref({ title: '', url: '', price: '', cat: '', content: '' });
const items = ref([]);
const accounts = ref([]);
const submitUserId = ref('');
const saving = ref(false);
const loading = ref(false);
const refreshing = ref(false);
const msg = ref('');
const msgType = ref('');

function flash(text, type = 'ok') {
  msg.value = text;
  msgType.value = type;
  setTimeout(() => (msg.value = ''), 3000);
}
function statusText(s) {
  return { draft: '草稿', submitted: '已提交', failed: '失败' }[s] || s;
}

// S8：仅允许 https? 协议，阻断 javascript: 等伪协议造成的自 XSS
function safeUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '';
}

async function loadAccounts() {
  try {
    const { data } = await api.get('/users');
    accounts.value = data.list || [];
    if (accounts.value.length && !submitUserId.value) submitUserId.value = accounts.value[0].id;
  } catch {
    accounts.value = [];
  }
}
async function loadList() {
  loading.value = true;
  try {
    const data = await listBaoliao();
    items.value = data.items || [];
  } catch (e) {
    flash('加载失败：' + (e.message || '未知错误'), 'err');
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!form.value.title) return;
  saving.value = true;
  try {
    await createBaoliao({ ...form.value });
    form.value = { title: '', url: '', price: '', cat: '', content: '' };
    flash('已保存到爆料箱');
    await loadList();
  } catch (e) {
    flash('保存失败：' + (e.message || '未知错误'), 'err');
  } finally {
    saving.value = false;
  }
}
async function del(id) {
  try {
    await deleteBaoliao(id);
    items.value = items.value.filter((x) => x.id !== id);
  } catch (e) {
    flash('删除失败：' + (e.message || '未知错误'), 'err');
  }
}
async function submit(d) {
  if (!submitUserId.value) {
    flash('请先在上方选择提交账号', 'err');
    return;
  }
  try {
    const data = await submitBaoliao(d.id, submitUserId.value);
    flash('提交成功：' + (data.result?.message || ''));
    await loadList();
  } catch (e) {
    flash('提交失败：' + (e.response?.data?.message || e.message || '未知错误'), 'err');
  }
}

async function refresh() {
  refreshing.value = true;
  try {
    const data = await refreshBaoliao(20);
    flash(`刷新完成：解析 ${data.fetched} 条，新增 ${data.added} 条`);
    await loadList();
  } catch (e) {
    flash('刷新失败：' + (e.response?.data?.message || e.message || '未知错误'), 'err');
  } finally {
    refreshing.value = false;
  }
}

onMounted(() => {
  loadAccounts();
  loadList();
});
</script>

<style scoped>
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}
.refresh-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.refresh-row .rt {
  font-size: 14px;
  font-weight: 600;
}
.refresh-row .rh {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 4px;
  line-height: 1.6;
}
.btn.ghost {
  flex: none;
  padding: 9px 16px;
  font-size: 13px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
}
.btn.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hint {
  font-size: 11px;
  color: var(--text-faint);
  margin: 12px 0 0;
  line-height: 1.6;
}
.draft {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.draft:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.dh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.dt {
  font-size: 14px;
  font-weight: 500;
}
.badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 99px;
  border: 1px solid var(--border);
  color: var(--text-faint);
  white-space: nowrap;
}
.badge.draft { color: #c9a227; border-color: rgba(201, 162, 39, 0.4); }
.badge.submitted { color: #06210f; background: rgba(120, 224, 143, 0.85); border-color: transparent; }
.badge.failed { color: #ffb4b4; border-color: rgba(255, 80, 80, 0.4); }
.dm {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.tag.on {
  color: #06210f;
  background: rgba(120, 224, 143, 0.85);
  border-color: transparent;
  text-decoration: none;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.mini {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card-2);
  color: var(--text);
  cursor: pointer;
}
.mini:disabled { opacity: 0.5; cursor: not-allowed; }
.mini.danger { color: #ffb4b4; border-color: rgba(255, 80, 80, 0.35); }
.result {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 8px;
  line-height: 1.5;
}
.empty {
  text-align: center;
  color: var(--text-faint);
  font-size: 13px;
  margin-top: 30px;
}
.msg {
  text-align: center;
  font-size: 12px;
  margin-top: 16px;
}
.msg.ok { color: #78e08f; }
.msg.err { color: #ffb4b4; }
</style>
