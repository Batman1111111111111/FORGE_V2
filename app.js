// ========== DB functions (inline) ==========
const DB_NAME = 'forge-db-v2';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('weights')) db.createObjectStore('weights', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('nutrition')) db.createObjectStore('nutrition', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}

async function getAll(storeName) {
  const store = await tx(storeName);
  return await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function get(storeName, key) {
  const store = await tx(storeName);
  return await new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(storeName, value) {
  const store = await tx(storeName, 'readwrite');
  return await new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function del(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return await new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function clearStore(storeName) {
  const store = await tx(storeName, 'readwrite');
  return await new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function exportDB() {
  const [settings, sessions, weights, nutrition, notes] = await Promise.all([
    getAll('settings'), getAll('sessions'), getAll('weights'),
    getAll('nutrition'), getAll('notes')
  ]);
  return { settings, sessions, weights, nutrition, notes, exportedAt: new Date().toISOString() };
}

async function importDB(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid import file');
  for (const row of data.settings || []) await put('settings', row);
  for (const row of data.sessions || []) await put('sessions', row);
  for (const row of data.weights || []) await put('weights', row);
  for (const row of data.nutrition || []) await put('nutrition', row);
  for (const row of data.notes || []) await put('notes', row);
}

function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`;
}

// ========== App logic ==========
const PROGRAM = {
  1: {
    phase: 'Foundation',
    days: {
      Monday: { title: 'Upper Strength', sub: 'Compound pull & push.', exercises: [
        { name: 'Pull-ups', sets: 5, reps: '5' },
        { name: 'Push-ups', sets: 5, reps: '15' },
        { name: 'Dips', sets: 4, reps: '8-12' },
        { name: 'Pike push-ups', sets: 4, reps: '10' },
        { name: 'Australian rows', sets: 4, reps: '12' }
      ]},
      Tuesday: { title: 'Lower Strength', sub: 'Legs are the engine.', exercises: [
        { name: 'Squats', sets: 5, reps: '20' },
        { name: 'Bulgarian split squats', sets: 4, reps: '12/leg' },
        { name: 'Walking lunges', sets: 3, reps: '20/leg' },
        { name: 'Glute bridges', sets: 4, reps: '20' },
        { name: 'Calf raises', sets: 4, reps: '25' }
      ]},
      Wednesday: { title: 'Conditioning', sub: 'Run + circuits.', notes: ['Run 30–40 min', '3 rounds: 20 push‑ups, 20 squats, 10 pull‑ups, 20 mountain climbers'] },
      Thursday: { title: 'Explosive Power', sub: 'Plyometrics & sprints.', exercises: [
        { name: 'Box jumps', sets: 5, reps: '5' },
        { name: 'Jump squats', sets: 4, reps: '10' },
        { name: 'Broad jumps', sets: 4, reps: '8' },
        { name: 'Explosive push-ups', sets: 5, reps: '8' },
        { name: 'Clapping push-ups', sets: 4, reps: '6' }
      ]},
      Friday: { title: 'Upper Hypertrophy', sub: 'Volume day.', exercises: [
        { name: 'Pull-ups', sets: 4, reps: '8' },
        { name: 'Chin-ups', sets: 4, reps: '8' },
        { name: 'Dips', sets: 4, reps: '12' },
        { name: 'Push-ups', sets: 4, reps: '20' },
        { name: 'Pike push-ups', sets: 4, reps: '12' }
      ]},
      Saturday: { title: 'Legs + Stamina', sub: 'Run & leg circuit.', notes: ['20 min run', 'Squats 4×25', 'Jump lunges 3×15'] },
      Sunday: { title: 'Recovery', sub: 'Mobility & light movement.', notes: ['Walk 20–30 min', 'Stretch hips, hamstrings, lats'] }
    }
  },
  2: { phase: 'Build', days: {} },
  3: { phase: 'Peak', days: {} }
};

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

let state = {
  week: 1,
  dayOffset: 0,
  settings: { goalWeight: 68, startWeek: 1 },
  completedWorkouts: [],
  tempSession: null
};

let weightChart = null;
let timerInterval = null;
let timerSeconds = 0;

function todayStr() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(str) { return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function escapeAttr(str) { return escapeHtml(str).replace(/"/g, '&quot;'); }

function getPhaseNumber() { return state.week <= 4 ? 1 : state.week <= 8 ? 2 : 3; }
function getPhaseName() { return PROGRAM[getPhaseNumber()].phase; }
function getCurrentDayName() {
  const todayIndex = (new Date().getDay() + 6) % 7;
  return DAYS[(todayIndex + state.dayOffset + 700) % 7];
}
function getTodayWorkout() { return PROGRAM[getPhaseNumber()].days[getCurrentDayName()]; }

async function loadState() {
  const saved = await get('settings', 'appState');
  if (saved?.value) state = { ...state, ...saved.value };
  if (state.settings) state.week = state.settings.startWeek || 1;
}
async function saveState() {
  await put('settings', { key: 'appState', value: { week: state.week, dayOffset: state.dayOffset, settings: state.settings, completedWorkouts: state.completedWorkouts } });
}

function buildSessionDraft() {
  const workout = getTodayWorkout();
  const exercises = (workout?.exercises || []).map(ex => ({
    name: ex.name,
    targetSets: ex.sets || '',
    targetReps: ex.reps || '',
    logs: Array.from({ length: Number(ex.sets) || 1 }, () => ({ reps: '', weight: '', rest: '', notes: '' }))
  }));
  return {
    id: uid('session'),
    date: todayStr(),
    week: state.week,
    day: getCurrentDayName(),
    phase: getPhaseName(),
    title: workout?.title || 'Session',
    exercises,
    energy: '',
    soreness: '',
    notes: '',
    completed: false
  };
}

async function renderAll() {
  await renderToday();
  await renderLogPage();
  await renderProgress();
  renderProgram();
  renderSettings();
}

async function renderToday() {
  const workout = getTodayWorkout();
  document.getElementById('dayNameDisplay').textContent = `Week ${state.week} · ${getCurrentDayName()}`;
  document.getElementById('todayTitle').textContent = workout?.title || 'Session';
  document.getElementById('todaySubtitle').textContent = workout?.sub || '';
  document.getElementById('todayWorkoutPreview').innerHTML = renderWorkoutPreview(workout);
  const water = await get('notes', 'today-water');
  const w = (water?.value || 0).toFixed(2);
  document.getElementById('waterTotal').textContent = `Total today: ${w} L`;
  document.getElementById('statusText').textContent = `Water: ${w} L`;
}

function renderWorkoutPreview(workout) {
  if (!workout) return `<div class="muted">No workout loaded.</div>`;
  return `
    <div class="list">
      ${(workout.exercises || []).map(ex => `
        <div class="log-row">
          <div class="exercise-name">${escapeHtml(ex.name)}</div>
          <div class="exercise-meta">${escapeHtml(String(ex.sets))} sets × ${escapeHtml(String(ex.reps))} reps</div>
        </div>`).join('')}
      ${(workout.notes || []).map(n => `<div class="log-row"><div class="muted">${escapeHtml(n)}</div></div>`).join('')}
    </div>`;
}

// ========== Session editor (with add/remove sets) ==========
function renderSessionEditor() {
  if (!state.tempSession) state.tempSession = buildSessionDraft();
  const s = state.tempSession;
  const root = document.getElementById('sessionEditor');
  root.innerHTML = `
    <div class="muted">${s.date} · Week ${s.week} · ${s.day}</div>
    <div class="list">
      ${s.exercises.map((ex, ei) => `
        <div class="exercise-card">
          <div class="exercise-head">
            <div>
              <div class="exercise-name">${escapeHtml(ex.name)}</div>
              <div class="exercise-meta">Target: ${escapeHtml(String(ex.targetSets))} sets × ${escapeHtml(String(ex.targetReps))}</div>
            </div>
            <button class="remove-exercise-btn chip" data-ei="${ei}">✕</button>
          </div>
          <div class="sets">
            ${ex.logs.map((log, li) => `
              <div class="set-row">
                <input data-e="${ei}" data-l="${li}" data-f="reps" type="text" placeholder="Reps" value="${escapeAttr(log.reps)}" />
                <input data-e="${ei}" data-l="${li}" data-f="weight" type="text" placeholder="Load (kg)" value="${escapeAttr(log.weight)}" />
                <input data-e="${ei}" data-l="${li}" data-f="rest" type="text" placeholder="Rest (s)" value="${escapeAttr(log.rest)}" />
                <input data-e="${ei}" data-l="${li}" data-f="notes" type="text" placeholder="Notes" value="${escapeAttr(log.notes)}" />
                <button class="remove-set-btn" data-ei="${ei}" data-li="${li}">✕</button>
              </div>
            `).join('')}
            <button class="add-set-btn chip" data-ei="${ei}">+ Add set</button>
          </div>
        </div>
      `).join('')}
    </div>
    <button id="addExerciseBtn" class="secondary" style="margin-top:10px">+ Add exercise</button>
  `;

  root.querySelectorAll('input[data-e]').forEach(input => {
    input.addEventListener('input', e => {
      const ei = Number(e.target.dataset.e), li = Number(e.target.dataset.l);
      state.tempSession.exercises[ei].logs[li][e.target.dataset.f] = e.target.value;
    });
  });

  root.querySelectorAll('.remove-set-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const ei = Number(e.target.dataset.ei), li = Number(e.target.dataset.li);
      state.tempSession.exercises[ei].logs.splice(li, 1);
      renderSessionEditor();
    });
  });

  root.querySelectorAll('.add-set-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const ei = Number(e.target.dataset.ei);
      state.tempSession.exercises[ei].logs.push({ reps: '', weight: '', rest: '', notes: '' });
      renderSessionEditor();
    });
  });

  root.querySelectorAll('.remove-exercise-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const ei = Number(e.target.dataset.ei);
      state.tempSession.exercises.splice(ei, 1);
      renderSessionEditor();
    });
  });

  document.getElementById('addExerciseBtn').addEventListener('click', () => {
    const name = prompt('Exercise name:');
    if (name) {
      state.tempSession.exercises.push({
        name, targetSets: '', targetReps: '',
        logs: [{ reps: '', weight: '', rest: '', notes: '' }]
      });
      renderSessionEditor();
    }
  });
}

async function renderLogPage() { renderSessionEditor(); }

// ========== Progress page ==========
async function renderProgress() {
  const sessions = await getAll('sessions');
  const weights = await getAll('weights');
  const nutrition = await getAll('nutrition');

  const currentWeight = weights.at(-1)?.value ?? '—';
  const totalProtein = nutrition.reduce((s, n) => s + (Number(n.protein)||0), 0);
  const totalCalories = nutrition.reduce((s, n) => s + (Number(n.calories)||0), 0);

  document.getElementById('progressStats').innerHTML = `
    <div class="stat"><div class="stat-value">${sessions.length}</div><div class="stat-label">Sessions</div></div>
    <div class="stat"><div class="stat-value">${currentWeight}</div><div class="stat-label">Current kg</div></div>
    <div class="stat"><div class="stat-value">${totalCalories}</div><div class="stat-label">Calories</div></div>
    <div class="stat"><div class="stat-value">${totalProtein}g</div><div class="stat-label">Protein</div></div>
  `;

  const prs = computePRs(sessions);
  document.getElementById('prList').innerHTML = prs.length ? prs.map(p => `
    <div class="log-row">
      <div>
        <span class="exercise-name">🏆 ${escapeHtml(p.exercise)}</span>
        <span class="muted"> — ${p.type}: ${p.value} (Week ${p.week})</span>
      </div>
    </div>
  `).join('') : '<div class="muted">Complete sets to see PRs.</div>';

  document.getElementById('exerciseHistory').innerHTML = sessions.slice(-10).reverse().map(s => `
    <div class="history-item">
      <div>
        <div class="exercise-name">${escapeHtml(s.title)}</div>
        <div class="muted">${escapeHtml(s.date)} · ${escapeHtml(s.day)} · Week ${s.week}</div>
      </div>
    </div>
  `).join('') || '<div class="muted">No sessions yet.</div>';

  document.getElementById('weightList').innerHTML = weights.slice(-10).reverse().map(w => `
    <div class="weight-item">
      <div>${escapeHtml(w.date)}</div>
      <div><strong>${w.value}</strong> kg</div>
    </div>
  `).join('') || '<div class="muted">No weigh-ins.</div>';

  drawWeightChart(weights);
}

function computePRs(sessions) {
  const best = {};
  sessions.forEach(s => {
    s.exercises?.forEach(ex => {
      ex.logs?.forEach(log => {
        const reps = Number(log.reps);
        const weight = Number(log.weight);
        if (!best[ex.name]) best[ex.name] = { maxWeight: 0, maxReps: 0, week: 0 };
        if (weight > best[ex.name].maxWeight) {
          best[ex.name].maxWeight = weight;
          best[ex.name].week = s.week;
        }
        if (reps > best[ex.name].maxReps) {
          best[ex.name].maxReps = reps;
          best[ex.name].week = s.week;
        }
      });
    });
  });
  const prs = [];
  Object.entries(best).forEach(([name, data]) => {
    if (data.maxWeight) prs.push({ exercise: name, type: 'Max weight', value: `${data.maxWeight}kg`, week: data.week });
    if (data.maxReps) prs.push({ exercise: name, type: 'Max reps', value: data.maxReps, week: data.week });
  });
  return prs;
}

function drawWeightChart(weights) {
  const ctx = document.getElementById('weightChartCanvas')?.getContext('2d');
  if (!ctx) return;
  if (weightChart) weightChart.destroy();
  const data = weights.map(w => ({ x: w.date, y: w.value }));
  weightChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Bodyweight (kg)',
        data,
        borderColor: '#ff6b1a',
        backgroundColor: 'rgba(255,107,26,0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { type: 'time', time: { unit: 'day' }, grid: { color: '#2a2a38' } },
        y: { grid: { color: '#2a2a38' } }
      },
      plugins: { legend: { labels: { color: '#ececf5' } } }
    }
  });
}

// ========== Program & Settings ==========
function renderProgram() {
  const phaseNum = getPhaseNumber();
  const phase = PROGRAM[phaseNum];
  let html = '';
  DAYS.forEach(day => {
    const d = phase.days[day];
    if (!d) return;
    html += `
      <div class="program-day">
        <div class="exercise-name">${day} — ${escapeHtml(d.title)}</div>
        <div class="muted">${escapeHtml(d.sub || '')}</div>
        ${d.exercises ? d.exercises.map(e => `<div class="muted" style="margin-left:12px">• ${escapeHtml(e.name)} ${e.sets}×${e.reps}</div>`).join('') : ''}
      </div>`;
  });
  document.getElementById('programView').innerHTML = html;
}

function renderSettings() {
  document.getElementById('startWeekInput').value = state.settings.startWeek;
  document.getElementById('goalWeightInput').value = state.settings.goalWeight;
}

// ========== Timer ==========
function setupTimerButtons(displayId, customSecId, startBtnId, stopBtnId) {
  const display = document.getElementById(displayId);
  const customSec = document.getElementById(customSecId);
  const startCustom = document.getElementById(startBtnId);
  const stopBtn = document.getElementById(stopBtnId);

  document.querySelectorAll(`[data-timer]`).forEach(btn => {
    btn.addEventListener('click', () => startTimer(parseInt(btn.dataset.timer), display));
  });

  startCustom.addEventListener('click', () => {
    const sec = parseInt(customSec.value || '0');
    if (sec > 0) startTimer(sec, display);
  });

  stopBtn.addEventListener('click', stopTimer);
}

function startTimer(seconds, displayEl) {
  stopTimer();
  timerSeconds = seconds;
  updateTimerDisplay(displayEl);
  timerInterval = setInterval(() => {
    timerSeconds--;
    if (timerSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      displayEl.textContent = '00:00';
    } else {
      updateTimerDisplay(displayEl);
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  document.querySelectorAll('.timer-display').forEach(el => el.textContent = '00:00');
}

function updateTimerDisplay(el) {
  const mins = Math.floor(timerSeconds / 60);
  const secs = timerSeconds % 60;
  el.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
}

// ========== Actions ==========
async function addWater(amount) {
  const item = await get('notes', 'today-water');
  const current = item?.value || 0;
  await put('notes', { id: 'today-water', value: current + amount });
  await renderToday();
}

async function saveSession() {
  if (!state.tempSession) return;
  state.tempSession.energy = document.getElementById('sessionEnergy').value;
  state.tempSession.soreness = document.getElementById('sessionSoreness').value;
  state.tempSession.notes = document.getElementById('sessionNotes').value;
  state.tempSession.completed = true;
  await put('sessions', state.tempSession);
  state.completedWorkouts.push({
    id: state.tempSession.id,
    date: state.tempSession.date,
    day: state.tempSession.day,
    week: state.tempSession.week
  });
  state.tempSession = buildSessionDraft();
  await saveState();
  await renderAll();
  window.dispatchEvent(new Event('sessionSaved'));
}

async function exportData() {
  const data = await exportDB();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `forge-backup-${todayStr()}.json`; a.click();
  URL.revokeObjectURL(url);
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  await importDB(JSON.parse(text));
  await loadState();
  await renderAll();
}

async function saveSettings() {
  state.settings.startWeek = Number(document.getElementById('startWeekInput').value || 1);
  state.settings.goalWeight = Number(document.getElementById('goalWeightInput').value || 68);
  state.week = state.settings.startWeek;
  await saveState();
  await renderAll();
}

function showPage(page) {
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  if (page === 'log') renderSessionEditor();
  if (page === 'progress') renderProgress();
}

// ========== Register events ==========
function registerEvents() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  document.getElementById('startWorkoutBtn').addEventListener('click', () => {
    state.tempSession = buildSessionDraft();
    renderSessionEditor();
    showPage('log');
  });

  document.getElementById('quickCompleteBtn').addEventListener('click', async () => {
    const draft = buildSessionDraft();
    draft.completed = true;
    await put('sessions', draft);
    state.completedWorkouts.push({ id: draft.id, date: draft.date, day: draft.day, week: draft.week });
    await saveState();
    await renderAll();
  });

  document.getElementById('prevDayBtn').addEventListener('click', () => { state.dayOffset--; saveState(); renderAll(); });
  document.getElementById('nextDayBtn').addEventListener('click', () => { state.dayOffset++; saveState(); renderAll(); });
  document.getElementById('todayBtn').addEventListener('click', () => { state.dayOffset = 0; saveState(); renderAll(); });

  document.querySelectorAll('[data-water]').forEach(btn => {
    btn.addEventListener('click', () => addWater(parseFloat(btn.dataset.water)));
  });

  document.getElementById('addCustomWaterBtn').addEventListener('click', () => {
    const amt = parseFloat(document.getElementById('customWater').value || 0);
    if (amt) addWater(amt);
  });

  setupTimerButtons('timerDisplay', 'customTimerSec', 'startCustomTimerBtn', 'stopTimerBtn');
  setupTimerButtons('timerDisplay2', 'customTimerSec2', 'startCustomTimerBtn2', 'stopTimerBtn2');

  document.getElementById('saveSessionBtn').addEventListener('click', saveSession);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importInput').addEventListener('change', importData);
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

  window.addEventListener('sessionSaved', () => {
    document.getElementById('prBadge').style.display = 'block';
    setTimeout(() => document.getElementById('prBadge').style.display = 'none', 3000);
  });
}

// ========== Init ==========
(async () => {
  await loadState();
  await renderAll();
  registerEvents();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
