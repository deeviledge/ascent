// 管理画面。ビルド不要の素の JS で書いてある（Vercel / Pages の無料枠にそのまま置ける）。
const store = {
  get token() {
    return localStorage.getItem('salon.token') ?? '';
  },
  set token(value) {
    if (value) localStorage.setItem('salon.token', value);
    else localStorage.removeItem('salon.token');
  },
  get apiBase() {
    return localStorage.getItem('salon.api') ?? window.location.origin;
  },
  set apiBase(value) {
    localStorage.setItem('salon.api', value.replace(/\/$/, ''));
  },
};

const $ = (id) => document.getElementById(id);
let mode = 'login';
let activeCustomerId = null;

async function api(path, options = {}) {
  const res = await fetch(`${store.apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(store.token ? { Authorization: `Bearer ${store.token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && store.token) {
      store.token = '';
      render();
    }
    throw new Error(data.error ?? `通信に失敗しました（${res.status}）`);
  }
  return data;
}

function toast(message) {
  const el = $('app-message');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

function formatTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---- 認証 ----

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    $('salon-name-field').hidden = mode !== 'signup';
    $('auth-submit').textContent = mode === 'signup' ? 'アカウントを作る' : 'ログイン';
    $('auth-error').hidden = true;
  });
});

$('auth-submit').addEventListener('click', async () => {
  const error = $('auth-error');
  error.hidden = true;
  const apiBase = $('api-base').value.trim();
  if (apiBase) store.apiBase = apiBase;

  try {
    const body =
      mode === 'signup'
        ? { salon_name: $('salon-name').value, email: $('email').value, password: $('password').value }
        : { email: $('email').value, password: $('password').value };
    const data = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
    store.token = data.token;
    $('password').value = '';
    await render();
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  }
});

$('logout').addEventListener('click', () => {
  store.token = '';
  render();
});

// ---- 設定の保存 ----

$('save-line').addEventListener('click', async () => {
  try {
    const data = await api('/api/line', {
      method: 'PUT',
      body: JSON.stringify({
        channel_secret: $('channel-secret').value,
        access_token: $('access-token').value,
        bot_user_id: $('bot-user-id').value,
      }),
    });
    $('channel-secret').value = '';
    $('access-token').value = '';
    applyTenant(data.tenant);
    toast('LINE 連携を保存しました');
  } catch (e) {
    toast(e.message);
  }
});

$('save-settings').addEventListener('click', async () => {
  try {
    const data = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        name: $('s-name').value,
        staff_group_id: $('s-group').value,
        business_hours: $('s-hours').value,
        menu_text: $('s-menu').value,
        faq_text: $('s-faq').value,
        ng_keywords: $('s-ng').value,
        ai_enabled: $('s-ai').checked,
        forward_enabled: $('s-forward').checked,
      }),
    });
    applyTenant(data.tenant);
    toast('設定を保存しました');
  } catch (e) {
    toast(e.message);
  }
});

$('copy-webhook').addEventListener('click', async () => {
  const url = $('webhook-url').value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    toast('Webhook URL をコピーしました');
  } catch {
    $('webhook-url').select();
    toast('コピーできませんでした。手動で選択してください');
  }
});

// ---- 描画 ----

function applyTenant(tenant) {
  $('s-name').value = tenant.name ?? '';
  $('s-group').value = tenant.staff_group_id ?? '';
  $('s-hours').value = tenant.business_hours ?? '';
  $('s-menu').value = tenant.menu_text ?? '';
  $('s-faq').value = tenant.faq_text ?? '';
  $('s-ng').value = tenant.ng_keywords ?? '';
  $('s-ai').checked = Boolean(tenant.ai_enabled);
  $('s-forward').checked = Boolean(tenant.forward_enabled);
  $('bot-user-id').value = tenant.line_bot_user_id ?? '';
  $('webhook-url').value = tenant.webhook_url ?? '';

  const status = $('line-status');
  status.textContent = tenant.line_connected ? '接続済み' : '未接続';
  status.classList.toggle('is-connected', Boolean(tenant.line_connected));
}

function applyUsage(usage) {
  $('quota-used').textContent = String(usage.used_count);
  $('quota-total').textContent = `/ ${usage.quota} 件（${usage.month}）`;
  const ratio = usage.quota > 0 ? Math.min(usage.used_count / usage.quota, 1) : 0;
  $('quota-bar').style.width = `${ratio * 100}%`;
  $('quota-hint').textContent =
    usage.remaining > 0
      ? `残り ${usage.remaining} 件。上限に達すると自動応答は止まり、スタッフグループへの転送だけが続きます。`
      : '今月の上限に達しました。自動応答は止まり、スタッフグループへの転送だけが続いています。';
}

async function loadCustomers() {
  const { customers } = await api('/api/customers');
  const list = $('customers');
  list.textContent = '';

  if (customers.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'hint';
    empty.textContent = 'まだお客様からの受信はありません。';
    list.append(empty);
    return;
  }

  for (const customer of customers) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.classList.toggle('is-active', customer.id === activeCustomerId);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = customer.display_name || '（名前未取得）';

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(customer.last_message_at);

    button.append(name, time);
    button.addEventListener('click', () => loadThread(customer.id));
    item.append(button);
    list.append(item);
  }
}

async function loadThread(customerId) {
  activeCustomerId = customerId;
  const { messages } = await api(`/api/customers/${customerId}/messages`);
  const thread = $('thread');
  thread.textContent = '';

  if (messages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'この方とのやり取りはまだありません。';
    thread.append(empty);
  }

  const authorLabel = { customer: 'お客様', ai: 'AI 自動応答', staff: 'スタッフ' };
  for (const message of messages) {
    const bubble = document.createElement('div');
    bubble.className = `bubble ${message.direction}`;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${authorLabel[message.author] ?? message.author} ・ ${formatTime(message.created_at)}`;

    // 本文は textContent で入れる（お客様の文面をそのまま HTML として解釈させない）。
    const text = document.createElement('span');
    text.textContent = message.text;

    bubble.append(meta, text);
    thread.append(bubble);
  }

  await loadCustomers();
  thread.scrollTop = thread.scrollHeight;
}

async function render() {
  const authed = Boolean(store.token);
  $('auth').hidden = authed;
  $('app').hidden = !authed;
  $('logout').hidden = !authed;
  $('api-base').value = store.apiBase;

  if (!authed) {
    $('who').textContent = '';
    return;
  }

  try {
    const me = await api('/api/me');
    $('who').textContent = `${me.tenant.name}（${me.email}）`;
    applyTenant(me.tenant);
    applyUsage(me.usage);
    await loadCustomers();
  } catch (e) {
    toast(e.message);
  }
}

render();
