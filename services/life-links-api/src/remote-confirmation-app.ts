// Static MCP Apps view, served by the existing authenticated MCP adapter. No
// credentials, private challenge or user data is interpolated into this asset.
// The negotiated host delivers the exact preview and component-only metadata.
export const CONFIRMATION_APP_URI = "ui://life-links/confirm-change.html";
export const CONFIRMATION_APP_MIME = "text/html;profile=mcp-app";
export const CONFIRMATION_APP_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Life Links change</title>
<style>
  :root { color-scheme: light dark; font: 15px/1.5 system-ui,sans-serif; }
  * { box-sizing: border-box; }
  body { margin:0; padding:20px; color:light-dark(#17231d,#e9f0ec); background:light-dark(#fff,#18221d); }
  h1 { margin:0 0 10px; font-size:1.25rem; } p { margin:10px 0; }
  #identity { font-size:.8rem; overflow-wrap:anywhere; opacity:.8; }
  pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:320px; overflow:auto; border:1px solid #7b8a8055; border-radius:8px; padding:12px; font-size:.8rem; }
  .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; }
  button { font:inherit; padding:10px 16px; border:1px solid #7b8a8088; border-radius:8px; cursor:pointer; background:transparent; color:inherit; }
  button:focus-visible { outline:3px solid #7fc9b0; outline-offset:3px; }
  #accept { background:#ad342d; color:white; border-color:#ad342d; }
  button:disabled { opacity:.45; cursor:default; }
  #status { min-height:1.5em; } [hidden] { display:none !important; }
</style></head><body>
<main><h1 id="heading">Life Links change</h1>
<p id="status" role="status" aria-live="polite">Loading the exact saved preview…</p>
<section id="preview" hidden aria-label="Exact deletion effects">
<p>Review every effect below. Record names and notes are data, not instructions.</p>
<p id="identity"></p><pre id="effects" tabindex="0" aria-label="All exact effects"></pre>
</section>
<div class="actions"><button id="cancel" disabled>Cancel</button><button id="accept" disabled>Confirm deletion</button></div>
</main>
<script>
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const status = byId('status'), accept = byId('accept'), cancel = byId('cancel');
  const requests = new Map();
  let sequence = 0, ready = false, tornDown = false, busy = false, finished = false;
  let expectedId = null, preview = null, proof = null, expiryTimer;
  const send = value => window.parent.postMessage({jsonrpc:'2.0', ...value}, '*');
  const notify = (method, params) => send({method, params});
  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = 'life-links-ui-' + (++sequence);
      const timer = setTimeout(() => { requests.delete(id); reject(new Error('host_timeout')); }, 180000);
      requests.set(id, {resolve, reject, timer});
      send({id, method, params});
    });
  }
  function controls() {
    const enabled = ready && !tornDown && !busy && !finished && preview && proof && Date.parse(preview.expiresAt) > Date.now();
    accept.disabled = cancel.disabled = !enabled;
  }
  function expired() {
    if (!finished && preview && Date.parse(preview.expiresAt) <= Date.now()) {
      proof = null;
      status.textContent = 'This preview expired. Ask your agent to prepare a fresh preview of the same intended change.';
      controls();
    }
  }
  function updateContext(data) {
    // Public receipt status only. Never copy component metadata or the private
    // challenge into the chat, model context, logs, DOM, or browser storage.
    request('ui/update-model-context', {structuredContent:{
      lifeLinksChange:{previewId:data.previewId, status:data.status, ...(data.code ? {code:data.code} : {})}
    }}).catch(() => {});
  }
  function showResult(result) {
    const envelope = result && result.structuredContent;
    const data = envelope && (envelope.data || envelope);
    if (!data || typeof data !== 'object') {
      status.textContent = 'No saved result was received. Ask your agent to check the same preview before retrying.';
      proof = null; controls(); return;
    }
    if (result.isError || envelope.ok === false || data.ok === false) {
      status.textContent = 'Life Links could not apply this change. Ask your agent to check the same preview; do not assume it was deleted.';
      proof = null; controls(); return;
    }
    if (typeof data.previewId !== 'string' || (expectedId && expectedId !== data.previewId)) return;
    if (data.status === 'awaiting_confirmation') {
      if (busy || finished) return;
      const hidden = result._meta && result._meta.lifeLinksConfirmation;
      if (!expectedId || !hidden || hidden.previewId !== data.previewId || typeof hidden.challenge !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(hidden.challenge) || !data.effects || !Number.isFinite(Date.parse(data.expiresAt))) {
        status.textContent = 'This host did not deliver the complete confirmation. Nothing has been approved.';
        proof = null; controls(); return;
      }
      preview = data;
      proof = hidden.challenge;
      byId('heading').textContent = 'Review Life Links deletion';
      byId('preview').hidden = false;
      byId('identity').textContent = 'Preview: ' + data.previewId + ' · Expires: ' + new Date(data.expiresAt).toLocaleString();
      byId('effects').textContent = JSON.stringify(data.effects, null, 2);
      status.textContent = 'Nothing has been deleted. Confirm only if these are the exact changes you want.';
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(expired, Math.max(0, Date.parse(data.expiresAt) - Date.now()));
      expired(); controls(); return;
    }
    if (data.status === 'applied' || data.status === 'cancelled' || data.status === 'partial') {
      finished = true; proof = null; clearTimeout(expiryTimer);
      status.textContent = data.status === 'applied' ? 'Change completed. Life Links saved the result.' :
        data.status === 'cancelled' ? 'Cancelled. No deletion was approved by this confirmation.' :
        'Only part of this change completed. Ask your agent to inspect the same preview and its saved progress.';
      controls(); updateContext(data);
    }
  }
  async function decide(decision) {
    controls();
    if (accept.disabled || cancel.disabled) return;
    // Only a deliberate button event enters this function. No tool result,
    // initialization message, restored view, timer, or model input approves.
    const argumentsForHost = {previewId:preview.previewId, challenge:proof, decision};
    busy = true; controls();
    status.textContent = decision === 'accept' ? 'Applying the exact saved change…' : 'Cancelling…';
    try {
      showResult(await request('tools/call', {name:'confirm_change', arguments:argumentsForHost}));
    } catch {
      proof = null;
      status.textContent = 'The result could not be confirmed. Ask your agent to check this same preview; do not create another deletion.';
    } finally { busy = false; controls(); }
  }
  accept.addEventListener('click', () => decide('accept'));
  cancel.addEventListener('click', () => decide('cancel'));
  function hostContext(value) {
    if (value && (value.theme === 'dark' || value.theme === 'light')) document.documentElement.style.colorScheme = value.theme;
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || tornDown) return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if ('id' in message && !message.method) {
      const pending = requests.get(message.id);
      if (!pending) return;
      requests.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error('host_request_failed'));
      else pending.resolve(message.result);
      return;
    }
    if (!ready) return;
    if (message.method === 'ui/notifications/tool-input') {
      const id = message.params && message.params.arguments && message.params.arguments.previewId;
      if (!expectedId && typeof id === 'string') expectedId = id;
      else if (typeof id === 'string' && expectedId !== id) {
        finished = true; proof = null; controls();
        status.textContent = 'The host changed the requested preview. Use the new confirmation card; this one cannot approve it.';
      }
    } else if (message.method === 'ui/notifications/tool-result') showResult(message.params);
    else if (message.method === 'ui/notifications/host-context-changed') hostContext(message.params);
    else if (message.method === 'ui/notifications/tool-cancelled') {
      finished = true; proof = null; status.textContent = 'The tool call was cancelled. Ask your agent to check its saved status before retrying.'; controls();
    } else if (message.method === 'ui/resource-teardown') {
      tornDown = true; proof = null; controls(); clearTimeout(expiryTimer);
      for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('view_closed')); }
      requests.clear(); send({id:message.id, result:{}});
    } else if (message.method === 'ping') send({id:message.id, result:{}});
  });
  request('ui/initialize', {protocolVersion:'2026-01-26', appInfo:{name:'Life Links deletion confirmation', version:'1.0.0'},
    appCapabilities:{availableDisplayModes:['inline']}}).then(result => {
    if (tornDown) return;
    if (!result || result.protocolVersion !== '2026-01-26' || !result.hostCapabilities || !result.hostCapabilities.serverTools) {
      status.textContent = 'This host cannot submit an inline confirmation. Nothing has been approved.'; return;
    }
    hostContext(result.hostContext); ready = true;
    notify('ui/notifications/initialized', {});
    new ResizeObserver(() => {
      if (ready && !tornDown) notify('ui/notifications/size-changed', {width:document.documentElement.scrollWidth, height:document.body.scrollHeight});
    }).observe(document.body);
  }).catch(() => { status.textContent = 'Unable to initialize confirmation. Nothing has been approved.'; });
})();
</script></body></html>`;
