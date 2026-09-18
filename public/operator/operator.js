let item;
let screenshotLoading = false;
let forcedRefreshQueued = false;

const status = document.querySelector('#status');
const statusText = status.querySelector('span:last-child');
const panel = document.querySelector('#panel');
const empty = document.querySelector('#empty');
const screen = document.querySelector('#screen');
const screenBuffer = document.querySelector('#screen-buffer');
const screenStage = document.querySelector('#screen-stage');
const textInput = document.querySelector('#text');
const takeButton = document.querySelector('#take');
const resumeButton = document.querySelector('#resume');
const abortButton = document.querySelector('#abort');
const typeButton = document.querySelector('#type');
const actionConfirmation = document.querySelector('#action-confirmation');
let activeScreen = screen;
let inactiveScreen = screenBuffer;

function setStatus(state, label) {
  status.dataset.state = state;
  statusText.textContent = label;
}

function showActionState(current) {
  const actions = current?.humanActions || [];
  const latest = actions.at(-1);
  const heading = document.querySelector('#action-title');
  const detail = document.querySelector('#action-detail');
  actionConfirmation.dataset.state = latest ? 'ready' : 'waiting';
  heading.textContent = latest ? 'Human action recorded' : 'No human action recorded';
  detail.textContent = latest
    ? `${latest.description} · ${actions.length} captured action${actions.length === 1 ? '' : 's'}`
    : current?.owner === 'human'
      ? 'Interact with the session preview before returning control.'
      : 'Take control, then interact with the session preview.';
}

function renderControls() {
  const humanOwnsControl = item?.state === 'in_progress' && item.owner === 'human';
  const hasHumanAction = Boolean(item?.humanActions?.length);
  takeButton.disabled = !item || item.state !== 'requested';
  resumeButton.disabled = !humanOwnsControl || !hasHumanAction;
  abortButton.disabled = !item;
  textInput.disabled = !humanOwnsControl;
  typeButton.disabled = !humanOwnsControl || !textInput.value;
  screenStage.classList.toggle('interactive', humanOwnsControl);
  showActionState(item);
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function refreshScreenshot(force = false) {
  const humanOwnsControl = item?.state === 'in_progress' && item.owner === 'human';
  if (!item || (!force && humanOwnsControl)) return;
  if (screenshotLoading) {
    if (force) forcedRefreshQueued = true;
    return;
  }
  screenshotLoading = true;
  const interventionId = item.id;
  const next = inactiveScreen;
  const finish = () => {
    screenshotLoading = false;
    if (forcedRefreshQueued) {
      forcedRefreshQueued = false;
      refreshScreenshot(true);
    }
  };
  next.onload = () => {
    const stillHumanControlled = item?.state === 'in_progress' && item.owner === 'human';
    if (item?.id === interventionId && (force || !stillHumanControlled)) {
      next.classList.add('active');
      activeScreen.classList.remove('active');
      inactiveScreen = activeScreen;
      activeScreen = next;
    }
    next.onload = null;
    next.onerror = null;
    finish();
  };
  next.onerror = () => {
    next.onload = null;
    next.onerror = null;
    if (item?.id === interventionId) setStatus('error', 'Could not refresh session preview');
    finish();
  };
  next.src = `/api/session/${item.sessionId || item.runId}/screenshot?t=${Date.now()}`;
}

function previewCoordinates(event) {
  const rect = screenStage.getBoundingClientRect();
  const width = activeScreen.naturalWidth;
  const height = activeScreen.naturalHeight;
  if (!width || !height || !rect.width || !rect.height) throw new Error('Session preview is still loading');
  const imageRatio = width / height;
  const stageRatio = rect.width / rect.height;
  const renderedWidth = stageRatio > imageRatio ? rect.height * imageRatio : rect.width;
  const renderedHeight = stageRatio > imageRatio ? rect.height : rect.width / imageRatio;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const localX = event.clientX - rect.left - offsetX;
  const localY = event.clientY - rect.top - offsetY;
  if (localX < 0 || localY < 0 || localX > renderedWidth || localY > renderedHeight) throw new Error('Click inside the visible session preview');
  return { x: localX * width / renderedWidth, y: localY * height / renderedHeight };
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
      refreshScreenshot();
    } else {
      setStatus('waiting', 'Waiting for an intervention...');
    }
    renderControls();
  } catch (error) {
    setStatus('offline', error instanceof Error ? error.message : 'Operator service unavailable');
  } finally {
    setTimeout(poll, 1000);
  }
}

takeButton.onclick = async () => {
  if (!item) return;
  try {
    item = await request(`/api/intervention/${item.id}/take`, { method: 'POST' });
    setStatus('human_in_control', 'State: human in control');
    renderControls();
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'Could not take control');
  }
};

resumeButton.onclick = async () => {
  if (!item) return;
  try {
    item = await request(`/api/intervention/${item.id}/resume`, { method: 'POST' });
    setStatus('resumed', 'State: returned to automation');
    renderControls();
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'Could not return control');
  }
};

abortButton.onclick = async () => {
  if (!item) return;
  try {
    item = await request(`/api/intervention/${item.id}/abort`, { method: 'POST' });
    setStatus('aborted', 'State: run aborted');
    renderControls();
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'Could not abort run');
  }
};

screenStage.onclick = async event => {
  if (!item || item.owner !== 'human' || item.state !== 'in_progress') {
    setStatus('error', 'Take control before interacting with the preview');
    return;
  }
  screenStage.classList.add('sending');
  try {
    const point = previewCoordinates(event);
    item = await request(`/api/intervention/${item.id}/click`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(point)
    });
    setStatus('human_in_control', 'Human action recorded');
    renderControls();
    setTimeout(() => refreshScreenshot(true), 150);
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'Click failed');
  } finally {
    screenStage.classList.remove('sending');
  }
};

textInput.oninput = renderControls;
typeButton.onclick = async () => {
  if (!item || !textInput.value) return;
  try {
    item = await request(`/api/intervention/${item.id}/type`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: textInput.value })
    });
    textInput.value = '';
    setStatus('human_in_control', 'Human action recorded');
    renderControls();
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : 'Typing failed');
  }
};

renderControls();
poll();
