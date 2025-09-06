/* =========================
   HERYTECH – Mobile-first
   ========================= */

// ---------- CONFIG ----------
const MIN_FULL_DAY = 60 * 60;     // Full-day threshold (seconds)
const MAX_DAYS_PER_WEEK = 5;
const VOICE_LANG = { en:"en-US", fr:"fr-FR", es:"es-ES", zh:"zh-CN", ja:"ja-JP", ru:"ru-RU" };

// ---------- GLOBAL STATE ----------
let db, profile = null, trainings = null, voicesReady = false;

let workout = {
  running:false, sessionSecs:0, globalSec:0,
  currentSport:null, queue:[], queueSport:null,
  ex:null, rep:0, repTime:0, inPause:false, pauseTime:0,
  displayLang:"en", tickId:null
};

// ---------- INDEXEDDB ----------
const request = indexedDB.open("HerytechDB", 2);
request.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath:"id" });
  if (!db.objectStoreNames.contains("profile")) db.createObjectStore("profile", { keyPath:"id" });
};
request.onsuccess = async (e) => {
  db = e.target.result;
  profile = await loadProfile();
  toggleScreens(!!profile);
  updateWeeklyChip();
};
request.onerror = () => console.error("IndexedDB open failed");

// ---------- DOM ----------
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

// ---------- INIT ----------
document.addEventListener("DOMContentLoaded", async () => {
  // Guarantee modal is hidden before any paint
  historyModal.classList.add('hidden');
  historyModal.style.display = 'none';

  // Voices
  function initVoices(){ voicesReady = true; }
  window.speechSynthesis.onvoiceschanged = initVoices;
  if (speechSynthesis.getVoices().length) initVoices();

  // Load trainings (with safe fallback for file://)
  trainings = await loadTrainings();

  // Populate sports
  if (trainings && trainings.sports) {
    Object.keys(trainings.sports).forEach((k) => {
      const opt = document.createElement("option");
      opt.value = k; opt.textContent = capitalize(k);
      sportSel.appendChild(opt);
    });
  }

  // Wire UI
  obSave.addEventListener("click", handleSaveProfile);
  playBtn.addEventListener("click", startWorkout);
  stopBtn.addEventListener("click", stopWorkout);
  skipBtn.addEventListener("click", skipExercise);

  historyBtn.addEventListener("click", openHistory);
  closeHistory.addEventListener("click", closeHistoryModal);
  modalBackdrop.addEventListener("click", closeHistoryModal);
});

// ---------- LOADERS ----------
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
    return TRAININGS_FALLBACK; // small built-in dataset
  }
}

// ---------- UI HELPERS ----------
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

// ---------- SPEECH ----------
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

// ---------- HISTORY / RULES ----------
async function getThisWeekHistory() {
  const now = Date.now();
  const weekAgo = now - 7*24*60*60*1000;
  return new Promise((resolve) => {
    const tx = db.transaction("history","readonly");
    const req = tx.objectStore("history").getAll();
    req.onsuccess = () => resolve((req.result||[]).filter(r => r.date > weekAgo));
    req.onerror = () => resolve([]);
  });
}
async function updateWeeklyChip() {
  const hist = await getThisWeekHistory();
  const fullDays = hist.filter(h => h.fullDay).length;
  weeklyChipEl.textContent = `${fullDays} / ${MAX_DAYS_PER_WEEK} days`;
  playBtn.disabled = fullDays >= MAX_DAYS_PER_WEEK;
}
async function canTrainToday() {
  const hist = await getThisWeekHistory();
  return hist.filter(h => h.fullDay).length < MAX_DAYS_PER_WEEK;
}
function saveSession(seconds){
  return new Promise((resolve) => {
    const fullDay = seconds >= MIN_FULL_DAY;
    const tx = db.transaction("history","readwrite");
    tx.objectStore("history").put({ id:Date.now(), date:Date.now(), duration:seconds, fullDay });
    tx.oncomplete = () => resolve(fullDay);
  });
}

// ---------- METRICS ----------
function calcCalories(sport, weightKg, durationSec){
  const MET = { boxing:9, judo:8, wushu:7.5, bike:7, pushups:5, abs:4 }[sport] || 6;
  return Math.round((MET * 3.5 * weightKg / 200) * (durationSec/60));
}
function estimateDistance(sport, durationSec){
  if (sport !== "bike") return null;
  const kmph = 22;
  return +(kmph * (durationSec/3600)).toFixed(2);
}

// ---------- ONBOARDING ----------
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

// ---------- QUEUE ----------
function buildQueueForSport(sportKey){
  const list = trainings.sports[sportKey].exercises.slice();
  for (let i=list.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [list[i],list[j]]=[list[j],list[i]];
  }
  return list;
}

// ---------- WORKOUT ----------
async function startWorkout(){
  if (!trainings || !trainings.sports) { statusEl.textContent="Trainings not loaded."; return; }
  if (!(await canTrainToday())) { statusEl.textContent="Weekly limit reached. Rest soldier!"; playBtn.disabled=true; return; }

  workout.currentSport = sportSel.value || Object.keys(trainings.sports)[0];
  if (!workout.queue.length || workout.currentSport !== workout.queueSport) {
    workout.queue = buildQueueForSport(workout.currentSport);
    workout.queueSport = workout.currentSport;
  }
  workout.sessionSecs = 0; workout.globalSec = 0;
  workout.running = true; playBtn.disabled = true; stopBtn.disabled = false; skipBtn.disabled = false;

  nextExercise();
}

function nextExercise(){
  if (!workout.queue.length) workout.queue = buildQueueForSport(workout.currentSport);
  workout.ex = workout.queue.pop();
  workout.rep = 1; workout.repTime = 0; workout.pauseTime = 0; workout.inPause = false;

  const pref = langModeSel.value || "random";
  const { lang } = speakFromMap(workout.ex.explanation, pref);
  workout.displayLang = lang;

  exTitleEl.textContent = workout.ex.name;
  exExplainEl.textContent = workout.ex.explanation[workout.displayLang] || workout.ex.explanation.en || "—";

  statusEl.textContent = `${workout.ex.reps} reps • ${workout.ex.duration}s / rep • pause ${workout.ex.pause||0}s`;
  speakCommon("start", pref);

  if (workout.tickId) clearInterval(workout.tickId);
  workout.tickId = setInterval(tick, 1000);
}

function tick(){
  if (!workout.running) return;
  workout.sessionSecs++; workout.globalSec++;
  timerEl.textContent = formatMMSS(workout.sessionSecs);

  if (workout.inPause) {
    workout.pauseTime++;
    subtimerEl.textContent = `Pause ${workout.pauseTime}/${workout.ex.pause||0}s`;
    if (workout.pauseTime >= (workout.ex.pause||0)) {
      workout.inPause = false; workout.repTime = 0;
      speakCommon("start", langModeSel.value);
    }
    return;
  }

  workout.repTime++;
  subtimerEl.textContent = `Rep ${workout.rep}/${workout.ex.reps} • ${workout.repTime}/${workout.ex.duration}s`;

  if (workout.repTime === Math.floor(workout.ex.duration/2)) {
    speakCommon("encourage", langModeSel.value);
  }

  if (workout.sessionSecs === 1800) speakText("Thirty minutes. Ping.","en");
  if (workout.sessionSecs === 5400) speakText("One hour thirty. Ping.","en");
  if (workout.sessionSecs === 7200) speakText("Two hours reached. Warning.","en");

  if (workout.repTime >= workout.ex.duration) {
    speakCommon("stop", langModeSel.value);
    if (workout.rep < workout.ex.reps) {
      workout.rep++; workout.inPause = !!workout.ex.pause; workout.pauseTime = 0;
      return;
    }
    updateMetrics();
    nextExercise();
  }
}

// ---- NEW: Skip current exercise (jump to next) ----
function skipExercise(){
  if (!workout.running || !workout.ex) return;
  // speak stop cue, update metrics (session time continues), then next
  speakCommon("stop", langModeSel.value);
  updateMetrics();
  nextExercise();
}

function updateMetrics(){
  const sport = workout.currentSport;
  const cals = calcCalories(sport, profile?.weight||70, workout.sessionSecs);
  const km = estimateDistance(sport, workout.sessionSecs);
  let msg = `Calories ≈ ${cals}`;
  if (km!=null) msg += ` • Distance ≈ ${km} km`;
  caloriesEl.textContent = msg;
}

async function stopWorkout(){
  if (!workout.running) return;
  workout.running = false;
  clearInterval(workout.tickId);
  stopBtn.disabled = true; playBtn.disabled = false; skipBtn.disabled = true;

  const fullDay = await saveSession(workout.sessionSecs);
  await updateWeeklyChip();

  const hist = await getThisWeekHistory();
  if (hist.length >= 2) {
    const prev = hist[hist.length-2];
    const diff = workout.sessionSecs - prev.duration;
    const sign = diff >= 0 ? "+" : "–";
    lastPerfEl.textContent = `Last: ${formatMMSS(prev.duration)} • Today: ${formatMMSS(workout.sessionSecs)} (${sign}${formatMMSS(Math.abs(diff))})`;
  } else {
    lastPerfEl.textContent = `Today: ${formatMMSS(workout.sessionSecs)}`;
  }

  statusEl.textContent = fullDay ? "Full day logged. Hydrate and recover." : "Session logged (under 60 min).";
  if (!(await canTrainToday())) { playBtn.disabled = true; statusEl.textContent = "Weekly limit reached. Rest soldier!"; }
}

// ---------- HISTORY POPUP ----------
async function openHistory(){
  const tx = db.transaction("history","readonly");
  const req = tx.objectStore("history").getAll();
  req.onsuccess = () => {
    const items = (req.result||[]).sort((a,b)=>a.date-b.date);
    historyList.innerHTML = items.length
      ? items.map(renderHistItem).join("")
      : `<div class="hist-item"><div>No sessions yet.</div></div>`;
    historyModal.classList.remove('hidden');
    historyModal.style.display = 'grid';
    historyModal.setAttribute('aria-hidden','false');
  };
}
function renderHistItem(it){
  const d = new Date(it.date);
  const when = d.toLocaleString();
  const dur = formatMMSS(it.duration||0);
  const badge = it.fullDay ? `<span class="badge green">Full day</span>` : `<span class="badge gray">Partial</span>`;
  return `
    <div class="hist-item">
      <div class="hist-left">
        <strong>${when}</strong>
        <span>Duration: ${dur}</span>
      </div>
      ${badge}
    </div>
  `;
}
function closeHistoryModal(){
  historyModal.classList.add('hidden');
  historyModal.style.display = 'none';
  historyModal.setAttribute('aria-hidden','true');
}

// ---------- TRAININGS FALLBACK (minimal) ----------
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
