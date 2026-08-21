/* =========================
   HERYTECH – Mobile-first
   Resume + per-session Nali travel
   ========================= */

/* ---------- CONFIG ---------- */
const MIN_FULL_DAY = 3600;
const MAX_DAYS_PER_WEEK = 6;
const ENFORCE_WEEKLY_LIMIT = false;

const VOICE_LANG = {
  en: "en-US", fr: "fr-FR", es: "es-ES", zh: "zh-CN",
  ja: "ja-JP", ru: "ru-RU", mg: "mg-MG"
};

const SKIP_SILENCE_MS = 900;
const INTRO_DEBOUNCE_MS = 650;

/* ---------- NALI CONFIG ---------- */
const TRAVEL_URL = "https://nali.kahiether.com/";
const TRAVEL_ORIGIN = "https://nali.kahiether.com";
const TRAVEL_FREQUENCY_MS = 60000;
const TRAVEL_COMMAND_TIMEOUT_MS = 15000;

/* ---------- GLOBAL STATE ---------- */
let db, profile = null, trainings = null, voicesReady = false;
let skipMuteUntil = 0, introTimer = null, exerciseRunId = 0;
let wakeLock = null;

let workout = {
  running: false,
  startedAt: null,
  sessionSecs: 0,
  globalSec: 0,
  currentSport: null,
  queue: [],
  queueSport: null,
  ex: null,
  rep: 0,
  repTime: 0,
  inPause: false,
  pauseTime: 0,
  displayLang: "en",
  tickId: null
};

/* ---------- TRAVEL STATE ---------- */
let travelTrackerFrame = null;
let travelViewerFrame = null;
let activeTravelName = null;
let travelStartPromise = null;
const travelRequests = new Map();

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

const travelViewerModal = $("#travelViewerModal");
const travelViewerTitle = $("#travelViewerTitle");
const travelViewerContainer = $("#travelViewerContainer");
const closeTravelViewer = $("#closeTravelViewer");

/* ---------- INDEXEDDB ---------- */
const request = indexedDB.open("HerytechDB", 3);

request.onupgradeneeded = (e) => {
  db = e.target.result;

  if (!db.objectStoreNames.contains("history")) {
    db.createObjectStore("history", { keyPath: "id" });
  }

  if (!db.objectStoreNames.contains("profile")) {
    db.createObjectStore("profile", { keyPath: "id" });
  }

  if (!db.objectStoreNames.contains("runtime")) {
    db.createObjectStore("runtime", { keyPath: "id" });
  }
};

request.onsuccess = async (e) => {
  db = e.target.result;

  db.onversionchange = () => {
    try { db.close(); } catch {}
    console.warn("DB version change; closed.");
  };

  profile = await loadProfile();
  toggleScreens(!!profile);

  trainings = await loadTrainings();

  if (trainings?.sports) {
    Object.keys(trainings.sports).forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = capitalize(key);
      sportSel.appendChild(opt);
    });
  }

  await resumeIfRuntimeActive();
  await applyLaunchParamsFromHash();
  await updateWeeklyChip();
};

request.onerror = () => console.error("IndexedDB open failed");

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", () => {
  [historyModal, travelViewerModal].forEach((modal) => {
    modal.classList.add("hidden");
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  });

  function initVoices() { voicesReady = true; }

  window.speechSynthesis.onvoiceschanged = initVoices;
  if (speechSynthesis.getVoices().length) initVoices();

  obSave.addEventListener("click", handleSaveProfile);

  playBtn.addEventListener("click", startWorkout);
  stopBtn.addEventListener("click", stopWorkout);
  skipBtn.addEventListener("click", skipExercise);

  historyBtn.addEventListener("click", openHistory);
  closeHistory.addEventListener("click", closeHistoryModal);
  modalBackdrop.addEventListener("click", closeHistoryModal);

  closeTravelViewer.addEventListener("click", closeTravelViewerModal);

  document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
  window.addEventListener("pagehide", releaseScreenWakeLock, { passive: true });

  window.addEventListener("hashchange", async () => {
    if (!workout.running) await applyLaunchParamsFromHash();
  });
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
    tx.objectStore("profile").put({ id: "user", data });
    tx.oncomplete = () => resolve(true);
  });
}

async function loadTrainings() {
  try {
    const r = await fetch("trainings.json", { cache: "no-store" });

    if (!r.ok) throw new Error("HTTP " + r.status);

    return await r.json();
  } catch (err) {
    console.warn("Failed to fetch trainings.json, using fallback.", err);
    return TRAININGS_FALLBACK;
  }
}

/* ---------- RUNTIME ---------- */
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

    tx.objectStore("runtime").put({
      id: "current",
      ...payload
    });

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

/* ---------- RESUME ACTIVE SESSION ---------- */
async function resumeIfRuntimeActive() {
  const rt = await readRuntime();

  if (!rt?.running || !rt.startedAt) return;

  workout.running = true;
  workout.startedAt = Number(rt.startedAt);
  workout.currentSport =
    rt.sport ||
    Object.keys(trainings?.sports || { bike: 1 })[0];

  sportSel.value = workout.currentSport;
  langModeSel.value = rt.langPref || "random";

  setWorkoutSelectorsLocked(true);

  playBtn.disabled = true;
  stopBtn.disabled = true;
  skipBtn.disabled = true;

  exTitleEl.textContent = "Active session";
  exExplainEl.textContent = "Resumed after reload.";
  statusEl.textContent = "Session resumed.";

  activeTravelName =
    rt.travelName ||
    buildTravelName(
      workout.startedAt,
      workout.currentSport
    );

  if (!rt.travelName) {
    await writeRuntime({
      running: true,
      startedAt: workout.startedAt,
      sport: workout.currentSport,
      langPref: langModeSel.value || "random",
      travelName: activeTravelName
    });
  }

  if (workout.tickId) clearInterval(workout.tickId);

  workout.tickId = setInterval(backgroundTick, 1000);

  renderElapsedIntoUI();
  updateMetrics();

  await requestScreenWakeLock();

  stopBtn.disabled = false;

  beginTravelTracking(activeTravelName);
}

/* ---------- UTILS ---------- */
function getElapsedSecs() {
  if (!workout.startedAt) return 0;

  return Math.max(
    0,
    Math.floor((Date.now() - workout.startedAt) / 1000)
  );
}

function renderElapsedIntoUI() {
  const secs =
    workout.running
      ? getElapsedSecs()
      : workout.sessionSecs;

  timerEl.textContent = formatMMSS(secs);
}

function toggleScreens(hasProfile) {
  screenOnboarding.classList.toggle("hidden", !!hasProfile);
  screenMain.classList.toggle("hidden", !hasProfile);
}

function capitalize(s) {
  return s
    ? s.charAt(0).toUpperCase() + s.slice(1)
    : "";
}

function formatMMSS(totalSec) {
  totalSec = Math.max(
    0,
    Math.floor(Number(totalSec) || 0)
  );

  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");

  const s = (totalSec % 60)
    .toString()
    .padStart(2, "0");

  return `${m}:${s}`;
}

function setWorkoutSelectorsLocked(locked) {
  sportSel.disabled = !!locked;
  langModeSel.disabled = !!locked;
}

async function getTodayTotalSeconds() {
  const now = new Date();

  const startOfDay =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

  const endOfDay =
    startOfDay +
    24 * 60 * 60 * 1000;

  return new Promise((resolve) => {
    const tx = db.transaction("history", "readonly");
    const req = tx.objectStore("history").getAll();

    req.onsuccess = () => {
      const total = (req.result || [])
        .filter(
          (r) =>
            Number(r.date) >= startOfDay &&
            Number(r.date) < endOfDay
        )
        .reduce(
          (sum, r) =>
            sum + Number(r.duration || 0),
          0
        );

      resolve(total);
    };

    req.onerror = () => resolve(0);
  });
}

/* ---------- HASH PRECONFIG ---------- */
function parseHashParams() {
  const raw =
    (window.location.hash || "")
      .replace(/^#/, "")
      .trim();

  if (!raw) return {};

  const params = {};

  raw.split("&").forEach((pair) => {
    const [k, v = ""] = pair.split("=");

    const key =
      decodeURIComponent((k || "").trim())
        .toLowerCase();

    const value =
      decodeURIComponent((v || "").trim());

    if (key) params[key] = value;
  });

  return params;
}

function normalizeStartNow(value) {
  if (
    value == null ||
    String(value).trim() === ""
  ) {
    return true;
  }

  const v =
    String(value)
      .trim()
      .toLowerCase();

  return v === "yes" || v === "true";
}

function normalizeLanguage(value) {
  const langs = Object.keys(VOICE_LANG);

  if (
    value == null ||
    String(value).trim() === ""
  ) {
    return "random";
  }

  const v =
    String(value)
      .trim()
      .toLowerCase();

  return langs.includes(v) ? v : "en";
}

function normalizeSport(value) {
  if (!value) return null;

  const v =
    String(value)
      .trim()
      .toLowerCase();

  return trainings?.sports?.[v] ? v : null;
}

async function applyLaunchParamsFromHash() {
  if (
    workout.running ||
    !profile ||
    !trainings?.sports
  ) {
    return;
  }

  const params = parseHashParams();

  if (!Object.keys(params).length) return;

  const requestedSportRaw = params.sport;
  const requestedSport = normalizeSport(requestedSportRaw);
  const requestedLang = normalizeLanguage(params.language);
  const autoStart = normalizeStartNow(params.startnow);

  langModeSel.value = requestedLang;

  if (!requestedSportRaw) {
    statusEl.textContent =
      "Launch URL invalid: sport parameter is required.";

    return;
  }

  if (!requestedSport) {
    statusEl.textContent =
      `Launch URL invalid: unknown sport "${requestedSportRaw}".`;

    return;
  }

  sportSel.value = requestedSport;
  workout.currentSport = requestedSport;

  const coach =
    requestedLang === "random"
      ? "random"
      : requestedLang;

  statusEl.textContent =
    autoStart
      ? `Auto-launch configured: ${capitalize(requestedSport)} • coach ${coach}`
      : `Preselected: ${capitalize(requestedSport)} • coach ${coach}`;

  if (
    autoStart &&
    !workout.running
  ) {
    await startWorkout();
  }
}

/* ---------- SPEECH ---------- */
function pickVoice(lang) {
  const list =
    speechSynthesis.getVoices() ||
    [];

  const bcp47 =
    VOICE_LANG[lang] ||
    "en-US";

  const female = list.filter(
    (v) =>
      v.lang === bcp47 &&
      /female|woman|google.*female/i.test(v.name)
  );

  if (female.length) return female[0];

  return (
    list.find((v) => v.lang === bcp47) ||
    list[0] ||
    null
  );
}

function speakText(
  text,
  langPref = "random"
) {
  const langs =
    Object.keys(VOICE_LANG);

  const chosen =
    langPref === "random"
      ? langs[
          Math.floor(
            Math.random() *
            langs.length
          )
        ]
      : langPref;

  const u =
    new SpeechSynthesisUtterance(text);

  u.lang =
    VOICE_LANG[chosen] ||
    "en-US";

  const voice =
    pickVoice(chosen);

  if (voice) u.voice = voice;

  speechSynthesis.speak(u);
}

function speakFromMap(
  map,
  langPref = "random"
) {
  const langs =
    Object.keys(VOICE_LANG);

  const chosen =
    langPref === "random"
      ? langs[
          Math.floor(
            Math.random() *
            langs.length
          )
        ]
      : langPref;

  const text =
    map[chosen] ||
    map.en ||
    Object.values(map)[0];

  speakText(text, chosen);

  return {
    lang: chosen,
    text
  };
}

function speakCommon(
  bucket,
  langPref = "random"
) {
  const pool = {};

  Object.keys(VOICE_LANG)
    .forEach((lang) => {
      const arr =
        trainings.commonPhrases[bucket][lang] ||
        [];

      pool[lang] =
        arr.length
          ? arr[
              Math.floor(
                Math.random() *
                arr.length
              )
            ]
          : null;
    });

  return speakFromMap(
    pool,
    langPref
  );
}

function canSpeak() {
  return Date.now() >= skipMuteUntil;
}

/* ---------- HISTORY / RULES ---------- */
async function getThisWeekHistory() {
  const weekAgo =
    Date.now() -
    7 * 24 * 60 * 60 * 1000;

  return new Promise((resolve) => {
    const tx =
      db.transaction(
        "history",
        "readonly"
      );

    const req =
      tx.objectStore("history")
        .getAll();

    req.onsuccess = () => {
      resolve(
        (req.result || [])
          .filter(
            (r) =>
              Number(r.date) >
              weekAgo
          )
      );
    };

    req.onerror = () => resolve([]);
  });
}

async function updateWeeklyChip() {
  const hist =
    await getThisWeekHistory();

  const fullDays =
    hist.filter((h) => h.fullDay).length;

  if (ENFORCE_WEEKLY_LIMIT) {
    weeklyChipEl.textContent =
      `${fullDays} / ${MAX_DAYS_PER_WEEK} days`;

    playBtn.disabled =
      fullDays >= MAX_DAYS_PER_WEEK ||
      workout.running;
  } else {
    weeklyChipEl.textContent =
      `${fullDays} days this week`;

    playBtn.disabled =
      workout.running;
  }
}

async function canTrainToday() {
  if (!ENFORCE_WEEKLY_LIMIT) return true;

  const hist =
    await getThisWeekHistory();

  return (
    hist.filter((h) => h.fullDay).length <
    MAX_DAYS_PER_WEEK
  );
}

async function saveSession(
  seconds,
  travelName = null
) {
  const now = Date.now();

  const todayTotalBefore =
    await getTodayTotalSeconds();

  const fullDay =
    todayTotalBefore +
      seconds >=
    MIN_FULL_DAY - 1;

  return new Promise((resolve) => {
    const tx =
      db.transaction(
        "history",
        "readwrite"
      );

    tx.objectStore("history")
      .put({
        id: now,
        date: now,
        duration: seconds,
        fullDay,
        sport: workout.currentSport,
        travelName: travelName || null
      });

    tx.oncomplete = () =>
      resolve(fullDay);
  });
}

/* ---------- METRICS ---------- */
function calcCalories(
  sport,
  weightKg,
  durationSec
) {
  const MET = {
    boxing: 9,
    judo: 8,
    wushu: 7.5,
    bike: 7,
    pushups: 5,
    abs: 4
  }[sport] || 6;

  return Math.round(
    (
      MET *
      3.5 *
      weightKg /
      200
    ) *
    (
      durationSec /
      60
    )
  );
}

function estimateDistance(
  sport,
  durationSec
) {
  if (sport !== "bike") return null;

  return +(
    22 *
    (
      durationSec /
      3600
    )
  ).toFixed(2);
}

function updateMetrics() {
  const sport =
    workout.currentSport ||
    sportSel.value ||
    Object.keys(
      trainings?.sports ||
      { bike: 1 }
    )[0];

  const elapsed =
    workout.running
      ? getElapsedSecs()
      : workout.sessionSecs;

  const cals =
    calcCalories(
      sport,
      profile?.weight || 70,
      elapsed
    );

  const km =
    estimateDistance(
      sport,
      elapsed
    );

  let msg =
    `Calories ≈ ${cals}`;

  if (km != null) {
    msg += ` • Distance ≈ ${km} km`;
  }

  caloriesEl.textContent = msg;
}

/* ---------- ONBOARDING ---------- */
async function handleSaveProfile() {
  const gender = obGender.value;

  const weight =
    parseFloat(
      obWeight.value ||
      "0"
    );

  const height =
    parseFloat(
      obHeight.value ||
      "0"
    );

  if (!weight || !height) {
    speakText(
      "Please fill weight and height.",
      "en"
    );

    return;
  }

  profile = {
    gender,
    weight,
    height
  };

  await saveProfile(profile);

  toggleScreens(true);

  playBtn.disabled = false;

  await updateWeeklyChip();
  await applyLaunchParamsFromHash();
}

/* ---------- QUEUE ---------- */
function buildQueueForSport(sportKey) {
  const list =
    trainings.sports[
      sportKey
    ].exercises.slice();

  for (
    let i = list.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );

    [
      list[i],
      list[j]
    ] = [
      list[j],
      list[i]
    ];
  }

  return list;
}

/* ---------- INTRO ---------- */
function scheduleIntroForCurrentExercise(pref) {
  if (introTimer) {
    clearTimeout(introTimer);
    introTimer = null;
  }

  const myRunId =
    ++exerciseRunId;

  const delay =
    Math.max(
      INTRO_DEBOUNCE_MS,
      skipMuteUntil -
      Date.now()
    );

  introTimer =
    setTimeout(() => {
      if (
        !workout.running ||
        myRunId !== exerciseRunId
      ) {
        return;
      }

      if (
        Date.now() <
        skipMuteUntil
      ) {
        scheduleIntroForCurrentExercise(pref);
        return;
      }

      const { lang } =
        speakFromMap(
          workout.ex.explanation,
          pref
        );

      workout.displayLang = lang;

      speakCommon(
        "start",
        pref
      );

    }, Math.max(0, delay));
}

/* ============================================================
   NALI TRAVEL BRIDGE
   ============================================================ */

function makeTravelRequestId() {
  return (
    `hery-${Date.now()}-` +
    Math.random()
      .toString(36)
      .slice(2)
  );
}

function buildTravelName(
  startedAt,
  sport
) {
  const d =
    new Date(
      Number(startedAt)
    );

  const datePart = [
    d.getFullYear(),
    String(
      d.getMonth() + 1
    ).padStart(2, "0"),
    String(
      d.getDate()
    ).padStart(2, "0")
  ].join("-");

  const timePart = [
    String(
      d.getHours()
    ).padStart(2, "0"),
    String(
      d.getMinutes()
    ).padStart(2, "0"),
    String(
      d.getSeconds()
    ).padStart(2, "0")
  ].join("-");

  return (
    `Herytech ${sport || "training"} ` +
    `${datePart} ${timePart}`
  );
}

function createHiddenTravelIframe() {
  if (
    travelTrackerFrame?.isConnected
  ) {
    return travelTrackerFrame;
  }

  const frame =
    document.createElement("iframe");

  frame.src = TRAVEL_URL;
  frame.title = "Herytech travel tracker";
  frame.allow = "geolocation";
  frame.setAttribute(
    "aria-hidden",
    "true"
  );

  Object.assign(
    frame.style,
    {
      position: "fixed",
      width: "1px",
      height: "1px",
      left: "-10000px",
      top: "-10000px",
      border: "0",
      opacity: "0",
      pointerEvents: "none"
    }
  );

  frame.addEventListener(
    "load",
    () => {
      frame.dataset.loaded = "1";
    }
  );

  document.body.appendChild(frame);

  travelTrackerFrame = frame;

  return frame;
}

function rejectTravelRequestsForFrame(
  frame,
  reason = "Travel iframe closed."
) {
  for (
    const [
      requestId,
      pending
    ] of
    travelRequests.entries()
  ) {
    if (
      pending.frame !== frame
    ) {
      continue;
    }

    clearTimeout(
      pending.timeout
    );

    travelRequests.delete(
      requestId
    );

    pending.reject(
      new Error(reason)
    );
  }
}

function destroyHiddenTravelIframe() {
  if (!travelTrackerFrame) return;

  const frame =
    travelTrackerFrame;

  travelTrackerFrame = null;

  rejectTravelRequestsForFrame(frame);

  try {
    frame.remove();
  } catch {}
}

function waitForIframeLoad(frame) {
  return new Promise(
    (resolve, reject) => {
      if (!frame) {
        reject(
          new Error(
            "Travel iframe unavailable."
          )
        );

        return;
      }

      if (
        frame.dataset.loaded ===
        "1"
      ) {
        resolve();
        return;
      }

      let finished = false;

      const timeout =
        setTimeout(() => {
          if (finished) return;

          finished = true;

          reject(
            new Error(
              "Travel iframe load timeout."
            )
          );

        }, TRAVEL_COMMAND_TIMEOUT_MS);

      frame.addEventListener(
        "load",
        () => {
          if (finished) return;

          finished = true;

          clearTimeout(timeout);

          frame.dataset.loaded = "1";

          resolve();

        },
        { once: true }
      );
    }
  );
}

async function sendTravelCommand(
  frame,
  command,
  params = {}
) {
  if (!frame?.contentWindow) {
    throw new Error(
      "Travel iframe is not available."
    );
  }

  await waitForIframeLoad(frame);

  return new Promise(
    (resolve, reject) => {
      const requestId =
        makeTravelRequestId();

      const timeout =
        setTimeout(() => {
          travelRequests.delete(
            requestId
          );

          reject(
            new Error(
              `Travel command timeout: ${command}`
            )
          );

        }, TRAVEL_COMMAND_TIMEOUT_MS);

      travelRequests.set(
        requestId,
        {
          resolve,
          reject,
          timeout,
          frame
        }
      );

      frame.contentWindow.postMessage(
        {
          type: "travel-command",
          requestId,
          command,
          params
        },
        TRAVEL_ORIGIN
      );
    }
  );
}

window.addEventListener(
  "message",
  (event) => {
    if (
      event.origin !==
      TRAVEL_ORIGIN
    ) {
      return;
    }

    const trackerWindow =
      travelTrackerFrame?.contentWindow;

    const viewerWindow =
      travelViewerFrame?.contentWindow;

    if (
      event.source !== trackerWindow &&
      event.source !== viewerWindow
    ) {
      return;
    }

    const data = event.data;

    if (
      !data ||
      data.type !== "travel-response" ||
      !data.requestId
    ) {
      return;
    }

    const pending =
      travelRequests.get(
        data.requestId
      );

    if (!pending) return;

    clearTimeout(
      pending.timeout
    );

    travelRequests.delete(
      data.requestId
    );

    if (data.ok) {
      pending.resolve(
        data.result
      );

      return;
    }

    pending.reject(
      new Error(
        data.error?.message ||
        data.error ||
        `Travel command failed: ${data.command || "unknown"}`
      )
    );
  }
);

async function startTravelTracking(travelName) {
  if (!travelName) return;

  activeTravelName = travelName;

  const frame =
    createHiddenTravelIframe();

  try {
    await sendTravelCommand(
      frame,
      "startTravel",
      {
        name: travelName,
        frequencyMs:
          TRAVEL_FREQUENCY_MS
      }
    );

  } catch (err) {
    console.info(
      "Travel start/resume:",
      err?.message || err
    );
  }
}

function beginTravelTracking(travelName) {
  travelStartPromise =
    startTravelTracking(
      travelName
    );

  return travelStartPromise;
}

async function endTravelTracking(
  travelName = activeTravelName
) {
  if (travelStartPromise) {
    try {
      await travelStartPromise;
    } catch {}
  }

  travelStartPromise = null;

  if (!travelName) {
    destroyHiddenTravelIframe();
    return;
  }

  try {
    if (
      travelTrackerFrame?.contentWindow
    ) {
      await sendTravelCommand(
        travelTrackerFrame,
        "endTravel",
        {
          name: travelName
        }
      );
    }

  } catch (err) {
    console.warn(
      "Travel end failed:",
      err
    );

  } finally {
    activeTravelName = null;
    destroyHiddenTravelIframe();
  }
}

async function getAvailableTravelNames() {
  const existingTracker =
    !!travelTrackerFrame?.isConnected;

  const frame =
    createHiddenTravelIframe();

  try {
    const result =
      await sendTravelCommand(
        frame,
        "listTravels",
        {}
      );

    const travels =
      Array.isArray(result)
        ? result
        : Array.isArray(
            result?.travels
          )
          ? result.travels
          : [];

    return new Set(
      travels
        .map(
          (travel) =>
            String(
              travel?.name ||
              ""
            )
        )
        .filter(Boolean)
    );

  } catch (err) {
    console.warn(
      "Unable to retrieve travel availability:",
      err
    );

    return new Set();

  } finally {
    if (
      !workout.running &&
      !existingTracker
    ) {
      destroyHiddenTravelIframe();
    }
  }
}

/* ============================================================
   WORKOUT
   ============================================================ */

async function startWorkout() {
  if (!trainings?.sports) {
    statusEl.textContent =
      "Trainings not loaded.";

    return;
  }

  if (workout.running) return;

  if (
    !(await canTrainToday())
  ) {
    statusEl.textContent =
      "Weekly limit reached. Rest soldier!";

    playBtn.disabled = true;

    return;
  }

  workout.currentSport =
    sportSel.value ||
    Object.keys(
      trainings.sports
    )[0];

  if (
    !workout.queue.length ||
    workout.currentSport !==
      workout.queueSport
  ) {
    workout.queue =
      buildQueueForSport(
        workout.currentSport
      );

    workout.queueSport =
      workout.currentSport;
  }

  workout.startedAt = Date.now();
  workout.sessionSecs = 0;
  workout.globalSec = 0;
  workout.running = true;

  setWorkoutSelectorsLocked(true);

  activeTravelName =
    buildTravelName(
      workout.startedAt,
      workout.currentSport
    );

  playBtn.disabled = true;
  stopBtn.disabled = false;
  skipBtn.disabled = false;

  await writeRuntime({
    running: true,
    startedAt: workout.startedAt,
    sport: workout.currentSport,
    langPref:
      langModeSel.value ||
      "random",
    travelName:
      activeTravelName
  });

  beginTravelTracking(
    activeTravelName
  );

  nextExercise();

  await requestScreenWakeLock();
}

function nextExercise() {
  if (!workout.running) return;

  if (!workout.queue.length) {
    workout.queue =
      buildQueueForSport(
        workout.currentSport
      );
  }

  workout.ex =
    workout.queue.pop();

  workout.rep = 1;
  workout.repTime = 0;
  workout.pauseTime = 0;
  workout.inPause = false;

  const pref =
    langModeSel.value ||
    "random";

  const langs =
    Object.keys(VOICE_LANG);

  const chosen =
    pref === "random"
      ? langs[
          Math.floor(
            Math.random() *
            langs.length
          )
        ]
      : pref;

  workout.displayLang = chosen;

  exTitleEl.textContent =
    workout.ex.name;

  exExplainEl.textContent =
    workout.ex.explanation[
      workout.displayLang
    ] ||
    workout.ex.explanation.en ||
    "—";

  statusEl.textContent =
    `${workout.ex.reps} reps • ${workout.ex.duration}s / rep • pause ${workout.ex.pause || 0}s`;

  scheduleIntroForCurrentExercise(pref);

  if (workout.tickId) {
    clearInterval(
      workout.tickId
    );
  }

  workout.tickId =
    setInterval(
      tick,
      1000
    );
}

function tick() {
  if (!workout.running) return;

  renderElapsedIntoUI();

  if (workout.inPause) {
    workout.pauseTime++;

    subtimerEl.textContent =
      `Pause ${workout.pauseTime}/${workout.ex.pause || 0}s`;

    if (
      workout.pauseTime >=
      (workout.ex.pause || 0)
    ) {
      workout.inPause = false;
      workout.repTime = 0;

      if (canSpeak()) {
        speakCommon(
          "start",
          langModeSel.value
        );
      }
    }

  } else {
    workout.repTime++;

    subtimerEl.textContent =
      `Rep ${workout.rep}/${workout.ex.reps} • ${workout.repTime}/${workout.ex.duration}s`;

    if (
      workout.repTime ===
        Math.floor(
          workout.ex.duration / 2
        ) &&
      canSpeak()
    ) {
      speakCommon(
        "encourage",
        langModeSel.value
      );
    }

    if (
      workout.repTime >=
      workout.ex.duration
    ) {
      if (canSpeak()) {
        speakCommon(
          "stop",
          langModeSel.value
        );
      }

      if (
        workout.rep <
        workout.ex.reps
      ) {
        workout.rep++;
        workout.inPause =
          !!workout.ex.pause;
        workout.pauseTime = 0;

      } else {
        updateMetrics();
        nextExercise();
      }
    }
  }

  const elapsed =
    getElapsedSecs();

  if (
    elapsed === 1800 &&
    canSpeak()
  ) {
    speakText(
      "Thirty minutes. Ping.",
      "en"
    );
  }

  if (
    elapsed === 5400 &&
    canSpeak()
  ) {
    speakText(
      "One hour thirty. Ping.",
      "en"
    );
  }

  if (
    elapsed === 7200 &&
    canSpeak()
  ) {
    speakText(
      "Two hours reached. Warning.",
      "en"
    );
  }

  updateMetrics();
}

function backgroundTick() {
  if (!workout.running) return;

  renderElapsedIntoUI();

  subtimerEl.textContent =
    "Running in background…";

  updateMetrics();
}

function skipExercise() {
  if (
    !workout.running ||
    !workout.ex
  ) {
    return;
  }

  try {
    speechSynthesis.cancel();
  } catch {}

  if (introTimer) {
    clearTimeout(introTimer);
    introTimer = null;
  }

  skipMuteUntil =
    Date.now() +
    SKIP_SILENCE_MS;

  updateMetrics();
  nextExercise();
}

async function stopWorkout() {
  if (!workout.running) return;

  const realSecs =
    getElapsedSecs();

  const travelForHistory =
    activeTravelName;

  workout.running = false;

  setWorkoutSelectorsLocked(false);

  if (workout.tickId) {
    clearInterval(
      workout.tickId
    );
  }

  workout.tickId = null;

  try {
    speechSynthesis.cancel();
  } catch {}

  if (introTimer) {
    clearTimeout(introTimer);
    introTimer = null;
  }

  stopBtn.disabled = true;
  playBtn.disabled = false;
  skipBtn.disabled = true;

  await endTravelTracking(
    travelForHistory
  );

  await clearRuntime();
  await releaseScreenWakeLock();

  const fullDay =
    await saveSession(
      realSecs,
      travelForHistory
    );

  await updateWeeklyChip();

  const hist =
    await getThisWeekHistory();

  hist.sort(
    (a, b) =>
      Number(a.date) -
      Number(b.date)
  );

  if (hist.length >= 2) {
    const prev =
      hist[
        hist.length - 2
      ];

    const diff =
      realSecs -
      Number(
        prev.duration ||
        0
      );

    const sign =
      diff >= 0
        ? "+"
        : "–";

    lastPerfEl.textContent =
      `Last: ${formatMMSS(Number(prev.duration || 0))} • ` +
      `Today: ${formatMMSS(realSecs)} (${sign}${formatMMSS(Math.abs(diff))})`;

  } else {
    lastPerfEl.textContent =
      `Today: ${formatMMSS(realSecs)}`;
  }

  if (ENFORCE_WEEKLY_LIMIT) {
    statusEl.textContent =
      fullDay
        ? "Full day logged. Hydrate and recover."
        : "Session logged (under 60 min).";

  } else {
    statusEl.textContent =
      fullDay
        ? "Full day logged!"
        : "Session logged!";
  }

  workout.sessionSecs =
    realSecs;

  renderElapsedIntoUI();
}

/* ---------- HISTORY STORAGE ---------- */
async function getHistoryAll() {
  return new Promise((resolve) => {
    const tx =
      db.transaction(
        "history",
        "readonly"
      );

    const req =
      tx.objectStore("history")
        .getAll();

    req.onsuccess = () =>
      resolve(
        req.result || []
      );

    req.onerror = () =>
      resolve([]);
  });
}

async function updateHistoryRecord(
  id,
  patch
) {
  return new Promise((resolve) => {
    const tx =
      db.transaction(
        "history",
        "readwrite"
      );

    const store =
      tx.objectStore(
        "history"
      );

    const g =
      store.get(id);

    g.onsuccess = () => {
      const row =
        g.result;

      if (!row) {
        resolve(false);
        return;
      }

      store.put({
        ...row,
        ...patch
      });
    };

    g.onerror = () =>
      resolve(false);

    tx.oncomplete = () =>
      resolve(true);
  });
}

async function recomputeFullDayForEndTs(endTs) {
  const d =
    new Date(
      Number(endTs)
    );

  const start =
    new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate()
    ).getTime();

  const end =
    start +
    24 * 60 * 60 * 1000;

  const all =
    await getHistoryAll();

  const dayItems =
    all.filter(
      (r) =>
        Number(r.date) >= start &&
        Number(r.date) < end
    );

  const dayTotal =
    dayItems.reduce(
      (sum, r) =>
        sum +
        Number(
          r.duration ||
          0
        ),
      0
    );

  const fullDayFlag =
    dayTotal >=
    MIN_FULL_DAY - 1;

  await new Promise((resolve) => {
    const tx =
      db.transaction(
        "history",
        "readwrite"
      );

    const store =
      tx.objectStore(
        "history"
      );

    dayItems.forEach((r) => {
      store.put({
        ...r,
        fullDay:
          fullDayFlag
      });
    });

    tx.oncomplete = () =>
      resolve(true);

    tx.onerror = () =>
      resolve(true);
  });
}

/* ---------- EDIT HISTORY ---------- */
async function editHistoryDurationById(id) {
  const all =
    await getHistoryAll();

  const it =
    all.find(
      (x) =>
        String(x.id) ===
        String(id)
    );

  if (!it) return;

  const currentMin =
    Math.max(
      15,
      Math.min(
        240,
        Math.round(
          (
            Number(
              it.duration ||
              0
            ) /
            60
          ) /
          15
        ) *
        15 ||
        15
      )
    );

  const raw =
    prompt(
      "Duration (minutes) — 15 to 240, step 15",
      String(currentMin)
    );

  if (raw == null) return;

  const m =
    Number(raw);

  if (!Number.isFinite(m)) return;

  const snapped =
    Math.round(
      m / 15
    ) *
    15;

  const clamped =
    Math.max(
      15,
      Math.min(
        240,
        snapped
      )
    );

  const newSec =
    clamped * 60;

  const oldEnd =
    Number(it.date);

  const oldSec =
    Number(
      it.duration ||
      0
    );

  const newEnd =
    oldEnd -
    (
      (
        oldSec -
        newSec
      ) *
      1000
    );

  const ok =
    await updateHistoryRecord(
      it.id,
      {
        duration:
          newSec,
        date:
          newEnd
      }
    );

  if (!ok) return;

  await recomputeFullDayForEndTs(oldEnd);
  await recomputeFullDayForEndTs(newEnd);
  await updateWeeklyChip();
  await openHistory();
}

/* ---------- HISTORY POPUP ---------- */
async function openHistory() {
  historyModal.classList.remove("hidden");
  historyModal.style.display = "grid";

  historyModal.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.classList.add(
    "modal-open"
  );

  historyList.innerHTML =
    `<div class="hist-item"><div>Loading history…</div></div>`;

  const [
    items,
    availableTravels
  ] = await Promise.all([
    getHistoryAll(),
    getAvailableTravelNames()
  ]);

  items.sort(
    (a, b) =>
      Number(b.date) -
      Number(a.date)
  );

  if (!items.length) {
    historyList.innerHTML =
      `<div class="hist-item"><div>No sessions yet.</div></div>`;

    return;
  }

  let html = "";
  let lastDay = null;

  for (const it of items) {
    const d =
      new Date(
        Number(it.date)
      );

    const dayKey =
      d.toLocaleDateString(
        undefined,
        {
          year: "numeric",
          month: "short",
          day: "numeric"
        }
      );

    if (dayKey !== lastDay) {
      html +=
        `<div class="hist-day-sep"><strong>${escapeHtml(dayKey)}</strong></div>`;

      lastDay = dayKey;
    }

    const travelAvailable =
      !!it.travelName &&
      availableTravels.has(
        String(it.travelName)
      );

    html +=
      renderHistItem(
        it,
        travelAvailable
      );
  }

  historyList.innerHTML = html;

  historyList
    .querySelectorAll(
      ".hist-item[data-id]"
    )
    .forEach((el) => {
      el.addEventListener(
        "click",
        (ev) => {
          if (
            ev.target.closest(
              ".travel-view-btn"
            )
          ) {
            return;
          }

          ev.stopPropagation();

          editHistoryDurationById(
            el.getAttribute(
              "data-id"
            )
          );
        }
      );
    });

  historyList
    .querySelectorAll(
      ".travel-view-btn:not([disabled])"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          const travelName =
            button.getAttribute(
              "data-travel-name"
            );

          if (travelName) {
            openTravelViewer(
              travelName
            );
          }
        }
      );
    });
}

function renderHistItem(
  it,
  travelAvailable
) {
  const d =
    new Date(
      Number(it.date)
    );

  const when =
    d.toLocaleString();

  const dur =
    formatMMSS(
      Number(
        it.duration ||
        0
      )
    );

  const badge =
    it.fullDay
      ? `<span class="badge green">🥇Full day</span>`
      : `<span class="badge gray">Partial</span>`;

  const sportInitial =
    it.sport
      ? (
          [
            ...it.sport
          ][0] ||
          ""
        ).toUpperCase()
      : "";

  const travelName =
    String(
      it.travelName ||
      ""
    );

  const travelButton =
    travelAvailable
      ? `
        <button
          type="button"
          class="chip travel-view-btn"
          data-travel-name="${escapeHtmlAttribute(travelName)}"
          aria-label="View travel">
          View travel
        </button>
      `
      : `
        <button
          type="button"
          class="chip travel-view-btn"
          aria-label="Travel unavailable"
          disabled>
          View travel
        </button>
      `;

  return `
    <div
      class="hist-item"
      data-id="${escapeHtmlAttribute(String(it.id))}"
      style="cursor:pointer"
    >
      <div class="hist-left">
        <strong>${escapeHtml(when)}</strong>

        <span>
          Duration: ${escapeHtml(dur)}
          ${sportInitial ? ` • ${escapeHtml(sportInitial)}` : ""}
        </span>

        ${travelButton}
      </div>

      ${badge}
    </div>
  `;
}

function closeHistoryModal() {
  historyModal.classList.add("hidden");
  historyModal.style.display = "none";

  historyModal.setAttribute(
    "aria-hidden",
    "true"
  );

  if (!isAnyModalOpen()) {
    document.body.classList.remove(
      "modal-open"
    );
  }
}

/* ---------- TRAVEL VIEWER ---------- */
async function openTravelViewer(name) {
  if (!name) return;

  destroyTravelViewerFrame();

  travelViewerTitle.textContent = name;

  travelViewerModal.classList.remove("hidden");
  travelViewerModal.style.display = "grid";

  travelViewerModal.setAttribute(
    "aria-hidden",
    "false"
  );

  document.body.classList.add(
    "modal-open"
  );

  const frame =
    document.createElement("iframe");

  frame.src = TRAVEL_URL;
  frame.title = `Travel: ${name}`;
  frame.allow = "geolocation";

  Object.assign(
    frame.style,
    {
      display: "block",
      width: "100%",
      height: "100%",
      minHeight: "65vh",
      border: "0"
    }
  );

  frame.addEventListener(
    "load",
    () => {
      frame.dataset.loaded = "1";
    }
  );

  travelViewerContainer.innerHTML = "";

  travelViewerContainer.appendChild(
    frame
  );

  travelViewerFrame = frame;

  try {
    await sendTravelCommand(
      frame,
      "openTravel",
      { name }
    );

  } catch (err) {
    console.error(
      "Unable to open travel:",
      err
    );
  }
}

function destroyTravelViewerFrame() {
  if (!travelViewerFrame) {
    travelViewerContainer.innerHTML = "";
    return;
  }

  const frame =
    travelViewerFrame;

  travelViewerFrame = null;

  rejectTravelRequestsForFrame(frame);

  try {
    frame.remove();
  } catch {}

  travelViewerContainer.innerHTML = "";
}

function closeTravelViewerModal() {
  travelViewerModal.classList.add("hidden");
  travelViewerModal.style.display = "none";

  travelViewerModal.setAttribute(
    "aria-hidden",
    "true"
  );

  destroyTravelViewerFrame();

  if (!isAnyModalOpen()) {
    document.body.classList.remove(
      "modal-open"
    );
  }
}

function isAnyModalOpen() {
  return (
    historyModal?.style.display !== "none" ||
    travelViewerModal?.style.display !== "none"
  );
}

/* ---------- HTML ESCAPING ---------- */
function escapeHtml(value) {
  return String(value)
    .replace(
      /[&<>"']/g,
      (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]
    );
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value);
}

/* ---------- WAKE LOCK ---------- */
async function requestScreenWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock =
        await navigator
          .wakeLock
          .request("screen");

      wakeLock.addEventListener?.(
        "release",
        () => {}
      );
    }
  } catch {}
}

async function releaseScreenWakeLock() {
  try {
    await wakeLock?.release();
  } catch {}

  wakeLock = null;
}

async function onVisibilityChange() {
  if (document.hidden) {
    try {
      speechSynthesis.cancel();
    } catch {}

    return;
  }

  if (!workout.running) return;

  renderElapsedIntoUI();
  updateMetrics();

  await requestScreenWakeLock();

  if (
    !introTimer &&
    workout.ex
  ) {
    scheduleIntroForCurrentExercise(
      langModeSel.value ||
      "random"
    );
  }
}

/* ---------- TRAININGS FALLBACK ---------- */
const TRAININGS_FALLBACK = {
  commonPhrases: {
    start: {
      en: ["Start!", "Go!"],
      fr: ["Commence!", "C'est parti!"],
      es: ["¡Empieza!", "¡Vamos!"],
      zh: ["开始!", "出发!"],
      ja: ["開始!", "行こう!"],
      ru: ["Начинай!", "Вперед!"],
      mg: ["Atombohy!", "Andao!"]
    },

    encourage: {
      en: ["Keep going!", "Stay strong!"],
      fr: ["Continue!", "Tiens bon!"],
      es: ["¡Sigue!", "¡Fuerza!"],
      zh: ["坚持!", "加油!"],
      ja: ["続けて!", "頑張れ!"],
      ru: ["Продолжай!", "Держись!"],
      mg: ["Tohizo!", "Mahereza!"]
    },

    stop: {
      en: ["Stop!", "Rest!"],
      fr: ["Stop!", "Repos!"],
      es: ["¡Para!", "¡Descansa!"],
      zh: ["停!", "休息!"],
      ja: ["止め!", "休め!"],
      ru: ["Стоп!", "Отдых!"],
      mg: ["Ajanony!", "Mialà sasatra!"]
    }
  },

  sports: {
    boxing: {
      exercises: [{
        name: "Jab–Cross Flow",
        duration: 90,
        reps: 4,
        pause: 20,
        explanation: {
          en: "Left jab then right cross. Guard up, pivot rear foot.",
          fr: "Direct gauche puis croisé droit. Garde haute, pivote.",
          es: "Jab izq y cruzado der. Guarda alta.",
          zh: "左刺拳接右直拳，保持防守，后脚转体。",
          ja: "左ジャブ→右クロス。ガード高く、後足でピボット。",
          ru: "Левый джеб – правый кросс. Держи защиту, разворот стопы.",
          mg: "Jab havia avy eo cross havanana. Tazomy ambony ny fiarovana ary ahodino ny tongotra aoriana."
        }
      }]
    },

    judo: {
      exercises: [{
        name: "Uchi-komi (entries)",
        duration: 180,
        reps: 5,
        pause: 20,
        explanation: {
          en: "Repeat entries: kuzushi then tsukuri. Sleeve–lapel grips.",
          fr: "Entrées: kuzushi puis tsukuri. Manche–revers.",
          es: "Entradas: kuzushi y tsukuri. Manga–solapa.",
          zh: "先崩再入身；抓袖抓领。",
          ja: "崩してから作りへ。袖・襟取り。",
          ru: "Кузуси, затем цукури. Рукав-отворот.",
          mg: "Avereno ny fidirana: kuzushi avy eo tsukuri. Tazomy ny tanany sy ny vozon'akanjo."
        }
      }]
    },

    wushu: {
      exercises: [{
        name: "Ma Bu (horse stance)",
        duration: 180,
        reps: 3,
        pause: 20,
        explanation: {
          en: "Low stance, knees out, back straight.",
          fr: "Posture basse, genoux ouverts, dos droit.",
          es: "Postura baja, rodillas hacia fuera.",
          zh: "马步下沉，膝外撑，背直。",
          ja: "馬歩を低く、膝を外へ。",
          ru: "Ма бу низко, колени наружу.",
          mg: "Mijanòna ambany, avoahy ny lohalika ary tazomy mahitsy ny lamosina."
        }
      }]
    },

    pushups: {
      exercises: [{
        name: "Standard push-ups",
        duration: 60,
        reps: 4,
        pause: 20,
        explanation: {
          en: "Body straight, chest close to floor, lockout.",
          fr: "Corps gainé, poitrine proche du sol, extension.",
          es: "Cuerpo alineado, extensión completa.",
          zh: "身体成一直线，完全伸直。",
          ja: "体を一直線に、肘を伸ばす。",
          ru: "Корпус прямой, полная фиксация.",
          mg: "Tazomy mahitsy ny vatana, ampanakaiky ny tany ny tratra ary ahitsio tanteraka ny sandry."
        }
      }]
    },

    abs: {
      exercises: [{
        name: "Plank hold",
        duration: 90,
        reps: 3,
        pause: 20,
        explanation: {
          en: "Elbows under shoulders, core tight, back flat.",
          fr: "Coudes sous épaules, gainage serré, dos plat.",
          es: "Codos bajo hombros, core firme.",
          zh: "肘在肩下，核心收紧，背平直。",
          ja: "肘は肩の真下、体幹を締める。",
          ru: "Локти под плечами, корпус в тонусе.",
          mg: "Ataovy eo ambanin'ny soroka ny kiho, henjana ny kibo ary mahitsy ny lamosina."
        }
      }]
    },

    bike: {
      exercises: [{
        name: "Endurance ride",
        duration: 1800,
        reps: 1,
        pause: 0,
        explanation: {
          en: "Steady cadence ~90 RPM, moderate resistance.",
          fr: "Cadence régulière ~90 RPM, résistance modérée.",
          es: "Cadencia estable ~90 RPM.",
          zh: "踏频约90，中等阻力稳骑。",
          ja: "約90RPMで安定、適度な負荷。",
          ru: "Каденс ~90, среднее сопротивление.",
          mg: "Tazomy ho eo amin'ny 90 RPM ny fihodinana ary ampiasao fanoherana antonony."
        }
      }]
    }
  }
};
