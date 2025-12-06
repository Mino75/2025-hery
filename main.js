/* ========================= 
   HERYTECH – Mobile-first (robust + silent-skip with auto-reschedule)
   ========================= */

/* ---------- CONFIG ---------- */
const MIN_FULL_DAY = 7200;     // Full-day threshold (seconds) 2h
const MAX_DAYS_PER_WEEK = 6;

// NEW VARIABLE: Set to false to allow unlimited training (no weekly limit)
const ENFORCE_WEEKLY_LIMIT = false;  // Set to true to enforce 5-day limit, false to allow unlimited

const VOICE_LANG = { en:"en-US", fr:"fr-FR", es:"es-ES", zh:"zh-CN", ja:"ja-JP", ru:"ru-RU" };

/* Speech/skip behavior */
const SKIP_SILENCE_MS = 900;      // mute window after each skip (extends with each skip)
const INTRO_DEBOUNCE_MS = 650;    // delay before speaking intro of the current exercise

/* ---------- GLOBAL STATE ---------- */
let db, profile = null, trainings = null, voicesReady = false;

// Workout state (robust + resumable)
let workout = {
  running: false,
  startedAt: null,        // ms timestamp — single source of truth for elapsed time
  sessionSecs: 0,         // display copy (frozen at stop)
  globalSec: 0,

  currentSport: null,
  queue: [],
  queueSport: null,

  ex: null, rep: 0, repTime: 0, inPause: false, pauseTime: 0,
  displayLang: "en",
  tickId: null
};

// Skip/intro control
let skipMuteUntil = 0;     // until when TTS is muted
let introTimer = null;     // pending intro timer
let exerciseRunId = 0;     // increments on each nextExercise()

// Wake Lock (best-effort)
let wakeLock = null;

/* ---------- INDEXEDDB ---------- */
/* Version bump to 3 — only adds the "runtime" store (history/profile remain unchanged) */
const request = indexedDB.open("HerytechDB", 3);

request.onupgradeneeded = (e) => {
  db = e.target.result;

  if (!db.objectStoreNames.contains("history")) {
    db.createObjectStore("history", { keyPath:"id" });
  }
  if (!db.objectStoreNames.contains("profile")) {
    db.createObjectStore("profile", { keyPath:"id" });
  }
  // New store for resilience (one record: id:"current")
  if (!db.objectStoreNames.contains("runtime")) {
    db.createObjectStore("runtime", { keyPath:"id" });
  }
};

request.onsuccess = async (e) => {
  db = e.target.result;

  // Close DB cleanly if a future versionchange happens
  db.onversionchange = () => {
    try { db.close(); } catch {}
    console.warn("DB version change; closed.");
  };

  profile = await loadProfile();
  toggleScreens(!!profile);

  trainings = await loadTrainings();
  if (trainings && trainings.sports) {
    Object.keys(trainings.sports).forEach((k) => {
      const opt = document.createElement("option");
      opt.value = k; opt.textContent = capitalize(k);
      sportSel.appendChild(opt);
    });
  }

  await resumeIfRuntimeActive();
  updateWeeklyChip();
};

request.onerror = () => console.error("IndexedDB open failed");

/* ---------- DOM ---------- */
const $ = (sel) => document.querySelector(sel);
const screenOnboarding = $("#screen-onboarding");
const screenMain = $("#screen-main");

const obGender = $("#ob-gender");
const obWeight = $("#ob-weight");
const obHeight = $("#ob-height");
const obSave = $("#ob-save");

const sportSel = $("#sport");
const langModeSel = $("#langMode");
const timerEl = $("#timer");
const subtimerEl = $("#subtimer");
const statusEl = $("#status");
const exTitleEl = $("#exTitle");
const exExplainEl = $("#exExplain");
const playBtn = $("#playBtn");
const skipBtn = $("#skipBtn");
const stopBtn = $("#stopBtn");
const caloriesEl = $("#calories");
const lastPerfEl = $("#lastPerf");
const weeklyChipEl = $("#weeklyChip");

const historyBtn = $("#historyBtn");
const historyModal = $("#historyModal");
const closeHistory = $("#closeHistory");
const historyList = $("#historyList");
const modalBackdrop = $("#modalBackdrop");

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  // Ensure modal is hidden before first paint (you already fixed blur/z-index)
  historyModal.classList.add('hidden');
  historyModal.style.display = 'none';

  // Voices
  function initVoices(){ voicesReady = true; }
  window.speechSynthesis.onvoiceschanged = initVoices;
  if (speechSynthesis.getVoices().length) initVoices();

  // Wire UI
  obSave.addEventListener("click", handleSaveProfile);
  playBtn.addEventListener("click", startWorkout);
  stopBtn.addEventListener("click", stopWorkout);
  skipBtn.addEventListener("click", skipExercise);

  historyBtn.addEventListener("click", openHistory);
  closeHistory.addEventListener("click", closeHistoryModal);
  modalBackdrop.addEventListener("click", closeHistoryModal);

  // Robustness: handle background/foreground transitions
  document.addEventListener("visibilitychange", onVisibilityChange, { passive:true });
  window.addEventListener("pagehide", releaseScreenWakeLock, { passive:true });
});

/* ---------- LOADERS ---------- */
async function loadProfile() {
  return new Promise((resolve) => {
    const tx = db.transaction("profile", "readonly");
    const req = tx.objectStore("profile").get("user");
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => resolve(null);
  });
}
async function saveProfile(data) {
  return new Promise((resolve) => {
    const tx = db.transaction("profile", "readwrite");
    tx.objectStore("profile").put({ id:"user", data });
    tx.oncomplete = () => resolve(true);
  });
}
async function loadTrainings() {
  try {
    const r = await fetch("trainings.json", { cache:"no-store" });
    if (!r.ok) throw new Error("HTTP "+r.status);
    return await r.json();
  } catch (err) {
    console.warn("Failed to fetch trainings.json, using fallback.", err);
    return TRAININGS_FALLBACK;
  }
}

/* ---------- RUNTIME PERSISTENCE ---------- */
async function readRuntime() {
  return new Promise((resolve) => {
    const tx = db.transaction("runtime", "readonly");
    const req = tx.objectStore("runtime").get("current");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}
async function writeRuntime(payload) {
  return new Promise((resolve) => {
    const tx = db.transaction("runtime", "readwrite");
    tx.objectStore("runtime").put({ id: "current", ...payload });
    tx.oncomplete = () => resolve(true);
  });
}
async function clearRuntime() {
  return new Promise((resolve) => {
    const tx = db.transaction("runtime", "readwrite");
    tx.objectStore("runtime").delete("current");
    tx.oncomplete = () => resolve(true);
  });
}
async function resumeIfRuntimeActive() {
  const rt = await readRuntime();
  if (!rt || !rt.running || !rt.startedAt) return;

  // Minimal resume: show active session, accurate elapsed time, metrics
  workout.running = true;
  workout.startedAt = rt.startedAt;
  workout.currentSport = rt.sport || Object.keys(trainings?.sports || { bike:1 })[0];

  playBtn.disabled = true;
  stopBtn.disabled = true;   // disabled until UI settles (enable below)
  skipBtn.disabled = true;

  exTitleEl.textContent = "Active session";
  exExplainEl.textContent = "Resumed after background.";
  statusEl.textContent = "Session resumed.";

  langModeSel.value = rt.langPref || "random";

  if (workout.tickId) clearInterval(workout.tickId);
  workout.tickId = setInterval(backgroundTick, 1000);

  await requestScreenWakeLock();

  // Update UI immediately; then enable Stop
  renderElapsedIntoUI();
  updateMetrics();
  stopBtn.disabled = false;
}

/* ---------- UTILS ---------- */
function getElapsedSecs() {
  if (!workout.startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - workout.startedAt) / 1000));
}
function renderElapsedIntoUI() {
  const secs = getElapsedSecs();
  timerEl.textContent = formatMMSS(secs);
}
function toggleScreens(hasProfile){
  screenOnboarding.classList.toggle("hidden", !!hasProfile);
  screenMain.classList.toggle("hidden", !hasProfile);
}
function capitalize(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function formatMMSS(totalSec){
  const m = Math.floor(totalSec/60).toString().padStart(2,"0");
  const s = (totalSec%60).toString().padStart(2,"0");
  return `${m}:${s}`;
}

/* ---------- SPEECH ---------- */
function pickVoice(lang) {
  const list = speechSynthesis.getVoices() || [];
  const bcp47 = VOICE_LANG[lang] || "en-US";
  const female = list.filter(v => v.lang === bcp47 && /female|woman|google.*female/i.test(v.name));
  if (female.length) return female[0];
  const same = list.find(v => v.lang === bcp47);
  return same || list[0] || null;
}
function speakText(text, langPref="random"){
  const langs = Object.keys(VOICE_LANG);
  const chosen = langPref === "random" ? langs[Math.floor(Math.random()*langs.length)] : langPref;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = VOICE_LANG[chosen] || "en-US";
  const v = pickVoice(chosen); if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function speakFromMap(map, langPref="random"){
  const langs = Object.keys(VOICE_LANG);
  const chosen = langPref === "random" ? langs[Math.floor(Math.random()*langs.length)] : langPref;
  const text = map[chosen] || map["en"] || Object.values(map)[0];
  speakText(text, chosen);
  return { lang: chosen, text };
}
function speakCommon(bucket, langPref="random"){
  const pool = {};
  for (const k of Object.keys(VOICE_LANG)) {
    const arr = trainings.commonPhrases[bucket][k] || [];
    pool[k] = arr.length ? arr[Math.floor(Math.random()*arr.length)] : null;
  }
  return speakFromMap(pool, langPref);
}
function canSpeak() {
  return Date.now() >= skipMuteUntil;
}

/* ---------- HISTORY / RULES ---------- */
async function getThisWeekHistory() {
  const now = Date.now();
  const weekAgo = now - 7*24*60*60*1000;
  return new Promise((resolve) => {
    const tx = db.transaction("history","readonly");
    const req = tx.objectStore("history").getAll();
    req.onsuccess = () => {
      const rows = (req.result||[]);
      resolve(rows.filter(r => Number(r.date) > weekAgo));
    };
    req.onerror = () => resolve([]);
  });
}
async function updateWeeklyChip() {
  const hist = await getThisWeekHistory();
  const fullDays = hist.filter(h => h.fullDay).length;
  
  // Display chip based on limit enforcement
  if (ENFORCE_WEEKLY_LIMIT) {
    weeklyChipEl.textContent = `${fullDays} / ${MAX_DAYS_PER_WEEK} days`;
    // Only disable play button if limit is enforced AND reached
    playBtn.disabled = fullDays >= MAX_DAYS_PER_WEEK || workout.running;
  } else {
    // When not enforcing, just show the count without limit
    weeklyChipEl.textContent = `${fullDays} days this week`;
    // Only disable play button if workout is running
    playBtn.disabled = workout.running;
  }
}
async function canTrainToday() {
  // If not enforcing limit, always allow training
  if (!ENFORCE_WEEKLY_LIMIT) return true;
  
  // Otherwise check against limit
  const hist = await getThisWeekHistory();
  return hist.filter(h => h.fullDay).length < MAX_DAYS_PER_WEEK;
}
function saveSession(seconds){
  return new Promise((resolve) => {
    const fullDay = seconds >= MIN_FULL_DAY;
    const now = Date.now();
    const tx = db.transaction("history","readwrite");
    tx.objectStore("history").put({ id: now, date: now, duration: seconds, fullDay, sport: workout.currentSport });
    tx.oncomplete = () => resolve(fullDay);
  });
}

/* ---------- METRICS ---------- */
function calcCalories(sport, weightKg, durationSec){
  const MET = { boxing:9, judo:8, wushu:7.5, bike:7, pushups:5, abs:4 }[sport] || 6;
  return Math.round((MET * 3.5 * weightKg / 200) * (durationSec/60));
}
function estimateDistance(sport, durationSec){
  if (sport !== "bike") return null;
  const kmph = 22;
  return +(kmph * (durationSec/3600)).toFixed(2);
}
function updateMetrics(){
  const sport = workout.currentSport || sportSel.value || Object.keys(trainings?.sports || { bike:1 })[0];
  const elapsed = workout.running ? getElapsedSecs() : workout.sessionSecs;
  const cals = calcCalories(sport, profile?.weight||70, elapsed);
  const km = estimateDistance(sport, elapsed);
  let msg = `Calories ≈ ${cals}`;
  if (km!=null) msg += ` • Distance ≈ ${km} km`;
  caloriesEl.textContent = msg;
}

/* ---------- ONBOARDING ---------- */
async function handleSaveProfile(){
  const gender = obGender.value;
  const weight = parseFloat(obWeight.value||"0");
  const height = parseFloat(obHeight.value||"0");
  if (!weight || !height) { speakText("Please fill weight and height.","en"); return; }
  profile = { gender, weight, height };
  await saveProfile(profile);
  toggleScreens(true);
  playBtn.disabled = false;
  updateWeeklyChip();
}

/* ---------- QUEUE ---------- */
function buildQueueForSport(sportKey){
  const list = trainings.sports[sportKey].exercises.slice();
  for (let i=list.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [list[i],list[j]]=[list[j],list[i]];
  }
  return list;
}

/* ---------- INTRO SCHEDULER (debounced + mute-aware) ---------- */
// Schedules the intro voice for the current exercise, respecting the skip-mute window.
// If it fires while still muted (rare race), it auto-reschedules.
function scheduleIntroForCurrentExercise(pref){
  if (introTimer) { clearTimeout(introTimer); introTimer = null; }
  const myRunId = ++exerciseRunId;

  const now = Date.now();
  const delay = Math.max(INTRO_DEBOUNCE_MS, skipMuteUntil - now);

  introTimer = setTimeout(() => {
    if (!workout.running) return;
    if (myRunId !== exerciseRunId) return;        // user moved to another exercise
    if (Date.now() < skipMuteUntil) {             // still muted? reschedule
      scheduleIntroForCurrentExercise(pref);
      return;
    }
    // Speak explanation + "start" cue now
    const { lang } = speakFromMap(workout.ex.explanation, pref);
    workout.displayLang = lang;
    speakCommon("start", pref);
  }, Math.max(0, delay));
}

/* ---------- WORKOUT ---------- */
async function startWorkout(){
  if (!trainings || !trainings.sports) { statusEl.textContent="Trainings not loaded."; return; }
  
  // Check training limit only if enforcing
  if (!(await canTrainToday())) { 
    statusEl.textContent="Weekly limit reached. Rest soldier!"; 
    playBtn.disabled=true; 
    return; 
  }

  workout.currentSport = sportSel.value || Object.keys(trainings.sports)[0];

  // Build exercise queue for live coaching (not required for persistence)
  if (!workout.queue.length || workout.currentSport !== workout.queueSport) {
    workout.queue = buildQueueForSport(workout.currentSport);
    workout.queueSport = workout.currentSport;
  }

  // Start time is the truth for elapsed time
  workout.startedAt = Date.now();
  workout.sessionSecs = 0;
  workout.globalSec = 0;
  workout.running = true;

  playBtn.disabled = true;
  stopBtn.disabled = false;
  skipBtn.disabled = false;

  // Persist runtime to survive reload/crash/background
  await writeRuntime({
    running: true,
    startedAt: workout.startedAt,
    sport: workout.currentSport,
    langPref: (langModeSel.value || "random")
  });

  nextExercise();
  await requestScreenWakeLock();
}

function nextExercise(){
  if (!workout.running) return;

  if (!workout.queue.length) workout.queue = buildQueueForSport(workout.currentSport);
  workout.ex = workout.queue.pop();
  workout.rep = 1; workout.repTime = 0; workout.pauseTime = 0; workout.inPause = false;

  const pref = langModeSel.value || "random";

  // Decide display language now (text updates immediately)
  const langs = Object.keys(VOICE_LANG);
  const chosen = pref === "random" ? langs[Math.floor(Math.random()*langs.length)] : pref;
  workout.displayLang = chosen;

  exTitleEl.textContent = workout.ex.name;
  exExplainEl.textContent = workout.ex.explanation[workout.displayLang] || workout.ex.explanation.en || "—";

  statusEl.textContent = `${workout.ex.reps} reps • ${workout.ex.duration}s / rep • pause ${workout.ex.pause||0}s`;

  // Debounced intro that also waits out the mute window (auto-reschedules if needed)
  scheduleIntroForCurrentExercise(pref);

  if (workout.tickId) clearInterval(workout.tickId);
  workout.tickId = setInterval(tick, 1000);
}

function tick(){
  if (!workout.running) return;

  // Elapsed time based on startedAt → accurate even if the tab slept
  renderElapsedIntoUI();

  // Live coaching (may miss ticks while hidden — acceptable)
  if (workout.inPause) {
    workout.pauseTime++;
    subtimerEl.textContent = `Pause ${workout.pauseTime}/${workout.ex.pause||0}s`;
    if (workout.pauseTime >= (workout.ex.pause||0)) {
      workout.inPause = false; workout.repTime = 0;
      if (canSpeak()) speakCommon("start", langModeSel.value);
    }
  } else {
    workout.repTime++;
    subtimerEl.textContent = `Rep ${workout.rep}/${workout.ex.reps} • ${workout.repTime}/${workout.ex.duration}s`;

    if (workout.repTime === Math.floor(workout.ex.duration/2)) {
      if (canSpeak()) speakCommon("encourage", langModeSel.value);
    }

    if (workout.repTime >= workout.ex.duration) {
      if (canSpeak()) speakCommon("stop", langModeSel.value);
      if (workout.rep < workout.ex.reps) {
        workout.rep++; workout.inPause = !!workout.ex.pause; workout.pauseTime = 0;
      } else {
        updateMetrics();
        nextExercise();
      }
    }
  }

  // Milestones (respect mute if you want them quiet during skip bursts)
  const elapsed = getElapsedSecs();
  if (elapsed === 1800 && canSpeak()) speakText("Thirty minutes. Ping.","en");
  if (elapsed === 5400 && canSpeak()) speakText("One hour thirty. Ping.","en");
  if (elapsed === 7200 && canSpeak()) speakText("Two hours reached. Warning.","en");

  updateMetrics();
}

// Minimal tick used during "resume" when we don't rebuild the full queue/exercise
function backgroundTick() {
  if (!workout.running) return;
  renderElapsedIntoUI();
  subtimerEl.textContent = "Running in background…";
  updateMetrics();
}

function skipExercise(){
  if (!workout.running || !workout.ex) return;

  // Cancel any current or pending speech
  try { speechSynthesis.cancel(); } catch {}
  if (introTimer) { clearTimeout(introTimer); introTimer = null; }

  // Extend mute window so rapid skipping stays silent
  skipMuteUntil = Date.now() + SKIP_SILENCE_MS;

  // No "stop/rest" voice for skipped items
  updateMetrics();
  nextExercise(); // scheduleIntroForCurrentExercise() accounts for mute window
}

async function stopWorkout(){
  if (!workout.running) return;
  const realSecs = getElapsedSecs();

  workout.running = false;
  clearInterval(workout.tickId);
  workout.tickId = null;

  // Clean speech timers
  try { speechSynthesis.cancel(); } catch {}
  if (introTimer) { clearTimeout(introTimer); introTimer = null; }

  stopBtn.disabled = true;
  playBtn.disabled = false;
  skipBtn.disabled = true;

  await clearRuntime();
  await releaseScreenWakeLock();

  const fullDay = await saveSession(realSecs);
  await updateWeeklyChip();

  // Last vs Today
  const hist = await getThisWeekHistory();
  hist.sort((a,b)=>Number(a.date)-Number(b.date));
  if (hist.length >= 2) {
    const prev = hist[hist.length-2];
    const diff = realSecs - Number(prev.duration || 0);
    const sign = diff >= 0 ? "+" : "–";
    lastPerfEl.textContent = `Last: ${formatMMSS(Number(prev.duration||0))} • Today: ${formatMMSS(realSecs)} (${sign}${formatMMSS(Math.abs(diff))})`;
  } else {
    lastPerfEl.textContent = `Today: ${formatMMSS(realSecs)}`;
  }

  // Update status message based on whether limits are enforced
  if (ENFORCE_WEEKLY_LIMIT) {
    statusEl.textContent = fullDay ? "Full day logged. Hydrate and recover." : "Session logged (under 60 min).";
  } else {
    // When not enforcing limits, just log the session without rest reminders
    statusEl.textContent = fullDay ? "Full day logged!" : "Session logged!";
  }

  // Freeze display at stop
  workout.sessionSecs = realSecs;
  renderElapsedIntoUI();
}

/* ---------- HISTORY POPUP ---------- */
async function openHistory(){
  const tx = db.transaction("history","readonly");
  const req = tx.objectStore("history").getAll();
    req.onsuccess = () => {
      const items = (req.result||[]).sort((a,b)=>Number(b.date)-Number(a.date)); // newest first

      if (!items.length) {
        historyList.innerHTML = `<div class="hist-item"><div>No sessions yet.</div></div>`;
        return;
      }

      let html = "";
      let lastDay = null;

      for (const it of items) {
        const d = new Date(Number(it.date));
        const dayKey = d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });

        if (dayKey !== lastDay) {
          // start a new group with a header
          html += `<div class="hist-day-sep"><strong>${dayKey}</strong></div>`;
          lastDay = dayKey;
        }
        html += renderHistItem(it);
      }

      historyList.innerHTML = html;

      historyModal.classList.remove('hidden');
      historyModal.style.display = 'grid';
      historyModal.setAttribute('aria-hidden','false');
      document.body.classList.add('modal-open');
    };

}
function renderHistItem(it){
  const d = new Date(Number(it.date));
  const when = d.toLocaleString();
  const dur = formatMMSS(Number(it.duration||0));
  const badge = it.fullDay ? `<span class="badge green">🥇Full day</span>` : `<span class="badge gray">Partial</span>`;
 const sportInitial = it.sport ? ([...it.sport][0] || '').toUpperCase() : ''; // take the first emoji
  return `
    <div class="hist-item">
      <div class="hist-left">
        <strong>${when}</strong>
        <span>Duration: ${dur} ${sportInitial ? ` • ${sportInitial}` : ''}</span>
      </div>
      ${badge}
    </div>
  `;
}
function closeHistoryModal(){
  historyModal.classList.add('hidden');
  historyModal.style.display = 'none';
  historyModal.setAttribute('aria-hidden','true');
  document.body.classList.remove('modal-open');
}

/* ---------- VISIBILITY & WAKE LOCK ---------- */
async function requestScreenWakeLock(){
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => {});
    }
  } catch (e) {
    // Not supported or denied; non-fatal
  }
}
async function releaseScreenWakeLock(){
  try { await wakeLock?.release(); } catch {}
  wakeLock = null;
}
async function onVisibilityChange(){
  if (document.hidden) {
    try { speechSynthesis.cancel(); } catch {}
  } else {
    if (workout.running) {
      renderElapsedIntoUI();
      updateMetrics();
      await requestScreenWakeLock();
      // If we have an exercise and no pending intro, schedule one respecting mute window
      if (!introTimer && workout.ex) scheduleIntroForCurrentExercise(langModeSel.value || "random");
    }
  }
}

/* ---------- TRAININGS FALLBACK (minimal) ---------- */
const TRAININGS_FALLBACK = {
  "commonPhrases":{
    "start":{"en":["Start!","Go!"],"fr":["Commence!","C'est parti!"],"es":["¡Empieza!","¡Vamos!"],"zh":["开始!","出发!"],"ja":["開始!","行こう!"],"ru":["Начинай!","Вперед!"]},
    "encourage":{"en":["Keep going!","Stay strong!"],"fr":["Continue!","Tiens bon!"],"es":["¡Sigue!","¡Fuerza!"],"zh":["坚持!","加油!"],"ja":["続けて!","頑張れ!"],"ru":["Продолжай!","Держись!"]},
    "stop":{"en":["Stop!","Rest!"],"fr":["Stop!","Repos!"],"es":["¡Para!","¡Descansa!"],"zh":["停!","休息!"],"ja":["止め!","休め!"],"ru":["Стоп!","Отдых!"]}
  },
  "sports":{
    "boxing":{"exercises":[
      {"name":"Jab–Cross Flow","duration":90,"reps":4,"pause":20,"explanation":{"en":"Left jab then right cross. Guard up, pivot rear foot.","fr":"Direct gauche puis croisé droit. Garde haute, pivote.","es":"Jab izq y cruzado der. Guarda alta.","zh":"左刺拳接右直拳，保持防守，后脚转体。","ja":"左ジャブ→右クロス。ガード高く、後足でピボット。","ru":"Левый джеб – правый кросс. Держи защиту, разворот стопы."}}
    ]},
    "judo":{"exercises":[
      {"name":"Uchi-komi (entries)","duration":180,"reps":5,"pause":20,"explanation":{"en":"Repeat entries: kuzushi then tsukuri. Sleeve–lapel grips.","fr":"Entrées: kuzushi puis tsukuri. Manche–revers.","es":"Entradas: kuzushi y tsukuri. Manga–solapa.","zh":"先崩再入身；抓袖抓领。","ja":"崩してから作りへ。袖・襟取り。","ru":"Кузуси, затем цукури. Рукав-отворот."}}
    ]},
    "wushu":{"exercises":[
      {"name":"Ma Bu (horse stance)","duration":180,"reps":3,"pause":20,"explanation":{"en":"Low stance, knees out, back straight.","fr":"Posture basse, genoux ouverts, dos droit.","es":"Postura baja, rodillas hacia fuera.","zh":"马步下沉，膝外撑，背直。","ja":"馬歩を低く、膝を外へ。","ru":"Ма бу низко, колени наружу."}}
    ]},
    "pushups":{"exercises":[
      {"name":"Standard push-ups","duration":60,"reps":4,"pause":20,"explanation":{"en":"Body straight, chest close to floor, lockout.","fr":"Corps gainé, poitrine proche du sol, extension.","es":"Cuerpo alineado, extensión completa.","zh":"身体成一直线，完全伸直。","ja":"体を一直線に、肘を伸ばす。","ru":"Корпус прямой, полная фиксация."}}
    ]},
    "abs":{"exercises":[
      {"name":"Plank hold","duration":90,"reps":3,"pause":20,"explanation":{"en":"Elbows under shoulders, core tight, back flat.","fr":"Coudes sous épaules, gainage serré, dos plat.","es":"Codos bajo hombros, core firme.","zh":"肘在肩下，核心收紧，背平直。","ja":"肘は肩の真下、体幹を締める。","ru":"Локти под плечами, корпус в тонусе."}}
    ]},
    "bike":{"exercises":[
      {"name":"Endurance ride","duration":1800,"reps":1,"pause":0,"explanation":{"en":"Steady cadence ~90 RPM, moderate resistance.","fr":"Cadence régulière ~90 RPM, résistance modérée.","es":"Cadencia estable ~90 RPM.","zh":"踏频约90，中等阻力稳骑。","ja":"約90RPMで安定、適度な負荷。","ru":"Каденс ~90, среднее сопротивление."}}
    ]}
  }
};



