let item;
const status = document.querySelector('#status');
const statusText = status.querySelector('span:last-child');
const panel = document.querySelector('#panel');
const empty = document.querySelector('#empty');
const screen = document.querySelector('#screen');
const textInput = document.querySelector('#text');

function setStatus(state, label) {
  status.dataset.state = state;
  statusText.textContent = label;
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

async function poll() {
  try {
    const rows = await request('/api/interventions');
    item = rows.find(entry => !['resumed', 'aborted'].includes(entry.state));
    panel.hidden = !item;
    empty.hidden = Boolean(item);
    if (item) {
      setStatus(item.state, `State: ${item.state.replaceAll('_', ' ')}`);
      document.querySelector('#reason').textContent = item.reason;
      document.querySelector('#scope').textContent = `Capability: ${item.capabilityId || 'ad hoc'} · Step: ${item.stepId || 'unknown'} · Goal: ${item.goal || 'not supplied'}`;
      document.querySelector('#context').textContent = JSON.stringify(item.context || {}, null, 2);
      screen.src = `/api/session/${item.sessionId || item.runId}/screenshot?t=${Date.now()}`;
    } else {
      setStatus('waiting', 'Waiting for an intervention...');
    }
  } catch (error) {
    setStatus('offline', error instanceof Error ? error.message : 'Operator service unavailable');
  } finally {
    setTimeout(poll, 1000);
  }
}

document.querySelector('#take').onclick = async () => {
  if (!item) return;
  try { await request(`/api/intervention/${item.id}/take`, { method: 'POST' }); setStatus('human_in_control', 'State: human in control'); }
  catch (error) { setStatus('error', error instanceof Error ? error.message : 'Could not take control'); }
};

document.querySelector('#resume').onclick = async () => {
  if (!item) return;
  try { await request(`/api/intervention/${item.id}/resume`, { method: 'POST' }); setStatus('resumed', 'State: returned to automation'); }
  catch (error) { setStatus('error', error instanceof Error ? error.message : 'Could not return control'); }
};

document.querySelector('#abort').onclick = async () => {
  if (!item) return;
  try { await request(`/api/intervention/${item.id}/abort`, { method: 'POST' }); setStatus('aborted', 'State: run aborted'); }
  catch (error) { setStatus('error', error instanceof Error ? error.message : 'Could not abort run'); }
};

screen.onclick = async event => {
  if (!item) return;
  const rect = screen.getBoundingClientRect();
  try {
    await request(`/api/intervention/${item.id}/click`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: (event.clientX - rect.left) * screen.naturalWidth / rect.width, y: (event.clientY - rect.top) * screen.naturalHeight / rect.height })
    });
  } catch (error) { setStatus('error', error instanceof Error ? error.message : 'Click failed'); }
};

document.querySelector('#type').onclick = async () => {
  if (!item || !textInput.value) return;
  try {
    await request(`/api/intervention/${item.id}/type`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: textInput.value }) });
    textInput.value = '';
  } catch (error) { setStatus('error', error instanceof Error ? error.message : 'Typing failed'); }
};

poll();
