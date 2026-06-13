console.log('app.js gestartet');
console.log('Supabase client:', db);

// =========================================================
// WHITE LABEL — CLUB SETTINGS
// Загрузка настроек клуба из таблицы clubs.
// Если Supabase недоступен или запись не найдена —
// сайт полностью работает через FALLBACK_CLUB (JCL).
// =========================================================

let currentClub = null;
const DEFAULT_CLUB_ID = 'jcl';

let superAdminSession    = null;
let isSuperAdminAccess   = false;
let isSAStandaloneMode   = false;   // true когда открыт через ?superadmin=1
let _saClubsCache        = [];   // { club, studentCount, adminTrainer, tarifRows } — заполняется при loadAndRenderSAClubs

const FALLBACK_CLUB = {
  club_id:                     'jcl',
  club_name:                   'Judo Club Langenfeld e.V.',
  club_short_name:             'JCL',
  logo_url:                    'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Startseite_1/1_JCL_logo.png',
  start_logo_url:              'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Startseite_1/1_JCL_logo.png',
  background_image_url:        'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Startseite_1/1_Fon.png',
  background_mobile_image_url: 'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Startseite_1/1_Fon.png',
  background_overlay_color:    'rgba(0,0,0,0.45)',
  background_overlay_opacity:   0.45,
  primary_color:               '#1a2332',
  secondary_color:             '#2d4a6e',
  accent_color:                '#4fc3f7',
  theme_variant:               'dark',
};

function getCurrentClubId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('club') || DEFAULT_CLUB_ID;
}

async function loadCurrentClubSettings() {
  const clubId = getCurrentClubId();
  try {
    const { data, error } = await db
      .from('clubs')
      .select('*')
      .eq('club_id', clubId)
      .maybeSingle();

    if (error || !data) {
      console.warn('[Club] Kein Eintrag oder Fehler — Fallback aktiv:', error);
      currentClub = FALLBACK_CLUB;
    } else {
      currentClub = data;
      console.log('[Club] Einstellungen geladen:', currentClub.club_short_name, '| active:', currentClub.active);
    }
  } catch (e) {
    console.warn('[Club] Netzwerkfehler — Fallback aktiv:', e);
    currentClub = FALLBACK_CLUB;
  }
  applyClubSettings();
  updateClubPaymentWarning();
}

function getClubAccessBlock() {
  if (!currentClub || currentClub === FALLBACK_CLUB) return null;
  if (currentClub.active === false) {
    return 'Der Zugang zu diesem Club ist aktuell durch den Systemadministrator deaktiviert.';
  }
  const { payWarn } = saGetClubWarningStatus(currentClub);
  if (payWarn === 'expired') {
    return 'Der Zugang zu diesem Club ist gesperrt, da der Zahlungszeitraum abgelaufen ist.';
  }
  return null;
}

async function getClubAccessBlockFresh() {
  const clubId = getCurrentClubId();
  console.log('[ClubBlock] Prüfe Club-Zugang für club_id:', clubId);
  const { data: club, error } = await db
    .from('clubs')
    .select('club_id, active, aktiv_bis, billing_cycle, contract_active, contract_auto_debit')
    .eq('club_id', clubId)
    .maybeSingle();
  console.log('[ClubBlock] Club-Daten:', club, '| Fehler:', error);
  if (error || !club) {
    console.warn('[ClubBlock] Club nicht gefunden — Zugang blockiert');
    return 'Der Zugang zu diesem Club ist nicht verfügbar.';
  }
  console.log('[ClubBlock] active:', club.active, '| aktiv_bis:', club.aktiv_bis);

  // Синхронизируем currentClub с актуальными данными и перерисовываем баннер,
  // чтобы повторная активация SA сразу отражалась без перезагрузки страницы
  if (currentClub && currentClub !== FALLBACK_CLUB) {
    currentClub.active    = club.active;
    currentClub.aktiv_bis = club.aktiv_bis;
    currentClub.billing_cycle       = club.billing_cycle;
    currentClub.contract_active     = club.contract_active;
    currentClub.contract_auto_debit = club.contract_auto_debit;
    updateClubPaymentWarning();
  }

  let blockReason = null;
  if (club.active === false) {
    blockReason = 'Der Zugang zu diesem Club ist aktuell durch den Systemadministrator deaktiviert.';
  } else {
    const { payWarn } = saGetClubWarningStatus(club);
    if (payWarn === 'expired') {
      blockReason = 'Der Zugang zu diesem Club ist gesperrt, da der Zahlungszeitraum abgelaufen ist.';
    }
  }
  console.log('[ClubBlock] Blockierungsgrund:', blockReason ?? 'keiner — Zugang erlaubt');
  return blockReason;
}

function updateClubPaymentWarning() {
  const el = document.getElementById('clubPaymentWarning');
  if (!el) return;

  // В standalone SA-режиме без просмотра клуба — не показывать
  if (isSAStandaloneMode && !isSuperAdminAccess) { el.classList.add('hidden'); return; }

  // SA-импersonation: данные клуба уже в currentClub
  const club = currentClub;
  if (!club || club === FALLBACK_CLUB) { el.classList.add('hidden'); return; }

  const { payWarn, payDaysLeft, contractWarn, contractDaysLeft } = saGetClubWarningStatus(club);

  let cls = '', icon = '', text = '';

  if (payWarn === 'expired') {
    cls  = 'club-pay-warning--red';
    icon = '🔴';
    text = 'Die Zahlung ist abgelaufen. Der Club ist derzeit nicht aktiv.';
  } else if (club.active === false) {
    cls  = 'club-pay-warning--red';
    icon = '🔴';
    text = 'Der Zugang zu diesem Club wurde durch den Systemadministrator vorübergehend deaktiviert.';
  } else if (payWarn === 'soon') {
    cls  = 'club-pay-warning--orange';
    icon = '⚠';
    text = `Die Zahlung läuft bald ab (noch ${payDaysLeft} Tage). Bitte kontaktieren Sie den Administrator.`;
  } else if (contractWarn) {
    cls  = 'club-pay-warning--blue';
    icon = '📄';
    text = `Der Vertrag läuft bald ab (noch ${contractDaysLeft} Tage). Bitte kontaktieren Sie den Administrator.`;
  } else {
    el.classList.add('hidden');
    return;
  }

  el.className = `club-pay-warning ${cls}`;
  document.getElementById('clubPaymentWarningIcon').textContent = icon;
  document.getElementById('clubPaymentWarningText').textContent = text;
}

function applyClubSettings() {
  if (!currentClub) return;
  const cfg = currentClub;
  const root = document.documentElement;

  // Заголовок вкладки браузера
  if (cfg.club_short_name) {
    document.title = cfg.club_short_name + ' Gruppen';
  }

  // Favicon — всегда устанавливаем: favicon_url → logo_url → fallback
  const faviconUrl = cfg.favicon_url || cfg.logo_url || FALLBACK_CLUB.logo_url;
  let faviconLink = document.querySelector("link[rel~='icon']");
  if (!faviconLink) {
    faviconLink = document.createElement('link');
    faviconLink.rel = 'icon';
    document.head.appendChild(faviconLink);
  }
  faviconLink.href = faviconUrl;

  // CSS Variables — фон, цвета, логотип
  const bgUrl    = cfg.background_image_url        || FALLBACK_CLUB.background_image_url;
  const bgMobUrl = cfg.background_mobile_image_url || bgUrl;
  const overlay  = cfg.background_overlay_color    || FALLBACK_CLUB.background_overlay_color;

  const bgDash = cfg.dashboard_background_url || FALLBACK_CLUB.background_image_url;

  root.style.setProperty('--club-background-image',            `url("${bgUrl}")`);
  root.style.setProperty('--club-mobile-background-image',     `url("${bgMobUrl}")`);
  root.style.setProperty('--club-dashboard-background-image',  `url("${bgDash}")`);
  root.style.setProperty('--club-overlay-color',                overlay);
  root.style.setProperty('--club-primary-color',   cfg.primary_color   || FALLBACK_CLUB.primary_color);
  root.style.setProperty('--club-secondary-color', cfg.secondary_color || FALLBACK_CLUB.secondary_color);
  root.style.setProperty('--club-accent-color',    cfg.accent_color    || FALLBACK_CLUB.accent_color);
  root.style.setProperty('--club-logo-url',        `url("${getClubLogoUrl()}")`);

  // Логотипы в DOM — все известные img-элементы с логотипом клуба
  const logoUrl = getClubLogoUrl();
  [
    'clubRoundLogo', 'st2ClubLogo', 'adminTopClubLogo',
    'adminHomeClubLogo', 'trainerHomeClubLogo', 'sportAdminClubLogo',
    'adminBuchTopClubLogo', 'editTrainerTopClubLogo', 'addTrainerHeroLogo',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.tagName === 'IMG') el.src = logoUrl;
  });

  // Тексты с названием клуба — обновляем после загрузки currentClub
  const short = cfg.club_short_name || FALLBACK_CLUB.club_short_name;
  const full  = cfg.club_name       || FALLBACK_CLUB.club_name;

  // Стартовая страница — большая аббревиатура и заголовок
  const mainLogo = document.querySelector('.sport-start-main-logo');
  if (mainLogo) mainLogo.textContent = short;

  const welcomeH1 = document.querySelector('.sport-start-header h1');
  if (welcomeH1) welcomeH1.textContent = 'Willkommen beim ' + short;

  const welcomeSub = document.querySelector('.sport-start-header p');
  if (welcomeSub) welcomeSub.textContent = full;

  // Footer стартовой страницы
  const footerStrong = document.querySelector('.sport-start-footer strong');
  if (footerStrong) footerStrong.textContent = short;

  const footerSpan = document.querySelector('.sport-start-footer span');
  if (footerSpan) footerSpan.textContent = full;

  // Главный заголовок приложения (видимый после логина)
  const topH1 = document.querySelector('.top-title-block h1');
  if (topH1) topH1.textContent = short + '-Gruppen';

  // Login экран — аббревиатура и полное название
  const st2Logo = document.querySelector('.st2-main-logo');
  if (st2Logo) st2Logo.textContent = short;

  const st2Name = document.querySelector('.st2-club-name');
  if (st2Name) st2Name.textContent = full;

  console.log('[Club] Einstellungen angewendet:', cfg.club_short_name);
}

let currentTrainer = null;
let screenHistory=[];

function pushScreen(screenId){

if(
screenHistory.length===0 ||
screenHistory[screenHistory.length-1]!==screenId
){
screenHistory.push(screenId);
}

}

function goBackScreen(){

if(screenHistory.length<2){

showAdminDashboard();
return;

}

screenHistory.pop();

const prevScreen=
screenHistory[screenHistory.length-1];

hideAllWorkScreens();

document
.getElementById(prevScreen)
?.classList.remove("hidden");

}


let allTrainers = [];
let previousScreenBeforeStats = null;
let previousScreenBeforeWeight = null;
let previousScreenBeforeEditStudent = null;
let promoTransitionActive = false;
let promoTransitionFileNames = [];
let promoSequenceIndex = 0;
let currentPromoSettings = { mode: 'random', duration: 3, fixed_image: null };
let promoActiveSlides    = [];
let sponsorsCache        = {};
let previousView = null;
let currentView = null;
let adminSelectedSport = '';
let selectedClubSport = '';

function setSelectedClubSport(sportId) {
  selectedClubSport = sportId || '';

  [
    'clubSportFilter',
    'clubStudentSportFilter',
    'groupOverviewSportFilter',
    'trainerOverviewSportFilter',
    'attendanceStatSportFilter'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = selectedClubSport;
  });
}

function getSelectedClubSport() {
  return selectedClubSport || '';
}
let adminAvailableSports = [];

async function loadCurrentPromoSettings() {
  const { data: settings } = await db
    .from('promo_settings')
    .select('*')
    .eq('club_id', currentClub.club_id)
    .maybeSingle();

  if (settings) {
    currentPromoSettings = {
      mode:        settings.mode        || 'random',
      duration:    settings.duration    || 3,
      fixed_image: settings.fixed_image || null,
    };
  }

  const { data: slides } = await db
    .from('promo_media')
    .select('file_name, file_path')
    .eq('club_id', currentClub.club_id)
    .eq('aktiv', true)
    .order('sort_order', { ascending: true });

  promoActiveSlides = slides || [];
}

async function loadSponsorsCache() {
  const { data } = await db
    .from('sponsors')
    .select('file_name, aktiv, aktiv_von, aktiv_bis')
    .eq('club_id', currentClub.club_id);

  sponsorsCache = {};
  (data || []).forEach(s => {
    sponsorsCache[s.file_name] = {
      aktiv:     s.aktiv,
      aktiv_von: s.aktiv_von || '',
      aktiv_bis: s.aktiv_bis || '',
    };
  });
}

function getPromoImageUrl() {
  const PROMO_BASE =
    'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/promo-transition/';

  const active = promoActiveSlides;

  if (active.length === 0) return getClubLogoUrl();

  const { mode, fixed_image } = currentPromoSettings;

  if (mode === 'fixed') {
    const match = active.find(s => s.file_name === fixed_image);
    const path  = (match || active[0]).file_path;
    return PROMO_BASE + path.split('/').map(encodeURIComponent).join('/');
  }

  if (mode === 'sequence') {
    promoSequenceIndex = promoSequenceIndex % active.length;
    const slide = active[promoSequenceIndex];
    promoSequenceIndex = (promoSequenceIndex + 1) % active.length;
    return PROMO_BASE + slide.file_path.split('/').map(encodeURIComponent).join('/');
  }

  // random
  const slide = active[Math.floor(Math.random() * active.length)];
  return PROMO_BASE + slide.file_path.split('/').map(encodeURIComponent).join('/');
}

async function showPromoTransition(callback) {

  if (promoTransitionActive) return;

  promoTransitionActive = true;

  const overlay = document.getElementById('promoTransitionOverlay');
  const img = document.getElementById('promoTransitionImage');

  if (!overlay || !img) {
    promoTransitionActive = false;

    if (typeof callback === 'function') {
      await callback();
    }

    return;
  }

  img.src = getPromoImageUrl();

  overlay.classList.remove('hidden');
  overlay.classList.remove('promo-running');

  void overlay.offsetWidth;

  overlay.classList.add('promo-running');

  const duration = currentPromoSettings.duration || 3;
  await new Promise(resolve => setTimeout(resolve, duration * 1000));

  try {
    if (typeof callback === 'function') {
      await callback();
    }
  } catch (error) {
    console.error('Fehler im Promo Callback:', error);
  }

  overlay.classList.remove('promo-running');
  overlay.classList.add('hidden');

  promoTransitionActive = false;
}

// =========================================================
// ST1 — STARTSEITE / SPORTAUSWAHL
// Первая страница сайта: выбор вида спорта
// =========================================================

const STARTSEITE_URL =
'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Startseite_1/';

// =====================================================
// JCL CLUB LOGO
// Единый логотип клуба для сайта и окна рекламы
// =====================================================

const CLUB_LOGO =
STARTSEITE_URL + '1_JCL_logo.png';

const SPORT_ICON_URL =
'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Sport_ikon/';


function getSportImageUrl(sport){

if(!sport)return '';

const standardFile =
STARTSEITE_CARD_FILES[sport.sport_id] ||
STARTSEITE_ICON_FILES[sport.sport_id];

if(standardFile){
return STARTSEITE_URL + standardFile;
}

if(sport.icon_file){
return SPORT_ICON_URL + String(sport.icon_file).trim();
}

return '';

}

const STARTSEITE_CARD_FILES = {
  judo: '1_Judo.png',
  jiujitsu: '1_Jiujitsu.png',
  taekwondo: '1_Taekwondo.png',
  boxen: '1_boxen.png',
  kickboxen: '1_kickboxen.png',
  muaythai: '1_Muay_Thai.png',
  taichi: '1_taichi.png'
};

// ─── Sport Field Config (Phase 1) ───────────────────────────────────────────
// Определяет какие поля показывать и как их называть для каждого вида спорта.
// Phase 1: статический конфиг. Phase 5: заменить источник на localStorage/Supabase.
// getSportConfig(sportId) возвращает конфиг по sport_id (slug) или default-fallback.

const SPORT_FIELD_CONFIG = {
  default:   { showGraduation: true,  graduationLabel: 'Kyu',  showBelt: true,  beltLabel: 'OBI',    showWeight: true  },
  judo:      { showGraduation: true,  graduationLabel: 'Kyu',  showBelt: true,  beltLabel: 'OBI',    showWeight: true  },
  jiujitsu:  { showGraduation: true,  graduationLabel: 'Kyu',  showBelt: true,  beltLabel: 'OBI',    showWeight: true  },
  taekwondo: { showGraduation: true,  graduationLabel: 'Geup', showBelt: true,  beltLabel: 'Gürtel', showWeight: true  },
  boxen:     { showGraduation: false, graduationLabel: 'Kyu',  showBelt: false, beltLabel: 'OBI',    showWeight: true  },
  kickboxen: { showGraduation: false, graduationLabel: 'Kyu',  showBelt: false, beltLabel: 'OBI',    showWeight: true  },
  muaythai:  { showGraduation: false, graduationLabel: 'Kyu',  showBelt: false, beltLabel: 'OBI',    showWeight: false },
  taichi:    { showGraduation: false, graduationLabel: 'Kyu',  showBelt: false, beltLabel: 'OBI',    showWeight: false },
};

function getSportConfig(sportId) {
  const key = 'sport_cfg_' + String(sportId || '').toLowerCase();
  const stored = localStorage.getItem(key);
  if (stored) {
    try { return JSON.parse(stored); } catch(e) {}
  }
  return SPORT_FIELD_CONFIG[String(sportId || '').toLowerCase()]
      || SPORT_FIELD_CONFIG.default;
}

// ─── Sport Rank / Belt Mapping ───────────────────────────────────────────────
// Статические значения Graduierung/Gürtel для конкретных видов спорта.
// Judo и все остальные → берётся из kyu_lookup (Supabase, kyuObiLookup).

const SPORT_RANK_BELT_MAP = {
  taekwondo: [
    { kyu_grad: '10. Geup', guertelfarbe: 'weiß'       },
    { kyu_grad: '9. Geup',  guertelfarbe: 'weiß-gelb'  },
    { kyu_grad: '8. Geup',  guertelfarbe: 'gelb'        },
    { kyu_grad: '7. Geup',  guertelfarbe: 'gelb-grün'   },
    { kyu_grad: '6. Geup',  guertelfarbe: 'grün'        },
    { kyu_grad: '5. Geup',  guertelfarbe: 'grün-blau'   },
    { kyu_grad: '4. Geup',  guertelfarbe: 'blau'        },
    { kyu_grad: '3. Geup',  guertelfarbe: 'blau-rot'    },
    { kyu_grad: '2. Geup',  guertelfarbe: 'rot'         },
    { kyu_grad: '1. Geup',  guertelfarbe: 'rot-schwarz' },
    { kyu_grad: '1. Dan',   guertelfarbe: 'schwarz'     },
    { kyu_grad: '2. Dan',   guertelfarbe: 'schwarz'     },
    { kyu_grad: '3. Dan',   guertelfarbe: 'schwarz'     },
    { kyu_grad: '4. Dan',   guertelfarbe: 'schwarz'     },
    { kyu_grad: '5. Dan',   guertelfarbe: 'schwarz'     },
  ],
};

// lookup для текущей открытой формы Neuer Student
let currentNewStudentLookup = [];

function getRankBeltLookup(sportId) {
  return SPORT_RANK_BELT_MAP[String(sportId || '').toLowerCase()]
      || kyuObiLookup;
}
// ────────────────────────────────────────────────────────────────────────────

// =========================================================
// ST2 — LOGIN-SEITE / AUSGEWÄHLTE SPORTART
// Вторая страница: выбранный спорт или администрация
// =========================================================

let selectedLoginContext = null;

const STARTSEITE_ICON_FILES = {
  judo: '1_Judo.png',
  jiujitsu: '1_Jiujitsu.png',
  taekwondo: '1_Taekwondo.png',
  boxen: '1_boxen.png',
  kickboxen: '1_kickboxen.png',
  muaythai: '1_Muay_Thai.png',
  taichi: '1_taichi.png',
  verwaltung: '1_vereinsverwaltung.png'
};

function showLoginScreenForContext(context){

  selectedLoginContext = context;

  document.getElementById('sportStartScreen')?.classList.add('hidden');

  const appBox = document.getElementById('appBox');
  if(appBox){
    appBox.classList.remove('hidden');
    appBox.classList.add('st2-login-mode');
  }

  document.getElementById('loginScreen')?.classList.remove('hidden');
  document.getElementById('mainScreen')?.classList.add('hidden');
  document.getElementById('topNavButtons')?.classList.add('hidden');

  const clubLogo = document.getElementById('st2ClubLogo');
  if(clubLogo){
    clubLogo.src = getClubLogoUrl();
  }

  const sportIcon = document.getElementById('st2SportIcon');
  if(sportIcon){
    sportIcon.src = STARTSEITE_URL + context.iconFile;
  }

  const sportName = document.getElementById('st2SportName');
  if(sportName){
    sportName.textContent = context.displayName;
  }

  const title = document.getElementById('st2LoginTitle');
  if(title){
    title.textContent = context.type === 'verwaltung'
      ? 'Bitte wählen Sie Ihren Zugang'
      : 'Bitte wählen Sie Ihren Trainer';
  }

  const pin = document.getElementById('pinInput');
  if(pin){
    pin.value = '';
    pin.type = 'password';
  }

  const status = document.getElementById('loginStatus');
  if(status){
    status.textContent = '';
  }
}

function backToSportStartFromLogin(){

  selectedLoginContext = null;

  const appBox = document.getElementById('appBox');
  if(appBox){
    appBox.classList.add('hidden');
    appBox.classList.remove('st2-login-mode');
  }

  document.getElementById('loginScreen')?.classList.add('hidden');
  document.getElementById('sportStartScreen')?.classList.remove('hidden');
}

function togglePinVisibility(){

  const input = document.getElementById('pinInput');

  if(!input)return;

  input.type = input.type === 'password'
    ? 'text'
    : 'password';
}

window.onload = async function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('superadmin') === '1') {
    isSAStandaloneMode = true;
    document.body.classList.add('sa-standalone-mode');
    document.getElementById('saStandalonePage')?.classList.remove('hidden');
    setTimeout(() => document.getElementById('saStandaloneUsername')?.focus(), 100);
    return;
  }
  await loadCurrentClubSettings();
  showSportStartScreen();
};

function showSportStartScreen() {
  document.getElementById('sportStartScreen')?.classList.remove('hidden');
  document.getElementById('appBox')?.classList.add('hidden');

  const logo = document.getElementById('clubRoundLogo');
  if (logo) {
    logo.src = getClubLogoUrl();
  }

  loadSportStartCards();
}

async function loadSportStartCards() {
  const grid = document.getElementById('sportStartGrid');
  if (!grid) return;

  grid.innerHTML = '';

  const { data, error } = await db
    .from('sports')
    .select('sport_id, name, icon_file, aktiv, sort_order')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }

  const sports = data || [];

  if (sports.length > 7) {
    grid.classList.add('has-many-sports');
  } else {
    grid.classList.remove('has-many-sports');
  }

  sports.forEach(sport => {
    const imgUrl = getSportImageUrl(sport);

if (!imgUrl) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sport-card-button';

    btn.onclick = function () {
      openSportLoginFromStart(sport);
    };

    btn.innerHTML = `
      <img
        class="sport-card-image"
        src="${imgUrl}"
        alt="${sport.name}">
    `;

    grid.appendChild(btn);
  });

  addVereinsverwaltungCard(grid);
}

function addVereinsverwaltungCard(grid) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sport-card-button';

  btn.onclick = function () {
    openAdministrationLoginFromStart();
  };

  btn.innerHTML = `
    <img
      class="sport-card-image"
      src="${STARTSEITE_URL}1_vereinsverwaltung.png"
      alt="Vereinsverwaltung">
  `;

  grid.appendChild(btn);
}

// =========================================================
// ST1 → ST2 / SPORT-LOGIN ÜBER PROMO
// Переход со спорта на страницу логина через окно рекламы
// =========================================================

async function openSportLoginFromStart(sport) {

  await showPromoTransition(async () => {

    const iconFile =
      STARTSEITE_ICON_FILES[sport.sport_id] ||
      STARTSEITE_ICON_FILES.judo;

    showLoginScreenForContext({
      type: 'sport',
      sportId: sport.sport_id,
      displayName: sport.name,
      iconFile: iconFile
    });

    await loadTrainerLoginList();

  });
}

// =========================================================
// ST1 → ST2 / VERWALTUNG-LOGIN ÜBER PROMO
// Переход в администрацию через окно рекламы
// =========================================================

async function openAdministrationLoginFromStart() {

  await showPromoTransition(async () => {

    showLoginScreenForContext({
      type: 'verwaltung',
      sportId: null,
      displayName: 'Vereinsverwaltung',
      iconFile: STARTSEITE_ICON_FILES.verwaltung
    });

    await loadTrainerLoginList();

  });
}

// =========================================================
// ST2 — TRAINERLISTE NACH SPORT / VERWALTUNG
// Выпадающий список: тренеры по спорту или администрация
// =========================================================

async function loadTrainerLoginList() {

  const status = document.getElementById('loginStatus');
  const select = document.getElementById('trainerSelect');

  if(!select)return;

  if(status){
    status.textContent = 'Zugänge werden geladen...';
  }

  const { data, error } = await db
    .from('trainers')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('name', { ascending: true });

  if(error){
    console.error(error);

    if(status){
      status.textContent = 'Fehler beim Laden: ' + error.message;
    }

    return;
  }

  let users = data || [];

  if(selectedLoginContext && selectedLoginContext.type === 'sport'){

    users = users.filter(user => {

      const role =
        String(user.rolle || '').toLowerCase();

      const userSports =
        String(user.sport_id || '')
        .split(/[;,]/)
        .map(x => x.trim())
        .filter(Boolean);

      return (
        role === 'trainer' &&
        userSports.includes(selectedLoginContext.sportId)
      );

    });

  }

  if(selectedLoginContext && selectedLoginContext.type === 'verwaltung'){

    users = users.filter(user => {

      const role =
        String(user.rolle || '').toLowerCase();

      return (
        role === 'admin' ||
        role === 'buchhaltung'
      );

    });

  }

  allTrainers = users;

  select.innerHTML = '<option value="">Bitte auswählen</option>';

  users.forEach(function(user){

    const option = document.createElement('option');

    option.value = user.trainer_id;
    option.textContent =
      (user.name || '-') + ' (' + (user.rolle || '-') + ')';

    select.appendChild(option);

  });

  if(status){

    if(users.length === 0){
      status.textContent = 'Keine passenden Zugänge gefunden.';
    }else{
      status.textContent = 'Bitte auswählen.';
    }

  }
}

async function login() {
  const trainerId = document.getElementById('trainerSelect').value;
  const pin = document.getElementById('pinInput').value;
  const status = document.getElementById('loginStatus');

  if (!trainerId) {
    status.textContent = 'Bitte Trainer auswählen.';
    return;
  }

  if (!isSuperAdminAccess) {
    const _blockReason = await getClubAccessBlockFresh();
    if (_blockReason) {
      showCustomMessage(_blockReason);
      return;
    }
  }

  // Im Super Admin Impersonation Mode PIN-Prüfung überspringen
  if (isSuperAdminAccess) {
    status.textContent = 'SA-Zugriff wird geprüft...';
    const { data: saData, error: saErr } = await db
      .from('trainers')
      .select('*')
      .eq('trainer_id', trainerId)
      .eq('club_id', currentClub.club_id)
      .maybeSingle();
    if (saErr || !saData) {
      status.textContent = 'Trainer nicht gefunden.';
      return;
    }
    // Direkt einloggen ohne PIN
    var data = saData;
    var error = null;
  } else {
    if (!pin) {
      status.textContent = 'Bitte PIN eingeben.';
      return;
    }
    status.textContent = 'Login wird geprüft...';
    var { data, error } = await db
      .from('trainers')
      .select('*')
      .eq('trainer_id', trainerId)
      .eq('pin', pin)
      .eq('club_id', currentClub.club_id)
      .maybeSingle();
    if (error || !data) {
      if (error) console.error(error);
      status.textContent = 'Falsche PIN oder Trainer nicht gefunden.';
      return;
    }
  }

  currentTrainer = data;
  currentTrainer.role = data.rolle;
  currentTrainer.trainerId = data.trainer_id;

  await loadCurrentPromoSettings();

  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainScreen').classList.remove('hidden');
  document.getElementById('topNavButtons').classList.remove('hidden');
  document.getElementById('appBox')?.classList.remove('st2-login-mode');

  document
.querySelector('.login-screen-st2')
?.classList.add('hidden');

  updateClubPaymentWarning();

  document.getElementById('welcome').textContent =
    'Willkommen, ' + (data.name || '-') + ' (' + (data.rolle || '-') + ')';

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Gruppe: -';

  if (data.rolle === 'Admin') {
    document.getElementById('adminScreen').classList.remove('hidden');
  }

 if (data.rolle === 'Buchhaltung') {
    currentView = 'buchhaltung';

    document.getElementById('buchhaltungScreen').classList.remove('hidden');
    document.getElementById('currentGroupInfo').textContent =
      'Aktuelle Rolle: Buchhaltung';

    await loadBuchhaltungData();
  }

  if (data.rolle === 'Trainer') {
  document.getElementById('groupScreen').classList.remove('hidden');
  await loadGroups();
  const _loginSportId = String(currentTrainer?.sport_id || selectedLoginContext?.sportId || '')
    .split(/[;,]/)[0].trim();
  applyTrainerFilterSportCfg(_loginSportId);
  applyWeightButtonVisibility(_loginSportId);
}
await updateTopSponsorLogos();
  status.textContent = '';
}

// =========================================================
// LOGOUT → ST1 STARTSEITE
// Выход возвращает на первую страницу выбора спорта
// =========================================================

function goHome() {

currentTrainer = null;
selectedLoginContext = null;

hideAllWorkScreens();

document
.getElementById('mainScreen')
?.classList.add('hidden');

document
.getElementById('loginScreen')
?.classList.add('hidden');

document
.getElementById('topNavButtons')
?.classList.add('hidden');

document
.getElementById('appBox')
?.classList.add('hidden');

document
.getElementById('appBox')
?.classList.remove('st2-login-mode');

const pinInput =
document.getElementById('pinInput');

if(pinInput){
pinInput.value = '';
pinInput.type = 'password';
}

const loginStatus =
document.getElementById('loginStatus');

if(loginStatus){
loginStatus.textContent = '';
}

showSportStartScreen();

}

function goRoleHome() {
  if (!currentTrainer) {
    goHome();
    return;
  }

  hideAllWorkScreens();

  updateTopSponsorLogos();

  document.getElementById('mainScreen').classList.remove('hidden');

  if (currentTrainer.role === 'Admin') {
    document.getElementById('adminScreen').classList.remove('hidden');
    document.getElementById('currentGroupInfo').textContent = 'Aktuelle Gruppe: -';
    return;
  }

  if (currentTrainer.role === 'Buchhaltung') {
    currentView = 'buchhaltung';

    document.getElementById('buchhaltungScreen').classList.remove('hidden');
    document.getElementById('currentGroupInfo').textContent =
      'Aktuelle Rolle: Buchhaltung';

    loadBuchhaltungData();

    return;
  }

  if (currentTrainer.role === 'Trainer') {
    document.getElementById('groupScreen').classList.remove('hidden');
    document.getElementById('currentGroupInfo').textContent = 'Aktuelle Gruppe: -';
    const _roleHomeSportId = String(currentTrainer?.sport_id || selectedLoginContext?.sportId || '')
      .split(/[;,]/)[0].trim();
    applyTrainerFilterSportCfg(_roleHomeSportId);
    applyWeightButtonVisibility(_roleHomeSportId);
    return;
  }
}


 function goBack() {

if (currentView === 'orphanStudents') {

  showPromoTransition(async () => {

    hideAllWorkScreens();

    document
      .getElementById('adminStudentScreen')
      .classList.remove('hidden');

    currentView = 'adminStudents';

    document.getElementById('currentGroupInfo').textContent =
      'Aktuelle Seite: Schülerliste';

    await loadAdminStudentCount();
    await applyAdminStudentFilter();

  });

  return;
}

if (
  currentView === 'addTrainer' &&
  previousView === 'adminBuchhaltung'
) {

  hideAllWorkScreens();

  currentView = 'adminBuchhaltung';

  document
    .getElementById('adminBuchhaltungScreen')
    .classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Administrator / Buchhaltung';

  loadAdminBuchhaltungUsers();

  return;
}

  if (
  currentView === 'editTrainer' &&
  previousView === 'adminBuchhaltung'
) {

  hideAllWorkScreens();

  currentView = 'adminBuchhaltung';

  document
    .getElementById('adminBuchhaltungScreen')
    .classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Administrator / Buchhaltung';

  loadAdminBuchhaltungUsers();

  return;
}
  if (
    currentView === 'trainerAdmin' &&
    previousView === 'adminScreen'
  ) {
    previousView = null;
    currentView = null;

    showPromoTransition(() => {
      goRoleHome();
    });

    return;
  }

  if (
    currentView === 'adminStatistikCenter' &&
    previousView === 'clubStatistik'
  ) {
    previousView = null;
    currentView = 'clubStatistik';

    showPromoTransition(async () => {
      await showClubStatistikScreen();
    });

    return;
  }

  if (
  currentView === 'clubStudentStats' &&
  previousView === 'clubStatistik'
) {
  previousView = null;
  currentView = 'clubStatistik';

  showPromoTransition(async () => {
    await showClubStatistikScreen();
  });

  return;
}

    if (
    currentView === 'groupOverview' &&
    previousView === 'clubStatistik'
  ) {
    previousView = null;
    currentView = 'clubStatistik';

    showPromoTransition(async () => {
      await showClubStatistikScreen();
    });

    return;
  }
    if (
    currentView === 'trainerAdminFromClub' &&
    previousView === 'clubStatistik'
  ) {
    previousView = null;
    currentView = 'clubStatistik';

    showPromoTransition(async () => {
      await showClubStatistikScreen();
    });

    return;
  }
  // ── ZEITRAUM STATISTIK → Club Statistik ──
  if (
    currentView === 'zeitraumStatistik' &&
    previousView === 'clubStatistik'
  ) {
    previousView = null;
    currentView = 'clubStatistik';
    showPromoTransition(async () => {
      await showClubStatistikScreen();
    });
    return;
  }

  if(currentView==='trainerAdmin' || currentView==='trainerAdminFromClub'){

   if(previousView==='clubStatistik'){

      showPromoTransition(()=>{
         showClubStatistikScreen();
      });

      return;
   }

}

  if(previousScreenBeforeEditStudent){

hideAllWorkScreens();

const screen =
document.getElementById(
previousScreenBeforeEditStudent
);

if(screen){
screen.classList.remove('hidden');
}

previousScreenBeforeEditStudent=null;
return;

}

    const weightScreen = document.getElementById('weightScreen');

  if (
    weightScreen &&
    !weightScreen.classList.contains('hidden') &&
    previousScreenBeforeWeight
  ) {
    hideAllWorkScreens();

    const screen = document.getElementById(previousScreenBeforeWeight);

    if (screen) {
      screen.classList.remove('hidden');
    }

    previousScreenBeforeWeight = null;
    return;
  }

  if(previousScreenBeforeStats){
    hideAllWorkScreens();

    const screen = document.getElementById(previousScreenBeforeStats);

    if(screen){
      screen.classList.remove('hidden');
    }

    previousScreenBeforeStats = null;
    return;
  }

  goRoleHome();
}

function getClubLogoUrl() {
  if (currentClub && currentClub.logo_url) return currentClub.logo_url;
  return FALLBACK_CLUB.logo_url;
}

function cancelStudentEditForm(){

if(previousScreenBeforeEditStudent){

hideAllWorkScreens();

const screen =
document.getElementById(previousScreenBeforeEditStudent);

if(screen){
screen.classList.remove('hidden');
}

previousScreenBeforeEditStudent = null;

return;
}

goBack();

}

async function getActiveTrainerNamesForStudent(student, externalTrainersMap) {

  if (!student) return '-';

  const groupIds =
    String(student.gruppe_id || '')
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);

  if (groupIds.length === 0) {
    return '-';
  }

  const { data: links, error: linksError } = await db
    .from('trainer_groups')
    .select('trainer_id, trainer_name, gruppe_id')
    .in('gruppe_id', groupIds)
    .eq('club_id', currentClub.club_id);

  if (linksError || !links || links.length === 0) {
    return '-';
  }

  const trainerIds =
    [...new Set(
      links
        .map(row => row.trainer_id)
        .filter(Boolean)
    )];

  if (trainerIds.length === 0) {
    return '-';
  }

  let activeNames;

  if (externalTrainersMap) {
    activeNames = trainerIds
      .map(id => externalTrainersMap[id])
      .filter(Boolean);
  } else {
    const { data: trainers, error: trainersError } = await db
      .from('trainers')
      .select('trainer_id, name, aktiv')
      .in('trainer_id', trainerIds)
      .eq('aktiv', 'JA')
      .eq('club_id', currentClub.club_id);

    if (trainersError || !trainers || trainers.length === 0) {
      return '-';
    }

    activeNames = trainers.map(t => t.name).filter(Boolean);
  }

  return [...new Set(activeNames)].join(', ') || '-';
}

async function getStudentsWithoutGroupOrTrainer() {

  const { data: students, error: studentsError } = await db
    .from('students')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id);

  if (studentsError) {
    console.error(studentsError);
    return [];
  }

  const { data: groups, error: groupsError } = await db
    .from('groups')
    .select('gruppe_id, gruppenname, aktiv')
    .eq('club_id', currentClub.club_id);

  if (groupsError) {
    console.error(groupsError);
    return [];
  }

  const activeGroupIds =
    (groups || [])
      .filter(group => String(group.aktiv || '').toUpperCase() === 'JA')
      .map(group => String(group.gruppe_id || '').trim());

  const { data: trainerGroups, error: trainerGroupsError } = await db
    .from('trainer_groups')
    .select('trainer_id, trainer_name, gruppe_id')
    .eq('club_id', currentClub.club_id);

  if (trainerGroupsError) {
    console.error(trainerGroupsError);
    return [];
  }

  const trainerIds =
    [...new Set(
      (trainerGroups || [])
        .map(row => row.trainer_id)
        .filter(Boolean)
    )];

  const { data: trainers, error: trainersError } = await db
    .from('trainers')
    .select('trainer_id, name, aktiv')
    .in('trainer_id', trainerIds);

  if (trainersError) {
    console.error(trainersError);
    return [];
  }

  const activeTrainerIds =
    (trainers || [])
      .filter(trainer => String(trainer.aktiv || '').toUpperCase() === 'JA')
      .map(trainer => String(trainer.trainer_id || '').trim());

  const activeTrainerGroupIds =
    [...new Set(
      (trainerGroups || [])
        .filter(row =>
          activeTrainerIds.includes(String(row.trainer_id || '').trim())
        )
        .map(row => String(row.gruppe_id || '').trim())
        .filter(Boolean)
    )];

  const orphanStudents =
    (students || []).filter(student => {

      const groupIds =
        String(student.gruppe_id || '')
          .split(/[;,]/)
          .map(x => x.trim())
          .filter(Boolean);

      if (groupIds.length === 0) {
        return true;
      }

      const hasActiveGroup =
        groupIds.some(groupId =>
          activeGroupIds.includes(groupId)
        );

      if (!hasActiveGroup) {
        return true;
      }

      const hasGroupWithActiveTrainer =
        groupIds.some(groupId =>
          activeGroupIds.includes(groupId) &&
          activeTrainerGroupIds.includes(groupId)
        );

      if (!hasGroupWithActiveTrainer) {
        return true;
      }

      return false;
    });

  return orphanStudents;
}

async function loadGroups() {
  const groupSelect = document.getElementById('groupSelect');
  const counterBox = document.getElementById('studentCounterBox');
  const logoImg = document.getElementById('trainerHomeClubLogo');

if (logoImg) {
  logoImg.src = getClubLogoUrl();
}

  if (!groupSelect || !currentTrainer) return;

  groupSelect.innerHTML = '<option value="">Gruppen werden geladen...</option>';

  let groups = [];

  if (currentTrainer.role === 'Admin') {
    const { data, error } = await db
      .from('groups')
      .select('*')
      .eq('aktiv', 'JA')
      .eq('club_id', currentClub.club_id)
      .order('gruppenname', { ascending: true });

    if (error) {
      groupSelect.innerHTML = '<option value="">Fehler beim Laden</option>';
      console.error(error);
      return;
    }

    groups = data || [];
  } else {
    const { data, error } = await db
      .from('trainer_groups')
      .select('*')
      .eq('trainer_id', currentTrainer.trainerId)
      .eq('club_id', currentClub.club_id)
      .order('gruppenname', { ascending: true });

    if (error) {
      groupSelect.innerHTML = '<option value="">Fehler beim Laden</option>';
      console.error(error);
      return;
    }

    groups = data || [];
  }

  groupSelect.innerHTML = '<option value="">Bitte Gruppe auswählen</option>';

  groups.forEach(function(group) {
    const option = document.createElement('option');

    option.value = group.gruppe_id;
    option.textContent = group.gruppenname || group.gruppe_id;

    groupSelect.appendChild(option);
  });

  await loadStudents();
await loadGroupStatKyuObiOptions();
await applyGroupFilter();
}

function updateCurrentGroupInfo() {
  const groupSelect = document.getElementById('groupSelect');
  const infoBox = document.getElementById('currentGroupInfo');

  if (!groupSelect || !infoBox) return;

  const selectedText =
    groupSelect.options[groupSelect.selectedIndex]?.textContent || '-';

  if (!groupSelect.value) {
    infoBox.textContent = 'Aktuelle Gruppe: -';
    return;
  }

  infoBox.textContent = 'Aktuelle Gruppe: ' + selectedText;
}

async function loadStudents() {

  updateCurrentGroupInfo();

  const counterBox =
  document.getElementById(
    'studentCounterBox'
  );

  const groupSelect =
  document.getElementById(
    'groupSelect'
  );

  if (!counterBox || !groupSelect) return;

  const groupId =
  groupSelect.value || '';

  const { data, error } = await db
    .from('students')
    .select('*')
    .eq('aktiv','JA')
    .eq('club_id', currentClub.club_id);

  if(error){

    console.error(error);

    counterBox.textContent =
    '👥 Gesamt Schüler: 0';

    return;
  }

  let students = data || [];

  // если группа не выбрана —
  // считаем всех учеников тренера

  if(!groupId){

    if(
      currentTrainer &&
      currentTrainer.role==='Trainer'
    ){

      const { data: trainerGroups } =
      await db
      .from('trainer_groups')
      .select('gruppe_id')
      .eq(
        'trainer_id',
        currentTrainer.trainerId
      )
      .eq('club_id', currentClub.club_id);

      const allowedIds =
      (trainerGroups||[])
      .map(x=>x.gruppe_id);

      students =
      students.filter(student=>{

        const ids =
        String(
          student.gruppe_id||''
        )
        .split(/[;,]/)
        .map(x=>x.trim())
        .filter(Boolean);

        return ids.some(
          id=>allowedIds.includes(id)
        );

      });

    }

  } else {

    students =
    students.filter(student=>{

      const ids =
      String(student.gruppe_id||'')
      .split(/[;,]/)
      .map(x=>x.trim())
      .filter(Boolean);

      return ids.includes(groupId);

    });

  }

  counterBox.textContent =
  '👥 Gesamt Schüler: ' +
  students.length;

  // Wiegung-Button bei Gruppenwechsel aktualisieren
  if (groupId && students.length > 0) {
    const groupSport = students.find(s => s.sport_id)?.sport_id || null;
    applyWeightButtonVisibility(groupSport);
  } else {
    const defaultSport = String(currentTrainer?.sport_id || selectedLoginContext?.sportId || '')
      .split(/[;,]/)[0].trim();
    applyWeightButtonVisibility(defaultSport);
  }

}

async function applyGroupFilter() {

  const resultBox = document.getElementById('groupStudentStatsResult');
  const groupSelect = document.getElementById('groupSelect');

  if (!resultBox || !groupSelect || !currentTrainer) return;

  resultBox.innerHTML = 'Filter wird geladen...';

  const selectedGroupId = groupSelect.value || '';

  const { data: trainerGroups, error: groupError } = await db
    .from('trainer_groups')
    .select('gruppe_id')
    .eq('trainer_id', currentTrainer.trainerId)
    .eq('club_id', currentClub.club_id);

  if (groupError) {
    console.error(groupError);
    resultBox.innerHTML = 'Fehler beim Laden der Trainergruppen.';
    return;
  }

  const allowedGroupIds = (trainerGroups || [])
    .map(row => row.gruppe_id)
    .filter(Boolean);

  const students = await getTrainerStudentsForStatFilter();

  const filtered = filterStudentsUniversal(students, {
    name: document.getElementById('groupStatName')?.value || '',
    ageFrom: document.getElementById('groupStatAgeFrom')?.value || '',
    ageTo: document.getElementById('groupStatAgeTo')?.value || '',
    kyuFrom: document.getElementById('groupStatKyuFrom')?.value || '',
    kyuTo: document.getElementById('groupStatKyuTo')?.value || '',
    obiFrom: document.getElementById('groupStatObiFrom')?.value || '',
    obiTo: document.getElementById('groupStatObiTo')?.value || '',
    groupId: selectedGroupId,
    allowedGroupIds: selectedGroupId ? [] : allowedGroupIds
  });

  if (filtered.length === 0) {
    resultBox.innerHTML = `
      <div class="trainer-empty-card">
        <div class="trainer-empty-icon">📋</div>
        Keine Schüler gefunden.
      </div>
    `;
    return;
  }

 await renderStudentTableUniversal(filtered, {
  containerId: 'groupStudentStatsResult',
  showCheckbox: false,
  showGroup: true,
  showComment: false
});
}

async function resetGroupStudentStatsFilter() {

  await resetFiltersUniversal({
    fields: [
      'groupStatName',
      'groupStatAgeFrom',
      'groupStatAgeTo',
      'groupStatKyuFrom',
      'groupStatKyuTo',
      'groupStatObiFrom',
      'groupStatObiTo'
    ],

    suggestionsId: 'groupStudentNameSuggestions',

    beforeCallback: loadGroupStatKyuObiOptions,

    callback: applyGroupFilter
  });
}

function filterStudentsUniversal(list, filters) {

  return (list || []).filter(student => {

    const name = String(filters.name || '').trim().toLowerCase();

    const fullName = (
      (student.vorname || '') + ' ' +
      (student.nachname || '') + ' ' +
      (student.nachname || '') + ' ' +
      (student.vorname || '')
    ).toLowerCase();

    if (name && !fullName.includes(name)) {
      return false;
    }

    const age = Number(student.alter || 0);

    if (filters.ageFrom && age < Number(filters.ageFrom)) return false;
    if (filters.ageTo && age > Number(filters.ageTo)) return false;

    const studentGroups = String(student.gruppe_id || '')
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);

    if (filters.groupId) {
      if (!studentGroups.includes(filters.groupId)) return false;
    }

    if (
      filters.allowedGroupIds &&
      filters.allowedGroupIds.length > 0
    ) {
      const ok = studentGroups.some(id =>
        filters.allowedGroupIds.includes(id)
      );

      if (!ok) return false;
    }

    if (
      filters.kyuFrom &&
      String(student.kyu_grad || '') !== String(filters.kyuFrom)
    ) {
      return false;
    }

    if (
      filters.kyuTo &&
      String(student.kyu_grad || '') !== String(filters.kyuTo)
    ) {
      return false;
    }

    if (
      filters.obiFrom &&
      String(student.guertelfarbe || '') !== String(filters.obiFrom)
    ) {
      return false;
    }

    if (
      filters.obiTo &&
      String(student.guertelfarbe || '') !== String(filters.obiTo)
    ) {
      return false;
    }

    if (
      filters.geschlecht &&
      String(student.geschlecht || 'Keine Angabe') !== String(filters.geschlecht)
    ) {
      return false;
    }

    return true;
  });
}

async function resetFiltersUniversal(config) {

  (config.fields || []).forEach(function(id) {

    const el = document.getElementById(id);

    if (!el) return;

    el.value = '';
  });

  if (config.suggestionsId) {
    const suggestions =
      document.getElementById(config.suggestionsId);

    if (suggestions) {
      suggestions.innerHTML = '';
    }
  }

  if (typeof config.beforeCallback === 'function') {
    await config.beforeCallback();
  }

  if (typeof config.callback === 'function') {
    await config.callback();
  }
}

async function getTrainerStudentsForStatFilter() {

  const { data: students, error } = await db
    .from('students')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id);

  if (error) {
    console.error(error);
    return [];
  }

  const selectedGroupId =
    document.getElementById('groupSelect')?.value || '';

  // Если группа выбрана — брать студентов этой группы напрямую,
  // не требуя записи в trainer_groups
  if (selectedGroupId) {
    return (students || []).filter(student => {
      const ids = String(student.gruppe_id || '')
        .split(/[;,]/)
        .map(x => x.trim())
        .filter(Boolean);
      return ids.includes(selectedGroupId);
    });
  }

  // Группа не выбрана — старая логика через trainer_groups
  const { data: trainerGroups, error: groupError } = await db
    .from('trainer_groups')
    .select('gruppe_id')
    .eq('trainer_id', currentTrainer.trainerId)
    .eq('club_id', currentClub.club_id);

  if (groupError) {
    console.error(groupError);
    return [];
  }

  const allowedGroupIds = (trainerGroups || [])
    .map(row => row.gruppe_id)
    .filter(Boolean);

  return (students || []).filter(student => {

    const ids = String(student.gruppe_id || '')
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);

    return ids.some(id => allowedGroupIds.includes(id));
  });
}

async function loadGroupStatKyuObiOptions() {

  const kyuFrom = document.getElementById('groupStatKyuFrom');
  const kyuTo = document.getElementById('groupStatKyuTo');
  const obiFrom = document.getElementById('groupStatObiFrom');
  const obiTo = document.getElementById('groupStatObiTo');

  if (!kyuFrom || !kyuTo || !obiFrom || !obiTo || !currentTrainer) return;

  const students = await getTrainerStudentsForStatFilter();

  await ensureKyuObiLookup();

  const sportId = String(currentTrainer?.sport_id || selectedLoginContext?.sportId || '')
    .split(/[;,]/)[0].trim();
  const lookup = getRankBeltLookup(sportId);

  const usedKyu = new Set(
    students
      .map(s => String(s.kyu_grad || '').trim())
      .filter(Boolean)
  );

  const usedObi = new Set(
    students
      .map(s => String(s.guertelfarbe || '').trim())
      .filter(Boolean)
  );

  const rows = lookup.filter(row => {
    return (
      usedKyu.has(String(row.kyu_grad || '').trim()) ||
      usedObi.has(String(row.guertelfarbe || '').trim())
    );
  });

  const kyuOptions = ['<option value="">Alle</option>'];
  const obiOptions = ['<option value="">Alle</option>'];

  rows.forEach(row => {

    kyuOptions.push(`
      <option value="${row.kyu_grad}">
        ${row.kyu_grad}
      </option>
    `);

    obiOptions.push(`
      <option value="${row.guertelfarbe}">
        ${row.guertelfarbe}
      </option>
    `);
  });

  kyuFrom.innerHTML = kyuOptions.join('');
  kyuTo.innerHTML = kyuOptions.join('');
  obiFrom.innerHTML = obiOptions.join('');
  obiTo.innerHTML = obiOptions.join('');
}

function syncGroupStatObiFromKyu(mode) {

  const kyuId = mode === 'from'
    ? 'groupStatKyuFrom'
    : 'groupStatKyuTo';

  const obiId = mode === 'from'
    ? 'groupStatObiFrom'
    : 'groupStatObiTo';

  const kyu = document.getElementById(kyuId)?.value;
  const obiSelect = document.getElementById(obiId);

  if (!obiSelect) return;

  if (!kyu) {
    obiSelect.value = '';
    return;
  }

  const syncLookup = getRankBeltLookup(
    String(currentTrainer?.sport_id || selectedLoginContext?.sportId || '').split(/[;,]/)[0].trim()
  );
  const row = syncLookup.find(r => r.kyu_grad === kyu);

  if (row) {
    obiSelect.value = row.guertelfarbe;
  }
}

function syncGroupStatKyuFromObi(mode) {

  const obiId = mode === 'from'
    ? 'groupStatObiFrom'
    : 'groupStatObiTo';

  const kyuId = mode === 'from'
    ? 'groupStatKyuFrom'
    : 'groupStatKyuTo';

  const obi = document.getElementById(obiId)?.value;
  const kyuSelect = document.getElementById(kyuId);

  if (!kyuSelect) return;

  if (!obi) {
    kyuSelect.value = '';
    return;
  }

  const syncLookup = getRankBeltLookup(
    String(currentTrainer?.sport_id || selectedLoginContext?.sportId || '').split(/[;,]/)[0].trim()
  );
  const row = syncLookup.find(r => r.guertelfarbe === obi);

  if (row) {
    kyuSelect.value = row.kyu_grad;
  }
}

async function showGroupStudentNameSuggestions() {

  const input = document.getElementById('groupStatName');
  const box = document.getElementById('groupStudentNameSuggestions');
  const groupSelect = document.getElementById('groupSelect');

  if (!input || !box || !groupSelect || !currentTrainer) return;

  const query = input.value.trim().toLowerCase();

  if (query.length < 1) {
    box.innerHTML = '';
    return;
  }

  const selectedGroupId = groupSelect.value || '';

  const { data: students, error } = await db
    .from('students')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('nachname', { ascending: true });

  if (error) {
    console.error(error);
    box.innerHTML = '';
    return;
  }

  let allowedGroupIds = [];

  if (selectedGroupId) {

    allowedGroupIds = [selectedGroupId];

  } else {

    const { data: trainerGroups, error: groupError } = await db
      .from('trainer_groups')
      .select('gruppe_id')
      .eq('trainer_id', currentTrainer.trainerId)
      .eq('club_id', currentClub.club_id);

    if (groupError) {
      console.error(groupError);
      box.innerHTML = '';
      return;
    }

    allowedGroupIds = (trainerGroups || [])
      .map(row => row.gruppe_id)
      .filter(Boolean);
  }

  const filtered = (students || []).filter(student => {

    const studentGroups = String(student.gruppe_id || '')
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);

    const belongsToTrainerGroup =
      studentGroups.some(id => allowedGroupIds.includes(id));

    if (!belongsToTrainerGroup) return false;

    const fullName = (
      (student.vorname || '') + ' ' +
      (student.nachname || '') + ' ' +
      (student.nachname || '') + ' ' +
      (student.vorname || '')
    ).toLowerCase();

    return fullName.includes(query);
  });

  if (filtered.length === 0) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = filtered.slice(0, 8).map(student => {

    const name =
      (student.nachname || '') + ' ' + (student.vorname || '');

    return `
      <div
        class="suggestion-item"
        onclick="selectGroupStudentSuggestion('${name.replace(/'/g, "\\'")}')"
      >
        ${name}
      </div>
    `;

  }).join('');
}

function selectGroupStudentSuggestion(name) {

  const input = document.getElementById('groupStatName');
  const box = document.getElementById('groupStudentNameSuggestions');

  if (input) {
    input.value = name;
  }

  if (box) {
    box.innerHTML = '';
      }
}

async function renderStudentTableUniversal(students, options = {}) {

  const container =
    document.getElementById(options.containerId);

  if (!container) return;

  const showCheckbox = options.showCheckbox === true;
  const showGroup = options.showGroup === true;
  const showComment = options.showComment === true;

  if (!students || students.length === 0) {
    container.innerHTML = `
      <div class="trainer-empty-card">
        <div class="trainer-empty-icon">📋</div>
        Keine Schüler gefunden.
      </div>
    `;
    return;
  }

  const { data: allTrainers } = await db
    .from('trainers')
    .select('trainer_id, name')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id);

  const trainersMap = {};
  (allTrainers || []).forEach(t => {
    if (t.trainer_id) trainersMap[t.trainer_id] = t.name;
  });

  const fullStudents = await Promise.all(
  students.map(async student => {

    const fullStudent =
      await getStudentFullData(getStudentId(student), null, student) || student;

    fullStudent.trainersText =
      await getActiveTrainerNamesForStudent(fullStudent, trainersMap);

    return fullStudent;

  })
);

  // ── Sport-Kontext ermitteln ──────────────────────────────────────────────
  const sportIdsInTable = [
    ...new Set(fullStudents.map(s => s.sport_id).filter(Boolean))
  ];
  const isSingleSport = sportIdsInTable.length === 1;
  const tableCfg = isSingleSport ? getSportConfig(sportIdsInTable[0]) : null;

  const anyShowGrad = sportIdsInTable.length === 0 ? true
    : isSingleSport ? tableCfg.showGraduation
    : sportIdsInTable.some(id => getSportConfig(id).showGraduation);

  const anyShowBelt = sportIdsInTable.length === 0 ? true
    : isSingleSport ? tableCfg.showBelt
    : sportIdsInTable.some(id => getSportConfig(id).showBelt);

  const anyShowWeight = sportIdsInTable.length === 0 ? true
    : isSingleSport ? tableCfg.showWeight
    : sportIdsInTable.some(id => getSportConfig(id).showWeight);

  const thGrad   = isSingleSport && tableCfg ? tableCfg.graduationLabel : 'Graduierung';
  const thBelt   = isSingleSport && tableCfg ? tableCfg.beltLabel       : 'Gürtelfarbe';
  const thWeight = 'Gewicht';

  function renderSportFieldCells(student) {
    const rowCfg = getSportConfig(student.sport_id);
    return `
      ${anyShowGrad   ? `<td>${rowCfg.showGraduation ? (student.kyu_grad || '-') : '-'}</td>` : ''}
      ${anyShowBelt   ? `<td>${rowCfg.showBelt       ? (student.guertelfarbe || '-') : '-'}</td>` : ''}
      ${anyShowWeight ? `<td>${rowCfg.showWeight     ? (student.aktuelles_gewicht ? student.aktuelles_gewicht + ' kg' : '-') : '-'}</td>` : ''}
    `;
  }
  // ────────────────────────────────────────────────────────────────────────

  let html = `
    <table class="attendance-table student-universal-table">
      <thead>
        <tr>
          ${showCheckbox ? '<th></th>' : ''}
          <th>Status<br>Vertrag</th>
          <th>Nachname</th>
          <th>Vorname</th>
          <th>Alter</th>
          ${anyShowGrad   ? `<th>${thGrad}</th>`   : ''}
          ${anyShowBelt   ? `<th>${thBelt}</th>`   : ''}
          ${anyShowWeight ? `<th>${thWeight}</th>` : ''}
          ${showGroup ? '<th>Gruppe</th>' : ''}
          <th>Trainer</th>
          <th>Rating</th>
          <th>Aktionen</th>
          ${showComment ? '<th>Kommentar</th>' : ''}
        </tr>
      </thead>
      <tbody>
  `;

  fullStudents.forEach(function(student, index) {

    const statusIcon = getStudentStatusIcon(student);
    const rowGenderClass = getGenderRowClass(student);

    html += `
      <tr class="${rowGenderClass}">

        ${showCheckbox ? `
          <td>
            <input
              type="checkbox"
              class="attendanceCheck"
              data-student-id="${getStudentId(student)}"
              data-vorname="${student.vorname || ''}"
              data-nachname="${student.nachname || ''}">
          </td>
        ` : ''}

        <td>${statusIcon} ${index + 1}</td>
        <td>${student.nachname || ''}</td>
        <td>${student.vorname || ''}</td>
        <td>${student.alter || '-'}</td>
        ${renderSportFieldCells(student)}

        ${showGroup ? `
          <td>${student.groupsHtml || student.groupsText || student.gruppe_id || '-'}</td>
        ` : ''}

        <td>${student.trainersText || student.trainer || '-'}</td>
        <td>
  <span class="rating-img-wrap">
    <img src="${BUTTONS_URL}Stud_Rating.png" alt="Rating">
    <span>${student.calculatedRating || student.rating || 0}</span>
  </span>
</td>

        <td>
          <div class="table-action-row">

  <button
    class="table-img-action-btn"
    onclick="editStudent('${getStudentId(student)}')"
    title="Schüler bearbeiten">
    <img src="${BUTTONS_URL}Stud_Edit.png" alt="Bearbeiten">
  </button>

  <button
    class="table-img-action-btn"
    onclick="toggleArchivePanel('${getStudentId(student)}')"
    title="Schüler löschen / archivieren">
    <img src="${BUTTONS_URL}Stud_Delete.png" alt="Löschen">
  </button>

  <button
    class="table-img-action-btn"
    onclick="showStudentStats('${getStudentId(student)}')"
    title="Statistik anzeigen">
    <img src="${BUTTONS_URL}Stud_Statistik.png" alt="Statistik">
  </button>

</div>
        </td>

        ${showComment ? `
          <td>
            <button class="comment-btn">Kommentar</button>
          </td>
        ` : ''}

      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

async function showSportManagementScreen(){

currentView='sportManagement';

hideAllWorkScreens();

document
.getElementById('sportManagementScreen')
.classList.remove('hidden');

document.getElementById(
'currentGroupInfo'
).textContent =
'Aktuelle Gruppe: Sportverwaltung';

await loadSportManagementList();

}

async function showSponsorManagementScreen(){

  currentView = 'sponsorManagement';

  hideAllWorkScreens();
  

  document
    .getElementById('sponsorManagementScreen')
    ?.classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Werbung / Sponsoren';

  await loadSponsorsCache();
  await loadCurrentPromoSettings();
  await loadSponsorLogos();
  await updateTopSponsorLogos();
  await loadPromoTransitionImages();
}

async function loadSponsorLogos(){

  const box =
    document.getElementById('sponsorLogoList');

  if(!box)return;

  await deactivateExpiredSponsors();
  await loadSponsorsCache();

  box.innerHTML = 'Sponsorenlogos werden geladen...';

  const {data,error}=await db.storage
    .from('promo_slides')
    .list(currentClub.club_id, { limit: 100 });

  if(error){
    console.error(error);
    box.innerHTML = 'Fehler beim Laden der Sponsorenlogos.';
    return;
  }

  const files =
    (data || []).filter(file =>
      /\.(png|jpg|jpeg|webp)$/i.test(file.name)
    );

  if(files.length === 0){
    box.innerHTML = `
      <div class="trainer-empty-card">
        <div class="trainer-empty-icon">📢</div>
        Keine Sponsorenlogos vorhanden.
      </div>
    `;
    return;
  }

  box.innerHTML = files.map(file => {

    const filePath = `${currentClub.club_id}/${file.name}`;
    const url =
      'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/promo_slides/' +
      filePath;

    const sp       = sponsorsCache[file.name] || {};
    const isActive = sp.aktiv === true;

    return `
     <div class="
  sponsor-logo-card
  ${isActive ? 'sponsor-active' : 'sponsor-inactive'}
">

        <img
          class="sponsor-logo-preview"
          src="${url}"
          alt="${file.name}"
        >

        <div class="sponsor-logo-info">
          <b>${file.name}</b>

          <label class="sponsor-active-line">
            <input
  type="checkbox"
  ${isActive ? 'checked' : ''}
  onchange="toggleSponsorActive('${file.name}', this)"
>
            Aktiv
          </label>

         <label>
  Aktiv von:
  <input
    type="date"
    id="sponsorDateFrom_${file.name}"
    value="${sp.aktiv_von || ''}"
    onchange="updateSponsorDateFrom('${file.name}', this.value)"
  >
</label>

<label>
  Aktiv bis:
  <input
    type="date"
    id="sponsorDateTo_${file.name}"
    value="${sp.aktiv_bis || ''}"
    onchange="updateSponsorDateTo('${file.name}', this.value)"
  >
</label>
        </div>

      </div>
    `;
  }).join('');

  await updateTopSponsorLogos();
}

async function loadPromoTransitionImages() {

  const box = document.getElementById('promoTransitionImageList');
  if (!box) return;

  box.innerHTML = 'Popup-Bilder werden geladen...';

  const [storageResult, dbResult] = await Promise.all([
    db.storage.from('promo-transition').list(currentClub.club_id, { limit: 100 }),
    db.from('promo_media')
      .select('file_name, aktiv')
      .eq('club_id', currentClub.club_id),
  ]);

  const { data, error } = storageResult;
  const dbMap = {};
  (dbResult.data || []).forEach(r => { dbMap[r.file_name] = r.aktiv; });

  if (error) {
    console.error(error);
    box.innerHTML = `
      <div class="trainer-empty-card">
        <div class="trainer-empty-icon">⚠️</div>
        Fehler beim Laden der Popup-Bilder.
      </div>
    `;
    return;
  }

  const files = (data || []).filter(file =>
    /\.(png|jpg|jpeg|webp)$/i.test(file.name)
  );

  if (files.length === 0) {
    box.innerHTML = `
      <div class="trainer-empty-card">
        <div class="trainer-empty-icon">🎬</div>
        Keine Popup-Bilder vorhanden.
      </div>
    `;
    return;
  }

  const PROMO_BASE =
    'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/promo-transition/';

  box.innerHTML = '<div class="popup-image-grid">' +
    files.map(file => {

    const filePath = `${currentClub.club_id}/${file.name}`;
    const url = PROMO_BASE + filePath.split('/').map(encodeURIComponent).join('/');

    const safeName = file.name
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const isActive = dbMap[file.name] === true;

    return `
      <div class="popup-image-card ${isActive ? 'popup-card-active' : 'popup-card-inactive'}">
        <img
          class="popup-image-preview"
          src="${url}"
          alt="${safeName}"
        >
        <div class="popup-image-name">${safeName}</div>
        <div class="popup-toggle-wrap">
          <label class="popup-toggle-switch">
            <input
              type="checkbox"
              ${isActive ? 'checked' : ''}
              data-filename="${safeName}"
              onchange="togglePopupImageActive(this)">
            <span class="popup-toggle-slider"></span>
          </label>
          <span>${isActive ? 'Aktiv' : 'Inaktiv'}</span>
        </div>
      </div>
    `;

  }).join('') + '</div>';

  promoActiveSlides = (dbResult.data || [])
    .filter(r => r.aktiv)
    .map(r => ({ file_name: r.file_name, file_path: `${currentClub.club_id}/${r.file_name}` }));

  loadPopupTransitionSettings(files.map(f => f.name));
}

async function uploadSponsorLogo(event){

  const file =
    event.target.files && event.target.files[0];

  if(!file){
    return;
  }

  const fileName =
    file.name
      .replace(/\s+/g, '_')
      .replace(/[^\w.\-]/g, '');

  const filePath = `${currentClub.club_id}/${fileName}`;

  const { error } = await db.storage
    .from('promo_slides')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true
    });

  if(error){
    console.error(error);
    showCustomMessage(
      'Fehler beim Hochladen: ' + error.message
    );
    return;
  }

  await db.from('sponsors').upsert({
    club_id:    currentClub.club_id,
    file_name:  fileName,
    file_path:  filePath,
    aktiv:      false,
    sort_order: 0,
  });

  event.target.value = '';

  await loadSponsorLogos();

  showCustomMessage(
    'Sponsorlogo wurde hochgeladen.'
  );
}

async function uploadPromoTransitionImage(event) {

  const file =
    event.target.files && event.target.files[0];

  if (!file) {
    return;
  }

  const fileName =
    file.name
      .replace(/\s+/g, '_')
      .replace(/[^\w.\-]/g, '');

  const filePath = `${currentClub.club_id}/${fileName}`;

  const { error } = await db.storage
    .from('promo-transition')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true
    });

  if (error) {
    console.error(error);
    event.target.value = '';
    showCustomMessage(
      'Fehler beim Hochladen: ' + error.message
    );
    return;
  }

  await db.from('promo_media').upsert({
    club_id:    currentClub.club_id,
    file_name:  fileName,
    file_path:  filePath,
    aktiv:      false,
    sort_order: 0,
  });

  event.target.value = '';

  await loadPromoTransitionImages();

  showCustomMessage(
    'Popup-Bild wurde hochgeladen.'
  );
}

async function togglePopupImageActive(checkbox) {
  const fileName = checkbox.dataset.filename || '';
  if (!fileName) return;

  await db
    .from('promo_media')
    .update({ aktiv: checkbox.checked })
    .eq('club_id', currentClub.club_id)
    .eq('file_name', fileName);

  if (checkbox.checked) {
    if (!promoActiveSlides.find(s => s.file_name === fileName)) {
      promoActiveSlides.push({
        file_name: fileName,
        file_path: `${currentClub.club_id}/${fileName}`,
      });
    }
  } else {
    promoActiveSlides = promoActiveSlides.filter(s => s.file_name !== fileName);
  }

  markPopupDirty();

  const card = checkbox.closest('.popup-image-card');
  if (!card) return;

  if (checkbox.checked) {
    card.classList.remove('popup-card-inactive');
    card.classList.add('popup-card-active');
  } else {
    card.classList.remove('popup-card-active');
    card.classList.add('popup-card-inactive');
  }

  const label = checkbox.closest('.popup-toggle-wrap')?.querySelector('span:last-child');
  if (label) label.textContent = checkbox.checked ? 'Aktiv' : 'Inaktiv';
}

function markPopupDirty() {
  const btn = document.getElementById('popupSaveBtn');
  if (btn) {
    btn.classList.remove('popup-save-btn--idle');
    btn.classList.add('popup-save-btn--dirty');
  }
}

function selectPopupMode(mode) {
  document.querySelectorAll('.popup-mode-card').forEach(card => {
    if (card.dataset.mode === mode) {
      card.classList.add('popup-mode-selected');
    } else {
      card.classList.remove('popup-mode-selected');
    }
  });

  const fixedRow = document.getElementById('popupFixedImageRow');
  if (fixedRow) {
    fixedRow.style.display = mode === 'fixed' ? 'block' : 'none';
  }

  markPopupDirty();
}

async function savePopupTransitionSettings() {
  const selectedCard = document.querySelector('.popup-mode-card.popup-mode-selected');
  const mode = selectedCard ? selectedCard.dataset.mode : 'random';

  const duration =
    document.getElementById('popupDurationSelect')?.value || '3';

  const fixedImage =
    document.getElementById('popupFixedImageSelect')?.value || '';

  await db
    .from('promo_settings')
    .upsert({
      club_id:     currentClub.club_id,
      mode,
      duration:    parseInt(duration, 10),
      fixed_image: fixedImage || null,
    });

  currentPromoSettings = {
    mode,
    duration: parseInt(duration, 10),
    fixed_image: fixedImage || null,
  };

  const fixedRow = document.getElementById('popupFixedImageRow');
  if (fixedRow) {
    fixedRow.style.display = mode === 'fixed' ? 'block' : 'none';
  }

  const btn = document.getElementById('popupSaveBtn');
  if (btn) {
    btn.classList.remove('popup-save-btn--dirty');
    btn.classList.add('popup-save-btn--idle');
  }
}

function loadPopupTransitionSettings(fileNames) {
  const mode       = currentPromoSettings.mode        || 'random';
  const duration   = String(currentPromoSettings.duration || 3);
  const fixedImage = currentPromoSettings.fixed_image  || '';

  document.querySelectorAll('.popup-mode-card').forEach(card => {
    if (card.dataset.mode === mode) {
      card.classList.add('popup-mode-selected');
    } else {
      card.classList.remove('popup-mode-selected');
    }
  });

  const durationEl = document.getElementById('popupDurationSelect');
  if (durationEl) durationEl.value = duration;

  const fixedRow = document.getElementById('popupFixedImageRow');
  if (fixedRow) {
    fixedRow.style.display = mode === 'fixed' ? 'block' : 'none';
  }

  const fixedSelect = document.getElementById('popupFixedImageSelect');
  if (fixedSelect && fileNames) {
    fixedSelect.innerHTML =
      '<option value="">-- Bild auswählen --</option>' +
      fileNames.map(name => {
        const safeName = name
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<option value="${safeName}" ${name === fixedImage ? 'selected' : ''}>${safeName}</option>`;
      }).join('');
  }

  const btn = document.getElementById('popupSaveBtn');
  if (btn) {
    btn.classList.remove('popup-save-btn--dirty');
    btn.classList.add('popup-save-btn--idle');
  }
}

async function toggleSponsorActive(fileName, checkbox){

  await db
    .from('sponsors')
    .update({ aktiv: checkbox.checked })
    .eq('club_id', currentClub.club_id)
    .eq('file_name', fileName);

  if (sponsorsCache[fileName]) {
    sponsorsCache[fileName].aktiv = checkbox.checked;
  }

  const card =
    checkbox.closest('.sponsor-logo-card');

  if(!card)return;

  if(checkbox.checked){

    card.classList.remove('sponsor-inactive');
    card.classList.add('sponsor-active');

  }else{

    card.classList.remove('sponsor-active');
    card.classList.add('sponsor-inactive');

  }
  updateTopSponsorLogos();
}

async function updateSponsorDateFrom(fileName, value){

  await db
    .from('sponsors')
    .update({ aktiv_von: value || null })
    .eq('club_id', currentClub.club_id)
    .eq('file_name', fileName);

  if (sponsorsCache[fileName]) {
    sponsorsCache[fileName].aktiv_von = value || '';
  }
}

async function updateSponsorDateTo(fileName, value){

  const today   = todayBerlin();
  const expired = value && value < today;

  await db
    .from('sponsors')
    .update({ aktiv_bis: value || null, ...(expired ? { aktiv: false } : {}) })
    .eq('club_id', currentClub.club_id)
    .eq('file_name', fileName);

  if (sponsorsCache[fileName]) {
    sponsorsCache[fileName].aktiv_bis = value || '';
    if (expired) sponsorsCache[fileName].aktiv = false;
  }

  if (expired) loadSponsorLogos();
}

async function deactivateExpiredSponsors(){

  const today = todayBerlin();

  await db
    .from('sponsors')
    .update({ aktiv: false })
    .eq('club_id', currentClub.club_id)
    .not('aktiv_bis', 'is', null)
    .lt('aktiv_bis', today);
}

async function updateTopSponsorLogos(){

  const box = document.getElementById('topSponsorLogos');
  if(!box)return;

  const today = todayBerlin();

  const { data, error } = await db
    .from('sponsors')
    .select('file_name, aktiv_von, aktiv_bis')
    .eq('club_id', currentClub.club_id)
    .eq('aktiv', true);

  if (error) {
    console.error(error);
    box.innerHTML = '';
    return;
  }

  const activeSponsors = (data || []).filter(s => {
    if (s.aktiv_von && s.aktiv_von > today) return false;
    if (s.aktiv_bis && s.aktiv_bis < today) return false;
    return true;
  });

  const SPONSOR_BASE =
    'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/promo_slides/';

  box.innerHTML = activeSponsors.map(s =>
    `<img class="top-sponsor-logo" src="${SPONSOR_BASE}${currentClub.club_id}/${encodeURIComponent(s.file_name)}" alt="${s.file_name}">`
  ).join('');
}

async function loadSportManagementList(){

const grid =
document.getElementById('sportManagementGrid');

const countBox =
document.getElementById('sportCountBox');

const logo =
document.getElementById('sportAdminClubLogo');

if(logo){
logo.src = getClubLogoUrl();
}

if(!grid)return;

grid.innerHTML = 'Sportarten werden geladen...';

const {data,error}=await db
.from('sports')
.select('*')
.eq('club_id', currentClub.club_id)
.order('sort_order',{ascending:true});

if(error){
console.error(error);
grid.innerHTML='Fehler beim Laden der Sportarten.';
return;
}

const sports = data || [];

const activeCount =
sports.filter(s => s.aktiv === 'JA').length;

if(countBox){
countBox.textContent = activeCount;
}

grid.innerHTML = '';

sports.forEach(sport=>{

const active =
sport.aktiv === 'JA';

const iconUrl =
getSportImageUrl(sport);

grid.innerHTML += `
  <div class="sport-admin-card ${active ? '' : 'inactive'}"
       data-sport-id="${sport.sport_id}">

    <div class="sport-admin-image-box">
      ${
        iconUrl
        ? `<img class="sport-admin-image" src="${iconUrl}" alt="${sport.name || ''}">`
        : `<div class="sport-admin-no-image">?</div>`
      }
    </div>

    <div class="sport-admin-actions">

      <label class="sport-admin-active-line">
        <input
          type="checkbox"
          ${active ? 'checked' : ''}
          onchange="toggleSportActive('${sport.sport_id}', '${sport.aktiv}')"
        >
        <span>Aktiv</span>
      </label>

      <button
        class="sport-admin-cfg-btn"
        onclick="openSportFieldSettings('${sport.sport_id}', '${(sport.name || '').replace(/'/g, "\\'")}')">
        ⚙️ Felder
      </button>

      <button
        class="sport-admin-delete-btn"
        onclick="deleteSport('${sport.sport_id}', '${(sport.name || '').replace(/'/g, "\\'")}')">
        🗑 Löschen
      </button>

    </div>

  </div>
`;

});

grid.innerHTML += `
  <button
    type="button"
    class="sport-admin-add-card"
    onclick="addNewSport()"
  >
    <div class="sport-admin-add-plus">+</div>
    <div class="sport-admin-add-title">NEUER SPORT</div>
    <div class="sport-admin-add-text">Sportart hinzufügen</div>
  </button>
`;

}

function openSportFieldSettings(sportId, sportName) {
  document.querySelectorAll('.sport-admin-card').forEach(c =>
    c.classList.remove('sport-cfg-selected')
  );
  const card = document.querySelector(`.sport-admin-card[data-sport-id="${sportId}"]`);
  if (card) card.classList.add('sport-cfg-selected');

  const panel  = document.getElementById('sportFieldSettingsPanel');
  const nameEl = document.getElementById('sportFieldPanelName');
  if (!panel) return;

  nameEl.textContent    = sportName;
  panel.dataset.sportId = sportId;

  const cfg = getSportConfig(sportId);
  document.getElementById('sfShowGraduation').checked = cfg.showGraduation;
  document.getElementById('sfGraduationLabel').value  = cfg.graduationLabel;
  document.getElementById('sfShowBelt').checked       = cfg.showBelt;
  document.getElementById('sfBeltLabel').value        = cfg.beltLabel;
  document.getElementById('sfShowWeight').checked     = cfg.showWeight;

  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveSportFieldSettings() {
  const panel = document.getElementById('sportFieldSettingsPanel');
  if (!panel) return;

  const sportId = panel.dataset.sportId;
  if (!sportId) return;

  const cfg = {
    showGraduation:  document.getElementById('sfShowGraduation').checked,
    graduationLabel: document.getElementById('sfGraduationLabel').value,
    showBelt:        document.getElementById('sfShowBelt').checked,
    beltLabel:       document.getElementById('sfBeltLabel').value,
    showWeight:      document.getElementById('sfShowWeight').checked,
  };

  localStorage.setItem('sport_cfg_' + sportId, JSON.stringify(cfg));

  const name = document.getElementById('sportFieldPanelName').textContent;
  showCustomMessage('✅ Einstellungen gespeichert für: ' + name);

  panel.classList.add('hidden');
  document.querySelectorAll('.sport-admin-card').forEach(c =>
    c.classList.remove('sport-cfg-selected')
  );
}

async function toggleSportActive(sportId, currentStatus) {

  const isActive =
    currentStatus === 'JA';

  // Если спорт сейчас активен — отправляем его в архив вместе со связями
  if (isActive) {

    const ok = await showCustomConfirm({
      title: 'Sportart deaktivieren',
      message: 'Diese Sportart wirklich deaktivieren?\nAlle Gruppen, Trainer und Schüler dieser Sportart werden ebenfalls deaktiviert und für 92 Tage archiviert.',
      confirmText: 'Deaktivieren',
      cancelText: 'Abbrechen',
      type: 'danger'
    });

    if (!ok) {
      await loadSportManagementList();
      return;
    }

    const { error } = await db.rpc(
      'archive_sport_with_relations',
      {
        p_sport_id: sportId
      }
    );

    if (error) {
      console.error(error);
      showCustomMessage(
        'Fehler beim Deaktivieren: ' + error.message
      );
      await loadSportManagementList();
      return;
    }

    showCustomMessage(
      'Sportart wurde deaktiviert. Gruppen, Trainer und Schüler wurden für 92 Tage archiviert.'
    );

    await loadSportManagementList();
    return;
  }

  // Wenn Sport wieder aktiviert wird
  // Если спорт снова активируется — восстанавливаем всё

const ok = await showCustomConfirm({
  title: 'Sportart aktivieren',
  message: 'Diese Sportart wieder aktivieren?\nAlle Gruppen, Trainer und Schüler werden ebenfalls wieder aktiviert.',
  confirmText: 'Aktivieren',
  cancelText: 'Abbrechen',
  type: 'confirm'
});

if (!ok) {

await loadSportManagementList();
return;

}

const { error } = await db.rpc(
'restore_sport_with_relations',
{
p_sport_id:sportId
}
);

if(error){

console.error(error);

showCustomMessage(
'Fehler beim Wiederherstellen: ' +
error.message
);

await loadSportManagementList();

return;

}

showCustomMessage(
'Sportart wurde erfolgreich wiederhergestellt.'
);

await loadSportManagementList();
}

async function showDeleteCandidatesScreen(){

previousView='adminScreen';

currentView='deleteCandidates';

hideAllWorkScreens();

document
.getElementById(
'deleteCandidatesScreen'
)
.classList.remove('hidden');

document
.getElementById(
'currentGroupInfo'
)
.textContent=
'Aktuelle Seite: Löschkandidaten';

document
.getElementById(
'mainStatus'
).textContent='';

const logo=
document.getElementById(
'adminBuchTopClubLogo'
);

if(logo){

logo.src=
getClubLogoUrl();

}

await loadDeleteCandidates();

}

async function loadDeleteCandidates(){

const summaryBox =
document.getElementById('deleteCandidatesSummary');

const listBox =
document.getElementById('deleteCandidatesList');

if(!summaryBox || !listBox)return;

summaryBox.innerHTML = '';
listBox.innerHTML = 'Löschkandidaten werden geladen...';

const {data,error}=await db
.from('delete_candidates')
.select('*')
.eq('deleted_final', false)
.order('candidate_since',{ascending:false});

if(error){

console.error(error);

listBox.innerHTML =
'Fehler beim Laden: ' + error.message;

return;

}

const rows = data || [];

const sportCount =
rows.filter(r=>r.entity_type==='sport').length;

const groupCount =
rows.filter(r=>r.entity_type==='group').length;

const trainerCount =
rows.filter(r=>r.entity_type==='trainer').length;

const studentCount =
rows.filter(r=>r.entity_type==='student').length;

summaryBox.innerHTML = `
<div class="club-stat-card club-blue">
  <div class="club-stat-icon">🏅</div>
  <div>
    <div class="club-stat-title">Sportarten</div>
    <div class="club-stat-number">${sportCount}</div>
  </div>
</div>

<div class="club-stat-card club-orange">
  <div class="club-stat-icon">👥</div>
  <div>
    <div class="club-stat-title">Gruppen</div>
    <div class="club-stat-number">${groupCount}</div>
  </div>
</div>

<div class="club-stat-card club-purple">
  <div class="club-stat-icon">👤</div>
  <div>
    <div class="club-stat-title">Trainer</div>
    <div class="club-stat-number">${trainerCount}</div>
  </div>
</div>

<div class="club-stat-card club-green">
  <div class="club-stat-icon">🥋</div>
  <div>
    <div class="club-stat-title">Schüler</div>
    <div class="club-stat-number">${studentCount}</div>
  </div>
</div>
`;

if(rows.length===0){

listBox.innerHTML = `
<div class="trainer-empty-card">
  <div class="trainer-empty-icon">🗑</div>
  Keine Löschkandidaten vorhanden.
</div>
`;

return;

}

listBox.innerHTML = rows.map(row=>{

return `
<div class="trainer-overview-card">

  <div class="trainer-data-row">
    <b>Typ:</b> ${row.entity_type || '-'}
  </div>

  <div class="trainer-data-row">
    <b>Name:</b> ${row.name || '-'}
  </div>

  <div class="trainer-data-row">
    <b>Quelle:</b> ${row.original_table || '-'}
  </div>

  <div class="trainer-data-row">
    <b>Grund:</b> ${row.reason || '-'}
  </div>

  <div class="trainer-data-row">
    <b>Seit:</b> ${
      row.candidate_since
      ? new Date(row.candidate_since).toLocaleDateString('de-DE')
      : '-'
    }
  </div>

  <div class="trainer-filter-buttons">
    <button
      class="filter-reset"
      onclick="restoreDeleteCandidate(${row.id})">
      ♻ Wiederherstellen
    </button>

    <button
      class="danger"
      onclick="deleteCandidateFinal(${row.id})">
      ❌ Endgültig löschen
    </button>
  </div>

</div>
`;

}).join('');

}

async function showAdminBuchhaltungScreen() {
  if (!currentTrainer || currentTrainer.role !== 'Admin') return;

  previousView = 'adminScreen';
  currentView = 'adminBuchhaltung';

  hideAllWorkScreens();

  document
    .getElementById('adminBuchhaltungScreen')
    ?.classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Administrator / Buchhaltung';

  document.getElementById('mainStatus').textContent = '';

const logo =
document.getElementById(
'adminBuchTopClubLogo'
);

if(logo){

logo.src =
getClubLogoUrl();

}

  await loadAdminBuchhaltungUsers();
}

async function loadAdminBuchhaltungUsers() {
  const box = document.getElementById('adminBuchhaltungContent');

  if (!box) return;

  box.innerHTML = 'Daten werden geladen.';

  const { data, error } = await db
    .from('trainers')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('name', { ascending: true });

  if (error) {
    console.error(error);
    box.innerHTML = 'Fehler beim Laden: ' + error.message;
    return;
  }

  const admins = (data || []).filter(user =>
    String(user.rolle || '').toLowerCase() === 'admin'
  );

  const buchhaltung = (data || []).filter(user =>
    String(user.rolle || '').toLowerCase() === 'buchhaltung'
  );

  box.innerHTML = `
    <div class="admin-buch-section">
      <div class="admin-buch-section-title">
        <div class="admin-buch-section-icon">🛡️</div>
        Administratoren
        <span class="admin-buch-count">${admins.length}</span>
      </div>

      ${admins.map(user => buildAdminBuchUserCard(user, 'admin')).join('')}
    </div>

    <div class="admin-buch-section">
      <div class="admin-buch-section-title">
        <div class="admin-buch-section-icon">📄</div>
        Buchhaltung
        <span class="admin-buch-count">${buchhaltung.length}</span>
      </div>

      ${buchhaltung.map(user => buildAdminBuchUserCard(user, 'buchhaltung')).join('')}
    </div>

    <div class="small" style="margin-top:14px;">
      ${admins.length + buchhaltung.length} Einträge gefunden.
    </div>
  `;
}

function buildAdminBuchUserCard(user, type) {
  return `
    <div class="admin-buch-user-card ${type}">
      <div class="admin-buch-avatar">👤</div>

      <div>
        <div class="admin-buch-name">
          ${user.name || '-'}
          <span class="admin-buch-role">${user.rolle || '-'}</span>
        </div>

        <div class="admin-buch-contact">
          📞 ${user.telefon || '-'} &nbsp;&nbsp; ✉️ ${user.email || '-'}
        </div>
      </div>

      <div class="admin-buch-actions">

  <button
    class="group-action-btn edit"
    onclick="openEditTrainerFromAdminBuch('${user.trainer_id}')">
    <img src="https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Buttons/Stud_Edit.png">
  </button>

  <button
    class="group-action-btn delete"
    onclick="deleteTrainerFromAdminBuch('${user.trainer_id}')">
    <img src="https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Buttons/Stud_Delete.png">
  </button>

</div>
    </div>
  `;
}

async function openEditTrainerFromAdminBuch(trainerId) {

  if (!trainerId) return;

  const select =
  document.getElementById('trainerAdminSelect');

  if (select) {

    let option =
    Array.from(select.options)
    .find(opt => opt.value === trainerId);

    if (!option) {

      option =
      document.createElement('option');

      option.value = trainerId;
      option.textContent = trainerId;

      select.appendChild(option);

    }

    select.value = trainerId;

  }

  previousView = 'adminBuchhaltung';
  currentView = 'editTrainer';

  await openEditSelectedTrainer();

}

async function deleteTrainerFromAdminBuch(trainerId) {

  if (!trainerId) return;

  const { data: user, error: userError } = await db
    .from('trainers')
    .select('*')
    .eq('trainer_id', trainerId)
    .single();

  if (userError || !user) {
    showCustomMessage('Zugang wurde nicht gefunden.');
    return;
  }

  if (
    String(currentTrainer?.trainerId || '') === String(trainerId)
  ) {
    showCustomMessage(
      'Sie können Ihren eigenen Administratorzugang nicht deaktivieren.'
    );
    return;
  }

  const roleText =
    String(user.rolle || '').toLowerCase() === 'buchhaltung'
      ? 'Buchhalter'
      : 'Administrator';

  document.getElementById('deleteConfirmText').textContent =
    roleText + ' "' + (user.name || '-') + '" wirklich deaktivieren?';

  document.getElementById('confirmDeleteBtn').onclick = async function () {

    closeDeleteConfirm();

    const { error } = await db
      .from('trainers')
      .update({ aktiv: 'NEIN' })
      .eq('trainer_id', trainerId);

    if (error) {
      showCustomMessage('Fehler: ' + error.message);
      return;
    }

    await loadAdminBuchhaltungUsers();
    await loadTrainerLoginList();

    showCustomMessage(
      roleText + ' wurde deaktiviert.'
    );
  };

  document
    .getElementById('deleteConfirmOverlay')
    .classList.remove('hidden');
}

async function showAdminStudentScreen(){

hideAllWorkScreens();

document
.getElementById('adminStudentScreen')
.classList.remove('hidden');

document.getElementById('currentGroupInfo').textContent =
'Aktuelle Gruppe: -';

adminSelectedSport = '';

await loadAdminSportsForStudentScreen();
updateAdminSelectedSportBox();

await loadAdminGroups();
await loadAdminKyuObiOptions();
await loadAdminStudentCount();

const logo =
document.getElementById('adminHomeClubLogo');

if(logo){
logo.src = getClubLogoUrl();
}

const topLogo =
document.getElementById('adminTopClubLogo');

if(topLogo){
topLogo.src = getClubLogoUrl();
}

await applyAdminStudentFilter();

}

async function loadAdminSportsForStudentScreen(){

const grid =
document.getElementById('adminSportFilterGrid');

if(!grid)return;

const {data,error}=await db
.from('sports')
.select('sport_id, name, icon_file, aktiv, sort_order')
.eq('aktiv','JA')
.eq('club_id', currentClub.club_id)
.order('sort_order',{ascending:true});

if(error){
console.error(error);
grid.innerHTML = '<div class="trainer-empty-card">Fehler beim Laden der Sportarten.</div>';
return;
}

adminAvailableSports = data || [];

grid.innerHTML = `
<button
class="admin-sport-filter-card ${!adminSelectedSport ? 'active' : ''}"
onclick="setAdminStudentSportFilter('')">

<img src="${STARTSEITE_URL}1_vereinsverwaltung.png">
<span>Alle Sportarten</span>
</button>
`;

adminAvailableSports.forEach(sport=>{

const iconUrl =
getSportImageUrl(sport);

grid.innerHTML += `
<button
class="admin-sport-filter-card ${
adminSelectedSport === sport.sport_id ? 'active' : ''
}"
onclick="setAdminStudentSportFilter('${sport.sport_id}')">

<img src="${iconUrl}">
<span>${sport.name}</span>
</button>
`;

});

}

async function setAdminStudentSportFilter(sportId){

adminSelectedSport = sportId || '';

updateAdminSelectedSportBox();

await loadAdminSportsForStudentScreen();
await loadAdminGroups();
await loadAdminStudentCount();
await applyAdminStudentFilter();

}

function getAdminSelectedSportName(){

if(!adminSelectedSport)return 'Alle Sportarten';

const sport =
(adminAvailableSports || []).find(s =>
String(s.sport_id) === String(adminSelectedSport)
);

return sport ? sport.name : 'Alle Sportarten';

}

function updateAdminSelectedSportBox(){

const nameBox =
document.getElementById('adminSelectedSportName');

const icon =
document.getElementById('adminSelectedSportIcon');

if(nameBox){
nameBox.textContent = getAdminSelectedSportName();
}

if(icon){

const file =
adminSelectedSport
? getBuchhaltungSportIcon(adminSelectedSport)
: '1_vereinsverwaltung.png';

icon.src = STARTSEITE_URL + file;

}

}

function adminRowHasSelectedSport(row){

if(!adminSelectedSport)return true;

const value =
row.sport_id ||
row.sport ||
row.sportart ||
'';

const ids =
String(value)
.split(/[;,]/)
.map(x=>x.trim())
.filter(Boolean);

return ids.includes(adminSelectedSport);

}

async function loadAdminGroups(){

const select =
document.getElementById('adminGroupSelect');

if(!select)return;

let query = db
.from('groups')
.select('*')
.eq('aktiv','JA')
.eq('club_id', currentClub.club_id)
.order('gruppenname',{ascending:true});

if(adminSelectedSport){
query = query.eq('sport_id', adminSelectedSport);
}

const {data,error}=await query;

if(error){
console.error(error);
select.innerHTML = '<option value="">Fehler beim Laden der Gruppen</option>';
return;
}

select.innerHTML = `
<option value="">
Alle Gruppen
</option>
`;

(data || []).forEach(group=>{

select.innerHTML += `
<option value="${group.gruppe_id}">
${group.gruppenname || group.gruppe_id}
</option>
`;

});

}

async function loadAdminStudentCount(){

const box =
document.getElementById('adminStudentCountValue');

const select =
document.getElementById('adminGroupSelect');

if(!box)return;

const groupId = select?.value || '';

const {data,error}=await db
.from('students')
.select('*')
.eq('aktiv','JA')
.eq('club_id', currentClub.club_id);

if(error){
console.error(error);
box.innerHTML = '👥 Gesamt Schüler: 0';
return;
}

let students = data || [];

students = students.filter(adminRowHasSelectedSport);

if(groupId){

students = students.filter(student=>{

const groups =
String(student.gruppe_id || '')
.split(/[;,]/)
.map(x=>x.trim())
.filter(Boolean);

return groups.includes(groupId);

});

}

const sportName = getAdminSelectedSportName();

const groupName =
groupId
? select.options[select.selectedIndex]?.textContent || 'Ausgewählte Gruppe'
: 'alle Gruppen';

box.innerHTML = `
  <div class="admin-count-main">
    👥 Gesamt Schüler: ${students.length}
  </div>
  <div class="admin-count-sub">
    (${sportName}, ${groupName})
  </div>
`;

await updateOrphanStudentsButton();

}

async function updateOrphanStudentsButton(){

  const btn =
    document.getElementById('orphanStudentsButton');

  if(!btn)return;

  const list =
    await getStudentsWithoutGroupOrTrainer();

  if(!list || list.length === 0){

    btn.classList.add('hidden');

    btn.textContent =
      '⚠ Ohne Gruppe / Trainer: 0';

    return;
  }

  btn.classList.remove('hidden');

  btn.textContent =
    '⚠ Ohne Gruppe / Trainer: ' + list.length;

}

async function loadAdminKyuObiOptions(){

await ensureKyuObiLookup();

const kyuFrom=document.getElementById('adminStatKyuFrom');
const kyuTo=document.getElementById('adminStatKyuTo');
const obiFrom=document.getElementById('adminStatObiFrom');
const obiTo=document.getElementById('adminStatObiTo');

if(!kyuFrom || !kyuTo || !obiFrom || !obiTo)return;

let kyuHtml='<option value="">Alle</option>';
let obiHtml='<option value="">Alle</option>';

kyuObiLookup.forEach(row=>{
kyuHtml+=`<option value="${row.kyu_grad}">${row.kyu_grad}</option>`;
obiHtml+=`<option value="${row.guertelfarbe}">${row.guertelfarbe}</option>`;
});

kyuFrom.innerHTML=kyuHtml;
kyuTo.innerHTML=kyuHtml;
obiFrom.innerHTML=obiHtml;
obiTo.innerHTML=obiHtml;

}

function syncAdminStatObiFromKyu(mode){

const kyuId =
mode === 'from'
? 'adminStatKyuFrom'
: 'adminStatKyuTo';

const obiId =
mode === 'from'
? 'adminStatObiFrom'
: 'adminStatObiTo';

const kyu =
document.getElementById(kyuId)?.value;

const obiSelect =
document.getElementById(obiId);

if(!obiSelect)return;

if(!kyu){
obiSelect.value='';
return;
}

const row =
kyuObiLookup.find(r =>
String(r.kyu_grad) === String(kyu)
);

if(row){
obiSelect.value = row.guertelfarbe;
}

}

function syncAdminStatKyuFromObi(mode){

const obiId =
mode === 'from'
? 'adminStatObiFrom'
: 'adminStatObiTo';

const kyuId =
mode === 'from'
? 'adminStatKyuFrom'
: 'adminStatKyuTo';

const obi =
document.getElementById(obiId)?.value;

const kyuSelect =
document.getElementById(kyuId);

if(!kyuSelect)return;

if(!obi){
kyuSelect.value='';
return;
}

const row =
kyuObiLookup.find(r =>
String(r.guertelfarbe) === String(obi)
);

if(row){
kyuSelect.value = row.kyu_grad;
}

}

async function showAdminStudentNameSuggestions(){

const input =
document.getElementById('adminStatName');

const box =
document.getElementById('adminStudentNameSuggestions');

if(!input || !box)return;

const query =
input.value.trim().toLowerCase();

if(query.length < 1){
box.innerHTML='';
return;
}

const {data,error}=await db
.from('students')
.select('*')
.eq('aktiv','JA')
.eq('club_id', currentClub.club_id)
.order('nachname',{ascending:true});

if(error){
console.error(error);
box.innerHTML='';
return;
}

const filtered =
(data||[]).filter(student=>{

const fullName =
(
(student.vorname||'') + ' ' +
(student.nachname||'') + ' ' +
(student.nachname||'') + ' ' +
(student.vorname||'')
).toLowerCase();

return fullName.includes(query);

});

box.innerHTML =
filtered.slice(0,10).map(student=>{

const name =
(student.nachname||'') + ' ' + (student.vorname||'');

return `
<div
class="suggestion-item"
onclick="selectAdminStudentSuggestion('${name.replace(/'/g,"\\'")}')">
${name}
</div>
`;

}).join('');

}

function selectAdminStudentSuggestion(name){

const input =
document.getElementById('adminStatName');

const box =
document.getElementById('adminStudentNameSuggestions');

if(input){
input.value=name;
}

if(box){
box.innerHTML='';
}

applyAdminStudentFilter();

}

async function showTrainerStudentNameSuggestions(){

  const input = document.getElementById('filterName');
  const box = document.getElementById('trainerStudentNameSuggestions');
  const trainerSelect = document.getElementById('trainerAdminSelect');

  if(!input || !box)return;

  const query = input.value.trim().toLowerCase();

  if(query.length < 1){
    box.innerHTML = '';
    return;
  }

  const trainerId = trainerSelect?.value || '';

  const {data,error} = await db
    .from('students')
    .select('*')
    .eq('aktiv','JA')
    .eq('club_id', currentClub.club_id)
    .order('nachname',{ascending:true});

  if(error){
    console.error(error);
    box.innerHTML = '';
    return;
  }

  let allowedGroupIds = [];

  if(trainerId){

    const {data: links} = await db
      .from('trainer_groups')
      .select('gruppe_id')
      .eq('trainer_id', trainerId)
      .eq('club_id', currentClub.club_id);

    allowedGroupIds = (links || [])
      .map(x => x.gruppe_id)
      .filter(Boolean);
  }

  let filtered = data || [];

  if(trainerId){
    filtered = filtered.filter(student => {

      const ids = String(student.gruppe_id || '')
        .split(/[;,]/)
        .map(x => x.trim())
        .filter(Boolean);

      return ids.some(id => allowedGroupIds.includes(id));
    });
  }

  filtered = filtered.filter(student => {

    const fullName = (
      (student.vorname || '') + ' ' +
      (student.nachname || '') + ' ' +
      (student.nachname || '') + ' ' +
      (student.vorname || '')
    ).toLowerCase();

    return fullName.includes(query);
  });

  if(filtered.length === 0){
    box.innerHTML = '';
    return;
  }

  box.innerHTML = filtered.slice(0,10).map(student => {

    const name =
      (student.nachname || '') + ' ' + (student.vorname || '');

    return `
      <div
        class="suggestion-item"
        onclick="selectTrainerStudentSuggestion('${name.replace(/'/g,"\\'")}')">
        ${name}
      </div>
    `;
  }).join('');
}

function selectTrainerStudentSuggestion(name){

  const input = document.getElementById('filterName');
  const box = document.getElementById('trainerStudentNameSuggestions');

  if(input){
    input.value = name;
  }

  if(box){
    box.innerHTML = '';
  }

  applyTrainerFilters();
}

async function applyAdminStudentFilter(){

const select =
document.getElementById('adminGroupSelect');

const groupId =
select?.value || '';

const {data,error}=await db
.from('students')
.select('*')
.eq('aktiv','JA')
.eq('club_id', currentClub.club_id);

if(error){
console.error(error);
return;
}

let students = data || [];

students = students.filter(adminRowHasSelectedSport);

if(groupId){

students = students.filter(student=>{

const ids =
String(student.gruppe_id || '')
.split(/[;,]/)
.map(x=>x.trim())
.filter(Boolean);

return ids.includes(groupId);

});

}

students = filterStudentsUniversal(students, {
  name: document.getElementById('adminStatName')?.value || '',
  ageFrom: document.getElementById('adminStatAgeFrom')?.value || '',
  ageTo: document.getElementById('adminStatAgeTo')?.value || '',
  kyuFrom: document.getElementById('adminStatKyuFrom')?.value || '',
  kyuTo: document.getElementById('adminStatKyuTo')?.value || '',
  obiFrom: document.getElementById('adminStatObiFrom')?.value || '',
  obiTo: document.getElementById('adminStatObiTo')?.value || '',
  geschlecht: document.getElementById('adminStatGeschlecht')?.value || '',
  groupId: ''
});

await renderStudentTableUniversal(students,{
containerId:'adminStudentStatsResult',
showCheckbox:false,
showGroup:true,
showComment:false
});

const countEl = document.getElementById('adminFilterCount');
if(countEl){
  countEl.textContent = students.length > 0
    ? `Gefunden: ${students.length} Schüler`
    : 'Keine Schüler gefunden';
}

}

async function resetAdminStudentFilter(){

await resetFiltersUniversal({
fields:[
'adminStatName',
'adminStatAgeFrom',
'adminStatAgeTo',
'adminStatKyuFrom',
'adminStatKyuTo',
'adminStatObiFrom',
'adminStatObiTo',
'adminStatGeschlecht'
],
callback:applyAdminStudentFilter
});

}

const BUTTONS_URL =
  'https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Buttons/';

  let buchhaltungSelectedSport = '';

function setBuchhaltungSportFilter(sportId) {
  buchhaltungSelectedSport = sportId || '';
  loadBuchhaltungData();
}

function getBuchhaltungSportName(sports) {
  if (!buchhaltungSelectedSport) return 'Alle Sportarten';

  const sport = (sports || []).find(s =>
    String(s.sport_id) === String(buchhaltungSelectedSport)
  );

  return sport ? sport.name : 'Alle Sportarten';
}

function getBuchhaltungSportIcon(sportId) {
  if (!sportId) return '1_vereinsverwaltung.png';

  return STARTSEITE_ICON_FILES[sportId] || STARTSEITE_CARD_FILES[sportId] || '';
}

async function loadBuchhaltungData() {
  const box = document.getElementById('buchhaltungList');
  if (!box) return;

  box.innerHTML = 'Buchhaltung wird geladen...';

  const [studentsResult, archivResult, attendanceResult, groupsResult, trainerGroupsResult, sportsResult] =
    await Promise.all([
      db.from('students').select('*').eq('club_id', currentClub.club_id),
      db.from('archiv').select('*').eq('club_id', currentClub.club_id),
      db.from('attendance').select('*').eq('anwesenheit', 'JA').eq('club_id', currentClub.club_id),
      db.from('groups').select('*').eq('club_id', currentClub.club_id),
      db.from('trainer_groups').select('*').eq('club_id', currentClub.club_id),
      db.from('sports')
        .select('sport_id, name, icon_file, aktiv, sort_order')
        .eq('aktiv', 'JA')
        .eq('club_id', currentClub.club_id)
        .order('sort_order', { ascending: true })
    ]);

  if (studentsResult.error) {
    box.innerHTML = 'Fehler beim Laden: ' + studentsResult.error.message;
    return;
  }

  const otherErrors = [
    { name: 'Archiv',          result: archivResult },
    { name: 'Attendance',      result: attendanceResult },
    { name: 'Gruppen',         result: groupsResult },
    { name: 'Trainer-Gruppen', result: trainerGroupsResult },
    { name: 'Sportarten',      result: sportsResult }
  ].filter(x => x.result.error);

  if (otherErrors.length > 0) {
    const names = otherErrors.map(x => x.name).join(', ');
    console.error('loadBuchhaltungData Fehler:', otherErrors.map(x => x.result.error));
    box.innerHTML = `Fehler beim Laden: ${names}. Bitte Seite neu laden.`;
    return;
  }

  const students = studentsResult.data || [];
  const archiv = archivResult.data || [];
  const attendance = attendanceResult.data || [];
  const groups = groupsResult.data || [];
  const trainerGroups = trainerGroupsResult.data || [];
  const sports = sportsResult.data || [];

  function hasSelectedSport(row) {
  if (!buchhaltungSelectedSport) return true;

  const sportValue =
    row.sport_id ||
    row.sport ||
    row.sportart ||
    '';

  const sportIds = String(sportValue)
    .split(/[;,]/)
    .map(x => x.trim())
    .filter(Boolean);

  return sportIds.includes(buchhaltungSelectedSport);
}

function findStudentForArchiv(row) {
  return students.find(s =>
    String(s.student_id || '') === String(row.student_id || '') ||
    String(s.id || '') === String(row.student_id || '')
  );
}

function hasSelectedSportArchiv(row) {
  if (!buchhaltungSelectedSport) return true;

  if (hasSelectedSport(row)) return true;

  const originalStudent = findStudentForArchiv(row);

  if (originalStudent && hasSelectedSport(originalStudent)) {
    return true;
  }

  return false;
}

const filteredStudents = students.filter(hasSelectedSport);
const filteredArchiv = archiv.filter(hasSelectedSportArchiv);

  const groupNameMap = {};
  const groupStatusMap = {};
  groups.forEach(g => {
    groupNameMap[String(g.gruppe_id)] = g.gruppenname || g.gruppe_id;
    groupStatusMap[String(g.gruppe_id)] = String(g.aktiv || '').toUpperCase();
  });

  function getAgeFromStudent(student) {
    if (student.alter) return student.alter;

    if (!student.geburtsdatum) return '-';

    const birth = new Date(student.geburtsdatum);
    if (isNaN(birth)) return '-';

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();

    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    return age;
  }

  function getGroupText(student) {
    const ids = String(student.gruppe_id || '')
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);

    if (!ids.length) return '-';

    return ids.map(id => {
      const name = escapeHtml(String(groupNameMap[id] || id));
      const aktiv = groupStatusMap[id];
      if (aktiv === undefined || aktiv !== 'JA') {
        return `<span class="gruppe-geloescht-name">${name}</span> <span class="gruppe-geloescht-label">(gelöscht)</span>`;
      }
      return name;
    }).join(', ');
  }

  function getTrainerText(student) {
    if (student.trainer) return student.trainer;

    const ids = String(student.gruppe_id || '')
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);

    const names = trainerGroups
      .filter(tg => ids.includes(tg.gruppe_id))
      .map(tg => tg.trainer_name)
      .filter(Boolean);

    return [...new Set(names)].join(', ') || '-';
  }

  function countTrainings(student) {
    const possibleIds = [
      String(student.id || ''),
      String(student.student_id || '')
    ].filter(Boolean);

    const unique = {};

    attendance.forEach(row => {
      if (!possibleIds.includes(String(row.student_id || ''))) return;

      const dateKey = String(row.datum || '').slice(0, 10);
      const groupKey = String(row.gruppe_id || '');

      if (!dateKey) return;

      unique[dateKey + '|' + groupKey + '|' + row.student_id] = true;
    });

    return Object.keys(unique).length;
  }

  function findStudentByCode(code) {
    return filteredStudents.find(s =>
      String(s.student_id || '') === String(code || '') ||
      String(s.id || '') === String(code || '')
    );
  }

  function mapStudent(student) {
    return {
      id: student.id,
      student_id: student.student_id,
      nachname: student.nachname || '',
      vorname: student.vorname || '',
      alter: getAgeFromStudent(student),
      gruppe: getGroupText(student),
      trainer: getTrainerText(student),
      eintritt: student.eintrittsdatum
        ? new Date(student.eintrittsdatum).toLocaleDateString('de-DE')
        : '-',
      trainings: countTrainings(student)
    };
  }

  const withoutContract = filteredStudents
    .filter(s =>
      String(s.aktiv || '').toUpperCase() === 'JA' &&
      String(s.vertrag_status || '').toUpperCase() !== 'OK' &&
      String(s.buchhaltung_relevant || 'JA').toUpperCase() !== 'NEIN'
    )
    .map(mapStudent);

  const withContract = filteredStudents
    .filter(s =>
      String(s.aktiv || '').toUpperCase() === 'JA' &&
      String(s.vertrag_status || '').toUpperCase() === 'OK'
    )
    .map(mapStudent);

  const archivedOpen = filteredArchiv
    .filter(a => String(a.buchhaltung_status || '').toUpperCase() !== 'ERLEDIGT')
    .map(a => {
      const original = findStudentByCode(a.student_id);
      const base = original || a;

      return {
        id: original?.id || a.id || a.student_id,
        archivId: a.id,
        student_id: a.student_id,
        nachname: base.nachname || '',
        vorname: base.vorname || '',
        alter: getAgeFromStudent(base),
        gruppe: getGroupText(base),
        trainer: getTrainerText(base),
        eintritt: base.eintrittsdatum
          ? new Date(base.eintrittsdatum).toLocaleDateString('de-DE')
          : '-',
        trainings: original ? countTrainings(original) : 0
      };
    });

  box.innerHTML = `
    <div class="buch-modern-page">

      <div class="buch-modern-header">
        <div>
          <h2>Buchhaltung</h2>
          <div>Finanzen, Verträge und Schülerstatus verwalten</div>
        </div>
        <img
  class="buch-modern-logo buch-page-logo"
  src="${getClubLogoUrl()}"
>
      </div>
      <div class="buch-selected-sport-card">
        <div class="buch-selected-sport-label">
          Aktuell ausgewählter Sport
        </div>

        <div class="buch-selected-sport-name">
          ${getBuchhaltungSportName(sports)}
        </div>
      </div>
      <div class="buch-summary-grid">
        <div class="buch-summary-card red">
          <div class="buch-summary-icon">👥</div>
          <div>
            <div>Neue Schüler ohne Vertrag</div>
            <strong>${withoutContract.length}</strong>
          </div>
        </div>

        <div class="buch-summary-card yellow">
          <div class="buch-summary-icon">📁</div>
          <div>
            <div>Inaktive / archivierte Schüler</div>
            <strong>${archivedOpen.length}</strong>
          </div>
        </div>

        <div class="buch-summary-card green">
          <div class="buch-summary-icon">✅</div>
          <div>
            <div>Aktive Schüler mit Vertrag</div>
            <strong>${withContract.length}</strong>
          </div>
        </div>
      </div>

            <div class="buch-sport-filter-box">

        <div class="buch-sport-filter-title">
          Sportart auswählen
        </div>

        <div class="buch-sport-filter-grid">

          <button
            class="buch-sport-filter-card ${!buchhaltungSelectedSport ? 'active' : ''}"
            onclick="setBuchhaltungSportFilter('')">

            <img src="${STARTSEITE_URL}1_vereinsverwaltung.png">
            <span>Alle Sportarten</span>
          </button>

          ${
            sports.map(sport => {
              const iconUrl = getSportImageUrl(sport);

              return `
                <button
                  class="buch-sport-filter-card ${
                    buchhaltungSelectedSport === sport.sport_id ? 'active' : ''
                  }"
                  onclick="setBuchhaltungSportFilter('${sport.sport_id}')">

                  <img src="${iconUrl}">
                  <span class="sport-hidden-name">${sport.name}</span>
                </button>
              `;
            }).join('')
          }

        </div>
      </div>

      ${buildBuchhaltungSectionModern(
        'red',
        '👥',
        'Neue Schüler ohne Vertrag',
        withoutContract,
        true,
        'contract'
      )}

      ${buildBuchhaltungSectionModern(
        'yellow',
        '📁',
        'Inaktive / archivierte Schüler',
        archivedOpen,
        true,
        'archive'
      )}

      ${buildBuchhaltungSectionModern(
        'green',
        '✅',
        'Aktive Schüler mit Vertrag',
        withContract,
        false,
        'active'
      )}

    </div>
   `;

  const buchLogo = box.querySelector('.buch-modern-logo');

  if (buchLogo) {
    buchLogo.style.setProperty('width', '260px', 'important');
    buchLogo.style.setProperty('height', '260px', 'important');
    buchLogo.style.setProperty('object-fit', 'contain', 'important');
    buchLogo.style.setProperty('position', 'absolute', 'important');
    buchLogo.style.setProperty('right', '10px', 'important');
    buchLogo.style.setProperty('top', '-20px', 'important');
    buchLogo.style.setProperty('z-index', '999', 'important');
  }
}

function buildBuchhaltungSectionModern(color, icon, title, list, showDoneButton, actionType) {
  return `
    <div class="buch-section ${color}">
      <div class="buch-section-title">
        <div>
          <span class="buch-section-icon">${icon}</span>
          ${title}
          <span class="buch-count">${list.length}</span>
        </div>
      </div>

      <div class="buch-table">
        <div class="buch-row buch-head">
          <div>Nachname</div>
          <div>Vorname</div>
          <div>Alter</div>
          <div>Gruppe</div>
          <div>Trainer</div>
          <div>Eintritt</div>
          <div>Trainings</div>
          <div>Aktion</div>
          <div>Statistik</div>
        </div>

        ${
          list.length
            ? list.map((student, index) =>
    buildBuchhaltungStudentRow(student, showDoneButton, actionType, index + 1)
  ).join('')
            : `<div class="buch-empty">Keine Einträge gefunden.</div>`
        }
      </div>
    </div>
  `;
}

function buildBuchhaltungStudentRow(student, showDoneButton, actionType, number) {
  const safeId = student.id || student.student_id || '';
  const archivId = student.archivId || student.student_id || safeId;

  const doneAction =
    actionType === 'contract'
      ? `confirmBuchhaltungContract('${safeId}')`
      : `confirmBuchhaltungArchived('${archivId}')`;

  return `
    <div class="buch-row">
      <div><b>${number}. ${student.nachname || '-'}</b></div>
      <div>${student.vorname || '-'}</div>
      <div>${student.alter || '-'}</div>
      <div>${student.gruppe || '-'}</div>
      <div>${student.trainer || '-'}</div>
      <div>${student.eintritt || '-'}</div>
      <div>${student.trainings || 0}</div>

      <div>
        ${
          showDoneButton
            ? `<button class="buch-img-btn done" onclick="${doneAction}" title="Erledigt">✓</button>`
            : ``
        }
      </div>

      <div>
        <button class="buch-img-btn statistic" onclick="showStudentStats('${safeId}')" title="Statistik">
          <img src="${BUTTONS_URL}Stud_Statistik.png" alt="Statistik">
        </button>
      </div>
    </div>
  `;
}

async function confirmBuchhaltungContract(studentId) {
  if (!studentId) return;

  const ok = await showCustomConfirm({
    title: 'Vertrag bestätigen',
    message: 'Vertrag für diesen Schüler als erledigt markieren?',
    confirmText: 'Ja, erledigt',
    cancelText: 'Abbrechen',
    type: 'confirm'
  });
  if (!ok) return;

  const { error } = await db
    .from('students')
    .update({
      vertrag_status: 'OK',
      vertrag_datum: todayBerlin(),
      vertrag_geprueft_von: currentTrainer?.name || 'Buchhaltung'
    })
    .eq('id', studentId);

  if (error) {
    showCustomMessage('Fehler: ' + error.message);
    return;
  }

  await loadBuchhaltungData();
}

async function confirmBuchhaltungArchived(archivId) {
  if (!archivId) return;

  const ok = await showCustomConfirm({
    title: 'Bestätigung',
    message: 'Archivierten Schüler als erledigt markieren?',
    confirmText: 'Ja, erledigt',
    cancelText: 'Abbrechen',
    type: 'confirm'
  });
  if (!ok) return;

  const payload = {
    buchhaltung_status: 'ERLEDIGT',
    buchhaltung_geprueft_von: currentTrainer?.name || 'Buchhaltung',
    buchhaltung_datum: todayBerlin()
  };

  let result = await db
    .from('archiv')
    .update(payload)
    .eq('id', archivId);

  if (result.error) {
    result = await db
      .from('archiv')
      .update(payload)
      .eq('student_id', archivId);
  }

  if (result.error) {
    showCustomMessage('Fehler: ' + result.error.message);
    return;
  }

  await loadBuchhaltungData();
}

let customMessageCallback = null;

function showCustomMessage(text, callback){

const overlay =
document.getElementById(
'customMessageOverlay'
);

const message =
document.getElementById(
'customMessageText'
);

customMessageCallback =
typeof callback === 'function'
? callback
: null;

if(message){
message.textContent = text;
}

overlay
?.classList
.remove('hidden');

}


async function closeCustomMessage(){

document
.getElementById(
'customMessageOverlay'
)
?.classList
.add('hidden');

if(customMessageCallback){

const callback =
customMessageCallback;

customMessageCallback = null;

await callback();

}

}

function closeDeleteConfirm() {

  document
    .getElementById('deleteConfirmOverlay')
    ?.classList
    .add('hidden');

}

function showCustomConfirm({ title, message, confirmText = 'OK', cancelText = 'Abbrechen', type = 'confirm' }) {
  return new Promise((resolve) => {
    document.getElementById('customConfirmTitle').textContent = title || 'Bestätigung';
    document.getElementById('customConfirmText').textContent = message;
    const okBtn = document.getElementById('customConfirmOkBtn');
    const cancelBtn = document.getElementById('customConfirmCancelBtn');
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    okBtn.style.background = type === 'danger'
      ? 'linear-gradient(135deg,#8b0000,#d62828)'
      : 'linear-gradient(135deg,#0d7c38,#085a29)';
    okBtn.onclick = () => {
      document.getElementById('customConfirmOverlay').classList.add('hidden');
      resolve(true);
    };
    cancelBtn.onclick = () => {
      document.getElementById('customConfirmOverlay').classList.add('hidden');
      resolve(false);
    };
    document.getElementById('customConfirmOverlay').classList.remove('hidden');
  });
}

function hideAllWorkScreens() {
  
  const ids = [
    'adminScreen',
    'groupScreen',
    'buchhaltungScreen',
    'clubStatistikScreen',
    'groupOverviewScreen',
    'adminStatistikScreen',
    'adminBuchhaltungScreen',
    'attendanceScreen',
    'addStudentScreen',
    'weightScreen',
    'studentStatsScreen',
    'clubStudentStatsScreen',
    'addGroupScreen',
    'editGroupScreen',
    'addTrainerScreen',
    'editTrainerScreen',
    'trainerAdminScreen',
    'adminStudentScreen',
    'orphanStudentsScreen',
    'sportManagementScreen',
    'sponsorManagementScreen',
    'deleteCandidatesScreen',
    'zeitraumStatistikScreen'
  ];

  ids.forEach(function(id) {
    const el = document.getElementById(id);

    if(el){
      el.classList.add('hidden');
    }
  });

  const visible=document.querySelector(
'.screen:not(.hidden), [id$="Screen"]:not(.hidden)'
);

if(visible){

pushScreen(visible.id);

}
}

async function showOrphanStudentsList(){

  currentView = 'orphanStudents';

hideAllWorkScreens();

document
.getElementById("orphanStudentsScreen")
.classList.remove("hidden");


document.getElementById(
"currentGroupInfo"
).innerText =
"Aktuelle Seite: Schüler ohne Gruppe / Trainer";


try{

await loadAdminSportsForOrphanScreen();

await loadOrphanStudents();

}catch(err){

console.error(err);

showCustomMessage(
"Fehler beim Laden der Schüler."
);

}

}

async function loadAdminSportsForOrphanScreen(){

const grid =
document.getElementById('orphanSportFilterGrid');

if(!grid)return;

const {data,error}=await db
.from('sports')
.select('sport_id, name, icon_file, aktiv, sort_order')
.eq('aktiv','JA')
.eq('club_id', currentClub.club_id)
.order('sort_order',{ascending:true});

if(error){
console.error(error);
grid.innerHTML = '<div class="trainer-empty-card">Fehler beim Laden der Sportarten.</div>';
return;
}

adminAvailableSports = data || [];

grid.innerHTML = `
<button
class="admin-sport-filter-card ${!window.orphanSportFilter ? 'active' : ''}"
onclick="setOrphanSportFilter('')">

<img src="${STARTSEITE_URL}1_vereinsverwaltung.png">
<span>Alle Sportarten</span>
</button>
`;

adminAvailableSports.forEach(sport=>{

const iconUrl =
getSportImageUrl(sport);

grid.innerHTML += `
<button
class="admin-sport-filter-card ${
window.orphanSportFilter === sport.sport_id ? 'active' : ''
}"
onclick="setOrphanSportFilter('${sport.sport_id}')">

<img src="${iconUrl}">
<span>${sport.name}</span>
</button>
`;

});

}

async function setOrphanSportFilter(sportId){

window.orphanSportFilter = sportId || '';

await loadAdminSportsForOrphanScreen();
await loadOrphanStudents();

}

async function loadOrphanStudents(){

const resultBox =
document.getElementById('orphanStudentsResult');

if(!resultBox)return;

resultBox.innerHTML =
'Schüler werden geladen...';

let students =
await getStudentsWithoutGroupOrTrainer();

if(window.orphanSportFilter){

students =
students.filter(student=>{

const value =
student.sport_id ||
student.sport ||
student.sportart ||
'';

const ids =
String(value)
.split(/[;]/)
.map(x=>x.trim())
.filter(Boolean);

return ids.includes(window.orphanSportFilter);

});

}

const nameBox =
document.getElementById('orphanSelectedSportName');

if(nameBox){

nameBox.textContent =
window.orphanSportFilter
? getOrphanSportName(window.orphanSportFilter)
: 'Alle Sportarten';

}

const icon =
document.getElementById('orphanSelectedSportIcon');

if(icon){

const file =
window.orphanSportFilter
? getBuchhaltungSportIcon(window.orphanSportFilter)
: '1_vereinsverwaltung.png';

icon.src =
STARTSEITE_URL + file;

}

if(!students || students.length === 0){

resultBox.innerHTML = `
  <div class="trainer-empty-card">
    <div class="trainer-empty-icon">✅</div>
    Keine Schüler ohne Gruppe oder Trainer gefunden.
  </div>
`;

return;

}

await renderStudentTableUniversal(students,{
containerId:'orphanStudentsResult',
showCheckbox:false,
showGroup:true,
showComment:false
});

}

function getOrphanSportName(sportId){

const sport =
(adminAvailableSports || []).find(s =>
String(s.sport_id) === String(sportId)
);

return sport ? sport.name : 'Alle Sportarten';

}

async function showWeight() {

  const visibleScreensForWeight = [
  'attendanceScreen',
  'groupScreen'
];

previousScreenBeforeWeight =
  visibleScreensForWeight.find(function(screenId) {
    const el = document.getElementById(screenId);
    return el && !el.classList.contains('hidden');
  }) || null;

  const groupSelect = document.getElementById('groupSelect');
  const groupId = groupSelect ? groupSelect.value : '';

  if (!groupId) {
    showCustomMessage('Bitte zuerst eine Gruppe auswählen.');
    return;
  }

  hideAllWorkScreens();

  document.getElementById('weightScreen').classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Gruppe: ' + groupSelect.options[groupSelect.selectedIndex].textContent;

  await renderWeight(groupId);
}

async function renderWeight(groupId) {

  const box = document.getElementById('weightList');

  if (!box) return;

  box.innerHTML = 'Schüler werden geladen...';

  const { data, error } = await db
    .from('students')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('nachname', { ascending:true });

  if (error) {
    console.error(error);
    box.innerHTML = 'Fehler beim Laden.';
    return;
  }

  const students = (data || []).filter(function(student){

    const groups =
      String(student.gruppe_id || '')
        .split(/[;,]/)
        .map(x => x.trim())
        .filter(Boolean);

    return groups.includes(groupId);
  });

  if (students.length === 0) {
    box.innerHTML = '<p>Keine Schüler in Gruppe.</p>';
    return;
  }

  let html = `
    <div class="weight-modern-card">

      <div class="weight-modern-header">
        <div class="weight-modern-icon">⚖️</div>
        <div>
          <h2>Wiegung</h2>
          <div class="weight-modern-subtitle">
            Gewicht der Schüler eintragen
          </div>
        </div>
      </div>

      <div class="weight-modern-table">

        <div class="weight-modern-head">
          <div>№</div>
          <div>Nachname</div>
          <div>Vorname</div>
          <div>Gewicht (kg)</div>
        </div>
  `;

  students.forEach(function(student, index){

    const rowGenderClass = getGenderRowClass(student);

    html += `
      <div class="weight-modern-row ${rowGenderClass}">

        <div class="weight-number-badge">
          ${index + 1}
        </div>

        <div class="weight-name">
          ${student.nachname || ''}
        </div>

        <div class="weight-name">
          ${student.vorname || ''}
        </div>

        <div class="weight-input-wrap">
          <input
            class="weightInput weight-modern-input"
            data-student-id="${student.id}"
            data-student-code="${student.student_id || student.id}"
            data-vorname="${student.vorname || ''}"
            data-nachname="${student.nachname || ''}"
            type="number"
            step="0.1"
            min="1"
            max="999"
            value="${student.aktuelles_gewicht || ''}"
            placeholder="kg">
          <span class="weight-unit">kg</span>
        </div>

      </div>
    `;
  });

  html += `
      </div>

      <button
        class="weight-save-modern-btn"
        onclick="saveWeights()">
        💾 Gewicht speichern
      </button>

    </div>
  `;

  box.innerHTML = html;
}

async function saveWeights() {

  const groupSelect = document.getElementById('groupSelect');
  const groupId = groupSelect ? groupSelect.value : '';

  if (!groupId) {
    showCustomMessage('Bitte zuerst eine Gruppe auswählen.');
    return;
  }

  const inputs = document.querySelectorAll('.weightInput');

  if (!inputs || inputs.length === 0) {
    showCustomMessage('Keine Schüler gefunden.');
    return;
  }

  const today = todayBerlin();
  const trainerName = currentTrainer ? currentTrainer.name : '';

  let savedCount = 0;

  for (const input of inputs) {

    const gewicht = input.value;

    if (!gewicht) continue;

    const studentId = input.dataset.studentId;

    const { error: updateError } = await db
      .from('students')
      .update({
        aktuelles_gewicht: gewicht
      })
      .eq('id', studentId);

    if (updateError) {
      console.error(updateError);
      showCustomMessage('Fehler beim Speichern: ' + updateError.message);
      return;
    }

    const studentCode = input.dataset.studentCode || String(studentId);

    const { error: logError } = await db
      .from('weight_log')
      .insert([{
        datum: today,
        student_id: studentCode,
        gruppe_id: groupId,
        gewicht: gewicht,
        trainer: trainerName,
        vorname: input.dataset.vorname || '',
        nachname: input.dataset.nachname || '',
        kommentar: 'Wiegung',
        club_id: currentClub.club_id
      }]);

    if (logError) {
      console.error(logError);
      showCustomMessage('Fehler beim Weight Log: ' + logError.message);
      return;
    }

    savedCount++;
  }

  showCustomMessage('Gewicht gespeichert: ' + savedCount + ' Schüler.');

  if (previousScreenBeforeWeight === 'attendanceScreen') {
    hideAllWorkScreens();

    document.getElementById('attendanceScreen').classList.remove('hidden');

    await loadStudentsListForAttendance(groupId);
    await loadTodayAttendanceCount(groupId);

    previousScreenBeforeWeight = null;
    return;
  }

  if (previousScreenBeforeWeight === 'groupScreen') {
    hideAllWorkScreens();

    document.getElementById('groupScreen').classList.remove('hidden');

    await loadStudents();
    await applyGroupFilter();

    previousScreenBeforeWeight = null;
    return;
  }

  goRoleHome();
}

async function openSelectedGroupList() {
  const groupSelect = document.getElementById('groupSelect');
  const groupId = groupSelect ? groupSelect.value : '';

  if (!groupId) {
    showCustomMessage('Bitte zuerst eine Gruppe auswählen.');
    return;
  }

  await loadStudentsListForAttendance(groupId);
  await loadTodayAttendanceCount(groupId);

  hideAllWorkScreens();

  document.getElementById('attendanceScreen').classList.remove('hidden');
  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Gruppe: ' + groupSelect.options[groupSelect.selectedIndex].textContent;
}

async function loadStudentsListForAttendance(groupId) {
  const listBox = document.getElementById('studentsList');

  if (!listBox) return;

  listBox.innerHTML = 'Schüler werden geladen...';

  const { data, error } = await db
    .from('students')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('nachname', { ascending: true });

  if (error) {
    console.error(error);
    listBox.innerHTML = 'Fehler beim Laden der Schüler.';
    return;
  }

  const { data: attendanceRows, error: attendanceError } = await db
  .from('attendance')
  .select('student_id, gruppe_id, datum, anwesenheit')
  .eq('gruppe_id', groupId)
  .eq('datum', todayBerlin());

const today = todayBerlin();
const todayAttendanceMap = {};

(attendanceRows || []).forEach(row => {
  const rowDate = String(row.datum || '').slice(0, 10);

  if (
    rowDate === today &&
    row.gruppe_id === groupId &&
    row.student_id
  ) {
    todayAttendanceMap[row.student_id] = row.anwesenheit;
  }
});


  const students = (data || []).filter(function(student) {
    const ids = String(student.gruppe_id || '')
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);

    return ids.includes(groupId);
  });

  if (students.length === 0) {
    listBox.innerHTML = '<p>Keine Schüler in dieser Gruppe.</p>';
    return;
  }

  const { data: groupLinks } = await db
    .from('trainer_groups')
    .select('trainer_name')
    .eq('gruppe_id', groupId);

  const externalGroupData = {
    groups: [],
    trainers: [...new Set(
      (groupLinks || []).map(x => x.trainer_name).filter(Boolean)
    )]
  };

const enrichedStudents = await Promise.all(

students.map(async s => {

const fullData =
await getStudentFullData(
getStudentId(s),
externalGroupData,
s
);

return fullData || s;

})

);

const autoCloseErrors = [];

for (const student of enrichedStudents) {
  const result = await autoCloseOldProbetraining(student);

  if(result.error){
    console.warn('autoCloseOldProbetraining:', result.error);
    autoCloseErrors.push(result.error);
  }

  if(result.ok){
    student.aktiv = 'NEIN';
  }
}

if (autoCloseErrors.length > 0) {
  showCustomMessage(
    'Einige Probetrainings konnten nicht automatisch archiviert werden. Bitte Admin prüfen.',
    autoCloseErrors.join('\n'),
    'warning'
  );
}

  // ── Sport-Kontext für Anwesenheit ──────────────────────────
  const groupSportId =
    enrichedStudents.find(s => s.sport_id)?.sport_id || null;
  const groupCfg = getSportConfig(groupSportId);
  applyWeightButtonVisibility(groupSportId);
  // ───────────────────────────────────────────────────────────

let html = `
<table class="attendance-table">
  <thead>
    <tr>
      <th></th>
      <th>Status<br>Vertrag</th>
      <th>Nachname</th>
      <th>Vorname</th>
      <th>Alter</th>
      ${groupCfg.showGraduation ? `<th>${groupCfg.graduationLabel}</th>` : ''}
      ${groupCfg.showBelt       ? `<th>${groupCfg.beltLabel}</th>`       : ''}
      ${groupCfg.showWeight     ? '<th>Gewicht</th>'                     : ''}
      <th>Trainer</th>
      <th>Rating</th>
      <th>Aktionen</th>
      <th>Kommentar</th>
    </tr>
  </thead>
  <tbody>
`;

  enrichedStudents
.filter(student => student.aktiv !== 'NEIN')
.forEach(function(student,index){

const statusIcon = getStudentStatusIcon(student);

const rowClass =
statusIcon === '⚠️'
? 'attendance-warning-row'
: '';

const genderClass = getGenderRowClass(student);

const showAttendanceCheckbox =
currentTrainer && currentTrainer.role === 'Trainer';

html += `
<tr class="${[rowClass, genderClass].filter(Boolean).join(' ')}">



<td>

${showAttendanceCheckbox ? `

<input
type="checkbox"
class="attendanceCheck"
data-student-id="${getStudentId(student)}"
data-vorname="${student.vorname || ''}"
data-nachname="${student.nachname || ''}"
${
todayAttendanceMap[String(student.id || '')] === 'JA' ||
todayAttendanceMap[String(student.student_id || '')] === 'JA'
? 'checked'
: ''
}
>

` : ''}

</td>

<td>${statusIcon} ${index+1}</td>

<td>${student.nachname || ''}</td>

<td>${student.vorname || ''}</td>

<td>${student.alter || '-'}</td>

${groupCfg.showGraduation ? `<td>${student.kyu_grad || '-'}</td>` : ''}
${groupCfg.showBelt       ? `<td>${student.guertelfarbe || '-'}</td>` : ''}
${groupCfg.showWeight     ? `<td>${student.aktuelles_gewicht ? student.aktuelles_gewicht + ' kg' : '-'}</td>` : ''}

<td>${student.trainersText || '-'}</td>

<td>🏆 ${student.calculatedRating || 0}</td>

<td>
  <div class="table-action-row">

  <button
    class="table-img-action-btn"
    onclick="editStudent('${getStudentId(student)}')"
    title="Schüler bearbeiten">
    <img src="${BUTTONS_URL}Stud_Edit.png" alt="Bearbeiten">
  </button>

  <button
    class="table-img-action-btn"
    onclick="toggleArchivePanel('${getStudentId(student)}')"
    title="Schüler löschen / archivieren">
    <img src="${BUTTONS_URL}Stud_Delete.png" alt="Löschen">
  </button>

  <button
    class="table-img-action-btn"
    onclick="showStudentStats('${getStudentId(student)}')"
    title="Statistik anzeigen">
    <img src="${BUTTONS_URL}Stud_Statistik.png" alt="Statistik">
  </button>

</div>
</td>

<td>
<button class="comment-btn">
Kommentar
</button>
</td>

</tr>
`;

});

  listBox.innerHTML = html;
}

async function saveAttendance() {
  const groupSelect = document.getElementById('groupSelect');
  const groupId = groupSelect ? groupSelect.value : '';

  if (!groupId) {
    showCustomMessage('Bitte zuerst eine Gruppe auswählen.');
    return;
  }

  const checks = document.querySelectorAll('.attendanceCheck');

  if (!checks || checks.length === 0) {
    showCustomMessage('Keine Schüler zum Speichern gefunden.');
    return;
  }

  const today = todayBerlin();

  const trainerName = currentTrainer ? currentTrainer.name : '';
  let savedCount = 0;

  const { data: groupData, error: groupError } = await db
    .from('groups')
    .select('sport_id')
    .eq('gruppe_id', groupId)
    .maybeSingle();

  if (groupError) {
    console.error(groupError);
    showCustomMessage('Fehler beim Laden der Sportart: ' + groupError.message);
    return;
  }

  const sportId = groupData?.sport_id || 'judo';

  const { data: allTodayAttendance, error: attendanceLoadError } = await db
    .from('attendance')
    .select('id, student_id')
    .eq('gruppe_id', groupId)
    .eq('datum', today);

  if (attendanceLoadError) {
    console.error(attendanceLoadError);
    showCustomMessage('Fehler beim Laden der Anwesenheit: ' + attendanceLoadError.message);
    return;
  }

  const existingMap = {};
  (allTodayAttendance || []).forEach(r => {
    existingMap[String(r.student_id)] = r;
  });

  for (const cb of checks) {
    const studentId = cb.dataset.studentId;

    const existing = existingMap[String(studentId)] || null;

    if (!cb.checked) {
      if (existing && existing.id) {
        const { error } = await db
          .from('attendance')
          .update({
            anwesenheit: 'NEIN',
            entschuldigt: 'NEIN',
            kommentar: '',
            trainer: trainerName
          })
          .eq('id', existing.id);

        if (error) {
          console.error(error);
          showCustomMessage('Fehler beim Speichern: ' + error.message);
          return;
        }
      }

      continue;
    }

    const payload = {
      datum: today,
      gruppe_id: groupId,
      student_id: studentId,
      vorname: cb.dataset.vorname || '',
      nachname: cb.dataset.nachname || '',
      anwesenheit: 'JA',
      entschuldigt: 'NEIN',
      kommentar: '',
      trainer: trainerName,
      sport_id: sportId,
      club_id: currentClub.club_id
    };

    let result;

    if (existing && existing.id) {
      result = await db
        .from('attendance')
        .update(payload)
        .eq('id', existing.id);
    } else {
      result = await db
        .from('attendance')
        .insert([payload]);
    }

    if (result.error) {
      console.error(result.error);
      showCustomMessage('Fehler beim Speichern: ' + result.error.message);
      return;
    }

    savedCount++;
  }

  document.getElementById('trainerTodayAttendanceCount').textContent =
    Array.from(checks).filter(cb => cb.checked).length;

  showCustomMessage('Anwesenheit gespeichert: ' + savedCount + ' Schüler.');
  await loadStudentsListForAttendance(groupId);
await loadTodayAttendanceCount(groupId);
}

function toggleArchivePanel(studentId){

const oldPanel =
document.getElementById(
'archivePanel_'+studentId
);

if(oldPanel){
oldPanel.remove();
return;
}

const rowButton =
event.target.closest('tr');

if(!rowButton) return;

const html = `

<tr
id="archivePanel_${studentId}"
class="archive-panel-row">

<td colspan="12">

<div class="archive-panel-box">

<div class="archive-title">
Schüler archivieren
</div>

<div class="archive-reasons">

<label class="archive-reason-option">
  <input
  type="radio"
  name="reason_${studentId}"
  value="Kündigung / Austritt"
  checked>
  <span>Kündigung / Austritt</span>
</label>

<label class="archive-reason-option">
  <input
  type="radio"
  name="reason_${studentId}"
  value="Längere Pause">
  <span>Längere Pause</span>
</label>

<label class="archive-reason-option">
  <input
  type="radio"
  name="reason_${studentId}"
  value="Doppelt angelegt">
  <span>Doppelt angelegt</span>
</label>

<label class="archive-reason-option">
  <input
  type="radio"
  name="reason_${studentId}"
  value="Sonstiges">
  <span>Sonstiges</span>
</label>

</div>

<input
id="archiveComment_${studentId}"
type="text"
placeholder="Kommentar optional">

<div class="archive-buttons">

<button
type="button"
onclick="closeArchivePanel('${studentId}')">
Abbrechen
</button>

<button
type="button"
onclick="archiveStudent('${studentId}')">
Archivieren
</button>

</div>

</div>

</td>

</tr>
`;

rowButton.insertAdjacentHTML(
'afterend',
html
);

}

function closeArchivePanel(studentId){

document
.getElementById(
'archivePanel_'+studentId
)
?.remove();

}

async function archiveStudent(id){

  const selectedReason = document.querySelector(
    `input[name="reason_${id}"]:checked`
  );

  if(!selectedReason){
    showCustomMessage('Bitte Grund auswählen.');
    return;
  }

  const archivGrund = selectedReason.value;

  const archivKommentar =
    document.getElementById('archiveComment_' + id)?.value.trim() || '';

  const {data: student, error: studentError} = await db
    .from('students')
    .select('*')
    .eq('id', id)
    .single();

  if(studentError || !student){
    console.error(studentError);
    showCustomMessage('Schüler nicht gefunden.');
    return;
  }

  document.getElementById('deleteConfirmText').innerHTML = `
    <div style="text-align:left;line-height:1.7;">
      <b>Schüler wirklich archivieren?</b><br><br>
      <b>Nachname:</b> ${student.nachname || '-'}<br>
      <b>Vorname:</b> ${student.vorname || '-'}<br>
      <b>Grund:</b> ${archivGrund || '-'}
    </div>
  `;

  document.getElementById('confirmDeleteBtn').onclick = async function(){

    closeDeleteConfirm();

    await archiveStudentConfirmed(
      id,
      student,
      archivGrund,
      archivKommentar
    );
  };

  document
    .getElementById('deleteConfirmOverlay')
    .classList.remove('hidden');
}

async function archiveStudentConfirmed(id, student, archivGrund, archivKommentar){

  const today = todayBerlin();

  const kommentarText =
    (student.kommentar || '') +
    (archivKommentar ? ' | Archiv-Kommentar: ' + archivKommentar : '') +
    ' | Archiviert am ' + today +
    ' | Grund: ' + archivGrund;

  const archivPayload = {
    student_id: student.student_id || '',
    vorname: student.vorname || '',
    nachname: student.nachname || '',
    geburtsdatum: student.geburtsdatum || null,
    alter: student.alter || null,
    gruppe_id: student.gruppe_id || '',
    trainer: student.trainer || '',
    kyu_grad: student.kyu_grad || '',
    guertelfarbe: student.guertelfarbe || '',
    aktiv: 'NEIN',
    telefon: student.telefon || '',
    email: student.email || '',
    kommentar: kommentarText,
    austrittsdatum: today,
    austrittsgrund: archivGrund,
    probetraining_status: student.probetraining_status || '',
    probetraining_start: student.probetraining_start || null,
    probetraining_ende: student.probetraining_ende || null,
    buchhaltung_relevant: student.buchhaltung_relevant || '',
    wiederkehrer: student.wiederkehrer || '',
    aktuelles_gewicht: student.aktuelles_gewicht || null,
    foto_url: student.foto_url || '',
    archiv_datum: today,
    archiv_grund: archivGrund,
    buchhaltung_datum: student.buchhaltung_datum || null,
    club_id: currentClub.club_id
  };

  const { error: archivError } = await db
    .from('archiv')
    .insert([archivPayload]);

  if (archivError) {
    console.error('[Archive] Archiv INSERT fehlgeschlagen:', archivError);
    // Weiter mit students-Update trotzdem — damit Deaktivierung nicht blockiert wird
    showCustomMessage('Warnung: Archiv-Eintrag fehlgeschlagen (' + archivError.message + '). Schüler wird trotzdem deaktiviert.');
  }

  const { data: updatedRows, error: updateError } = await db
    .from('students')
    .update({
      aktiv: 'NEIN',
      kommentar: kommentarText
    })
    .eq('id', student.id)
    .select('id');

  if (updateError) {
    console.error('[Archive] students UPDATE fehlgeschlagen:', updateError);
    showCustomMessage('Fehler beim Deaktivieren: ' + updateError.message);
    return;
  }

  if (!updatedRows || updatedRows.length === 0) {
    console.warn('[Archive] students UPDATE hat 0 Zeilen geändert — RLS aktiv oder id nicht gefunden?');
    showCustomMessage('Fehler: Schüler konnte nicht deaktiviert werden (0 Zeilen). Bitte SQL-RLS prüfen.');
    return;
  }

  closeArchivePanel(id);

  // Beide möglichen Schülerlisten aktualisieren (Admin- und Trainer-View)
  const adminContainer   = document.getElementById('adminStudentStatsResult');
  const trainerContainer = document.getElementById('trainerStudentsList');

  if (adminContainer) {
    await applyAdminStudentFilter();
    await loadAdminStudentCount();   // Gesamt-Schüler-Counter sofort aktualisieren
  }
  if (trainerContainer) await applyTrainerFilters();

  showCustomMessage('Schüler wurde archiviert und deaktiviert.');
}

async function loadTodayAttendanceCount(groupId) {
  const countBox = document.getElementById('trainerTodayAttendanceCount');

  if (!countBox || !groupId) return;

  const today = todayBerlin();

  const { data, error } = await db
    .from('attendance')
    .select('student_id, datum, anwesenheit')
    .eq('gruppe_id', groupId)
    .eq('anwesenheit', 'JA');

  if (error) {
    console.error(error);
    countBox.textContent = '0';
    return;
  }

  const uniqueStudents = new Set();

  (data || []).forEach(row => {
    const rowDate = String(row.datum || '').slice(0, 10);

    if (rowDate === today && row.student_id) {
      uniqueStudents.add(row.student_id);
    }
  });

  countBox.textContent = uniqueStudents.size;
}

function getStudentRating(student) {
  return student.calculatedRating || student.rating || student.trainingsgesamt || student.trainings_gesamt || 0;
}

function getGenderRowClass(student) {
  const raw = String(
    student.geschlecht || student.Geschlecht || ''
  ).toLowerCase().trim();
  if (raw === 'männlich' || raw === 'maennlich' || raw === 'mannlich') {
    return 'student-row-male';
  }
  if (raw === 'weiblich') {
    return 'student-row-female';
  }
  return 'student-row-other';
}

function getStudentStatusIcon(student){

const contract = String(
student.vertrag_status ||
student.vertragStatus ||
''
).toUpperCase();

const probe = String(
student.probetraining_status ||
student.probetrainingStatus ||
''
).toUpperCase();

const relevant = String(
student.buchhaltung_relevant ||
student.buchhaltungRelevant ||
'JA'
).toUpperCase();

const daysSince = student.daysSinceLastAttendance;
const trainings = Number(student.calculatedRating || 0);


// договор OK — всегда зелёный
if(
contract === 'OK' ||
contract === 'JA' ||
contract === 'SIGNED'
){
return '🟢';
}


// старый пробник / не относится к бухгалтерии
if(relevant === 'NEIN'){
return '⚪';
}

if(probe === 'BEENDET'){
return '⚪';
}


// предупреждение для обычных учеников
if(
daysSince !== null &&
daysSince > 15 &&
trainings > 3 &&
contract === 'OFFEN'
){
return '⚠️';
}


// активный пробный период
if(probe === 'AKTIV'){
return '🟡';
}


// договор открыт / отсутствует
if(
contract === 'OFFEN' ||
contract === '' ||
contract === 'NULL'
){
return '🔴';
}

return '🔴';

}

async function autoCloseOldProbetraining(student){

const contract = String(student.vertrag_status || '').toUpperCase();
const probe = String(student.probetraining_status || '').toUpperCase();
const daysSince = student.daysSinceLastAttendance;
const trainings = Number(student.calculatedRating || 0);

if(
  probe === 'AKTIV' &&
  contract === 'OFFEN' &&
  trainings <= 3 &&
  daysSince !== null &&
  daysSince > 15
){

const today = todayBerlin();

const archivGrund = 'Probetraining beendet';

const kommentarText =
  (student.kommentar || '') +
  ' | Automatisch archiviert am ' + today +
  ' | Grund: ' + archivGrund +
  ' | Nach max. 3 Probetrainings länger als 15 Tage nicht erschienen.';

const archivPayload = {
  student_id: student.student_id || String(student.id || ''),
  vorname: student.vorname || '',
  nachname: student.nachname || '',
  geburtsdatum: student.geburtsdatum || null,
  alter: student.alter || null,
  gruppe_id: student.gruppe_id || '',
  trainer: student.trainer || '',
  kyu_grad: student.kyu_grad || '',
  guertelfarbe: student.guertelfarbe || '',
  aktiv: 'NEIN',
  telefon: student.telefon || '',
  email: student.email || '',
  kommentar: kommentarText,
  austrittsdatum: today,
  austrittsgrund: archivGrund,
  buchhaltung_status: student.buchhaltung_status || '',
  buchhaltung_informiert_am: student.buchhaltung_informiert_am || null,
  vertragsende_bestaetigt_am: student.vertragsende_bestaetigt_am || null,
  buchhaltung_geprueft_von: student.buchhaltung_geprueft_von || '',
  probetraining_status: 'BEENDET',
  probetraining_start: student.probetraining_start || null,
  probetraining_ende: today,
  buchhaltung_relevant: 'NEIN',
  wiederkehrer: student.wiederkehrer || '',
  aktuelles_gewicht: student.aktuelles_gewicht || null,
  foto_url: student.foto_url || '',
  archiv_datum: today,
  archiv_grund: archivGrund,
  buchhaltung_datum: student.buchhaltung_datum || null,
  club_id: currentClub.club_id
};

const { error: archivError } = await db
  .from('archiv')
  .insert([archivPayload]);

if(archivError){
  console.error(archivError);
  return { ok: false, error: 'Archiv-Fehler für ' + (student.nachname || '?') + ': ' + archivError.message };
}

const { error } = await db
  .from('students')
  .update({
    aktiv:'NEIN',
    buchhaltung_relevant:'NEIN',
    probetraining_status:'BEENDET',
    probetraining_ende: today,
    kommentar: kommentarText
  })
  .eq('id', getStudentId(student));

if(error){
  console.error(error);
  return { ok: false, error: 'Update-Fehler für ' + (student.nachname || '?') + ': ' + error.message };
}

return { ok: true };

}

return { ok: false };

}

async function calculateStudentRating(studentId, externalPossibleIds) {

  let possibleIds;

  if (externalPossibleIds) {
    possibleIds = externalPossibleIds;
  } else {
    possibleIds = [String(studentId || '')];

    const { data: studentData } = await db
      .from('students')
      .select('id, student_id')
      .eq('id', studentId)
      .maybeSingle();

    if(studentData){
      possibleIds.push(String(studentData.id || ''));
      possibleIds.push(String(studentData.student_id || ''));
    }

    possibleIds = [...new Set(possibleIds.filter(Boolean))];
  }

  const { data, error } = await db
    .from('attendance')
    .select('student_id, gruppe_id, datum, anwesenheit')
    .in('student_id', possibleIds);

  if (error) {
    console.error(error);
    return 0;
  }

  const uniqueVisits = {};

  (data || []).forEach(row => {

    const sameStudent =
      possibleIds.includes(String(row.student_id || ''));

    const isPresent =
      String(row.anwesenheit || '').toUpperCase() === 'JA';

    if(!sameStudent || !isPresent) return;

    const dateKey =
      String(row.datum || '').slice(0, 10);

    if(!dateKey) return;

    const key =
      String(row.student_id) + '_' +
      String(row.gruppe_id) + '_' +
      dateKey;

    uniqueVisits[key] = true;
  });

  return Object.keys(uniqueVisits).length;
}

async function getStudentLastAttendanceInfo(studentId, externalPossibleIds){

  let possibleIds;

  if (externalPossibleIds) {
    possibleIds = externalPossibleIds;
  } else {
    possibleIds = [String(studentId || '')];

    const { data: studentData } = await db
      .from('students')
      .select('id, student_id')
      .eq('id', studentId)
      .maybeSingle();

    if(studentData){
      possibleIds.push(String(studentData.id || ''));
      possibleIds.push(String(studentData.student_id || ''));
    }

    possibleIds = [...new Set(possibleIds.filter(Boolean))];
  }

  const { data, error } = await db
    .from('attendance')
    .select('student_id, datum, anwesenheit')
    .in('student_id', possibleIds);

  if(error){
    console.error(error);
    return {
      lastDate:null,
      daysSince:null
    };
  }

  const dates = (data || [])
    .filter(row => {
      return (
        possibleIds.includes(String(row.student_id || '')) &&
        String(row.anwesenheit || '').toUpperCase() === 'JA'
      );
    })
    .map(row => String(row.datum || '').slice(0,10))
    .filter(Boolean)
    .sort();

  if(dates.length === 0){
    return {
      lastDate:null,
      daysSince:null
    };
  }

  const lastDate = dates[dates.length - 1];

  const today = new Date(
    new Date().toLocaleDateString('sv-SE', {
      timeZone:'Europe/Berlin'
    })
  );

  const last = new Date(lastDate);

  const diffMs = today - last;

  const daysSince =
    Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return {
    lastDate,
    daysSince
  };
}

function calculateStudentRatingFromRows(possibleIds, data) {
  const uniqueVisits = {};

  (data || []).forEach(row => {
    const sameStudent =
      possibleIds.includes(String(row.student_id || ''));

    const isPresent =
      String(row.anwesenheit || '').toUpperCase() === 'JA';

    if (!sameStudent || !isPresent) return;

    const dateKey =
      String(row.datum || '').slice(0, 10);

    if (!dateKey) return;

    const key =
      String(row.student_id) + '_' +
      String(row.gruppe_id) + '_' +
      dateKey;

    uniqueVisits[key] = true;
  });

  return Object.keys(uniqueVisits).length;
}

function getStudentLastAttendanceInfoFromRows(possibleIds, data) {
  const dates = (data || [])
    .filter(row => {
      return (
        possibleIds.includes(String(row.student_id || '')) &&
        String(row.anwesenheit || '').toUpperCase() === 'JA'
      );
    })
    .map(row => String(row.datum || '').slice(0, 10))
    .filter(Boolean)
    .sort();

  if (dates.length === 0) {
    return { lastDate: null, daysSince: null };
  }

  const lastDate = dates[dates.length - 1];

  const today = new Date(
    new Date().toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Berlin'
    })
  );

  const last = new Date(lastDate);
  const diffMs = today - last;
  const daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return { lastDate, daysSince };
}

function buildGroupsHtml(groups, requestedIds) {
  const foundIds = new Set(groups.map(g => String(g.gruppe_id)));
  const parts = groups.map(g => {
    const name = escapeHtml(String(g.gruppenname || g.gruppe_id));
    if (String(g.aktiv || '').toUpperCase() !== 'JA') {
      return `<span class="gruppe-geloescht-name">${name}</span> <span class="gruppe-geloescht-label">(gelöscht)</span>`;
    }
    return name;
  });
  (requestedIds || []).forEach(id => {
    if (!foundIds.has(String(id))) {
      parts.push(`<span class="gruppe-geloescht-name">${escapeHtml(String(id))}</span> <span class="gruppe-geloescht-label">(gelöscht)</span>`);
    }
  });
  return parts.join(', ') || '-';
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function getStudentFullData(studentId, externalGroupData, externalStudentData){

let student;

if(externalStudentData){
  student = externalStudentData;
} else {
  const { data, error } = await db
  .from('students')
  .select('*')
  .eq('id', studentId)
  .single();

  if(error || !data){
  console.error(error);
  return null;
  }

  student = data;
}

if(student.geburtsdatum){
const birth = new Date(student.geburtsdatum);
const today = new Date();

let age = today.getFullYear() - birth.getFullYear();
const m = today.getMonth() - birth.getMonth();

if(m < 0 || (m === 0 && today.getDate() < birth.getDate())){
age--;
}

student.alter = age;
}

const possibleIds = [...new Set([
  String(student.id || ''),
  String(student.student_id || '')
].filter(Boolean))];

const { data: attendanceRows } = await db
  .from('attendance')
  .select('student_id, gruppe_id, datum, anwesenheit')
  .in('student_id', possibleIds)
  .eq('club_id', currentClub.club_id);

const calculatedRating =
  calculateStudentRatingFromRows(possibleIds, attendanceRows || []);

const lastAttendanceInfo =
  getStudentLastAttendanceInfoFromRows(possibleIds, attendanceRows || []);

const groupIds = String(student.gruppe_id || '')
.split(/[;,]/)
.map(x => x.trim())
.filter(Boolean);

let groups = [];
let trainers = [];

if (externalGroupData) {
  groups = externalGroupData.groups || [];
  trainers = externalGroupData.trainers || [];
} else if(groupIds.length){

const { data: groupData, error: groupDataError } = await db
.from('groups')
.select('gruppe_id, gruppenname, aktiv')
.in('gruppe_id', groupIds)
.eq('club_id', currentClub.club_id);

if (groupDataError) {
  console.error('getStudentFullData groups error:', groupDataError);
}

groups = groupData || [];

const { data: trainerData, error: trainerDataError } = await db
.from('trainer_groups')
.select('trainer_name')
.in('gruppe_id', groupIds)
.eq('club_id', currentClub.club_id);

if (trainerDataError) {
  console.error('getStudentFullData trainer_groups error:', trainerDataError);
}

trainers = [...new Set(
(trainerData || [])
.map(x => x.trainer_name)
.filter(Boolean)
)];
}

return {
...student,
calculatedRating,
lastAttendanceDate: lastAttendanceInfo.lastDate,
daysSinceLastAttendance: lastAttendanceInfo.daysSince,
groupsText: groups.map(g => g.gruppenname || g.gruppe_id).join(', ') || '-',
groupsHtml: buildGroupsHtml(groups, groupIds),
trainersText: trainers.join(', ') || '-'
};

}

function formatDateDE(dateValue){
if(!dateValue) return '-';
return new Date(dateValue).toLocaleDateString('de-DE');
}

function getTrainingDurationText(dateValue){
if(!dateValue) return '-';

const start = new Date(dateValue);
const today = new Date();

let years = today.getFullYear() - start.getFullYear();
let months = today.getMonth() - start.getMonth();
let days = today.getDate() - start.getDate();

if(days < 0){
months--;
const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
days += prevMonth.getDate();
}

if(months < 0){
years--;
months += 12;
}

const parts = [];

if(years > 0) parts.push(years + ' Jahr' + (years > 1 ? 'e' : ''));
if(months > 0) parts.push(months + ' Monat' + (months > 1 ? 'e' : ''));
if(days > 0 || parts.length === 0) parts.push(days + ' Tage');

return parts.join(' ');
}

function buildStudentInfoHtml(student){

const cfg = getSportConfig(student.sport_id);

const studentName =
(student.vorname || '') + ' ' + (student.nachname || '');

const genderIconMap = {
  'Männlich': '♂',
  'Weiblich': '♀',
  'Divers':   '⚧'
};
const genderIcon = genderIconMap[student.geschlecht] || '';

const entryDate =
  student.eintrittsdatum ||
  student.probetraining_start ||
  student.created_at ||
  null;

const photoHtml = student.foto_url
? `
<div class="student-photo-wrapper">
  <img src="${student.foto_url}" class="student-photo-large">
</div>
`
: `
<div class="student-avatar">👤</div>
`;

return `

<div class="student-stats-card">

  <div class="student-hero">

    ${photoHtml}

    <div>
      <div class="student-name">
        ${studentName}${genderIcon ? `<span class="gender-badge">${genderIcon}</span>` : ''}
      </div>

      <div class="student-badges">
        <span class="student-badge badge-blue">Alter: ${student.alter || '-'}</span>
        ${cfg.showGraduation ? `<span class="student-badge badge-purple">${cfg.graduationLabel}: ${student.kyu_grad || '-'}</span>` : ''}
        ${cfg.showBelt       ? `<span class="student-badge badge-green">${cfg.beltLabel}: ${student.guertelfarbe || '-'}</span>` : ''}
        <span class="student-badge badge-green">Gruppe: ${student.groupsHtml || student.groupsText || '-'}</span>
        <span class="student-badge badge-orange">Trainer: ${student.trainersText || '-'}</span>
      </div>

      <div style="margin-top:10px;font-weight:700;">
        📞 ${student.telefon || '-'} &nbsp;&nbsp;
        ✉️ ${student.email || '-'}
      </div>
    </div>

  </div>

  <div class="training-cards">

    <div class="training-card card-week">
      <div class="training-icon">🗓️</div>
      <div>
        <div class="training-title">Trainings Woche</div>
        <div class="training-number">${student.trainingsWoche || 0}</div>
      </div>
    </div>

    <div class="training-card card-month">
      <div class="training-icon">🗓️</div>
      <div>
        <div class="training-title">Trainings Monat</div>
        <div class="training-number">${student.trainingsMonat || 0}</div>
      </div>
    </div>

    <div class="training-card card-year">
      <div class="training-icon">🗓️</div>
      <div>
        <div class="training-title">Trainings Jahr</div>
        <div class="training-number">${student.trainingsJahr || 0}</div>
      </div>
    </div>

    <div class="training-card card-rating">
      <div class="training-icon">🏆</div>
      <div>
        <div class="training-title">Rating</div>
        <div class="training-number">${student.calculatedRating || 0}</div>
      </div>
    </div>

  </div>

  <div class="personal-info-card">

    <div class="personal-info-title">Persönliche Informationen</div>

        <div class="personal-info-grid">

      <div class="personal-info-row">
        <div class="personal-info-icon">🗓️</div>
        <div>
          <div class="personal-info-label">Eintrittsdatum</div>
          <div class="personal-info-value">${formatDateDE(entryDate)}</div>
        </div>
      </div>

      <div class="personal-info-row">
        <div class="personal-info-icon">📋</div>
        <div>
          <div class="personal-info-label">Trainings gesamt</div>
          <div class="personal-info-value">${student.trainingsGesamt || 0}</div>
        </div>
      </div>

      <div class="personal-info-row">
        <div class="personal-info-icon">🕒</div>
        <div>
          <div class="personal-info-label">Trainingsdauer</div>
          <div class="personal-info-value">${getTrainingDurationText(entryDate)}</div>
        </div>
      </div>

      ${cfg.showWeight ? `
      <div class="personal-info-row">
        <div class="personal-info-icon">⚖️</div>
        <div>
          <div class="personal-info-label">Gewicht</div>
          <div class="personal-info-value">${student.aktuelles_gewicht || '-'}</div>
        </div>
      </div>
      ` : ''}

    </div>

    </div>

  </div>

</div>

`;

}

async function editStudent(studentId){

  

 const visibleScreensForEdit = [
'adminStudentScreen',
'orphanStudentsScreen',
'groupScreen',
'attendanceScreen',
'trainerAdminScreen',
'clubStatistikScreen',
'buchhaltungScreen'
];

previousScreenBeforeEditStudent =
visibleScreensForEdit.find(screenId=>{
const el=document.getElementById(screenId);
return el && !el.classList.contains('hidden');
}) || null;

const { data: student, error } = await db
.from('students')
.select('*')
.eq('id', studentId)
.single();

if(error || !student){
showCustomMessage('Schüler nicht gefunden');
return;
}

openEditStudentForm(student);

}

async function loadStudentPhotosForEditStudent(student){

const select = document.getElementById('editPhotoSelect');
if(!select) return;

select.innerHTML = '<option value="">Foto auswählen...</option>';

const vorname = String(student.vorname || '').toLowerCase().trim();
const nachname = String(student.nachname || '').toLowerCase().trim();

const { data, error } = await db.storage
.from('student-photos')
.list('', { limit: 100 });

if(error){
console.error('Storage Fehler:', error);
return;
}

let foundCount = 0;

(data || []).forEach(file => {

const originalName = file.name || '';

const fileName = String(originalName)
.toLowerCase()
.replace(/\.(jpg|jpeg|png|webp)$/,'')
.trim();

const match =
fileName.includes(vorname) ||
fileName.includes(nachname) ||
fileName.includes(`${nachname} ${vorname}`) ||
fileName.includes(`${vorname} ${nachname}`);

if(match){

const { data: publicUrlData } = db.storage
.from('student-photos')
.getPublicUrl(originalName);

const publicUrl = publicUrlData?.publicUrl || '';
if(!publicUrl) return;

select.innerHTML += `
<option value="${publicUrl}">
${originalName}
</option>
`;

foundCount++;
}

});

console.log('Gefundene Fotos:', foundCount);

}

async function loadGroupsAndTrainersForEditStudent(student){

const gruppeSelect =
document.getElementById('editGruppe');

const trainerSelect =
document.getElementById('editTrainer');

if(!gruppeSelect || !trainerSelect) return;


// группы
let groupsQuery = db
.from('groups')
.select('*')
.eq('aktiv','JA');

if(student.sport_id){
  groupsQuery = groupsQuery.eq('sport_id', student.sport_id);
}

const { data: groups } = await groupsQuery.order('gruppenname');


// тренеры
let trainersQuery = db
.from('trainers')
.select('*')
.eq('aktiv','JA')
.eq('rolle','Trainer');

if(student.sport_id){
  trainersQuery = trainersQuery.eq('sport_id', student.sport_id);
}

const { data: trainers } = await trainersQuery.order('name');

gruppeSelect.innerHTML =
'<option value="">Gruppe wählen...</option>';

trainerSelect.innerHTML =
'<option value="">Trainer wählen...</option>';

(groups || []).forEach(g=>{

gruppeSelect.innerHTML += `

<option value="${g.gruppe_id}"
${student.gruppe_id===g.gruppe_id?'selected':''}>

${g.gruppenname}

</option>`;

});

(trainers || []).forEach(t=>{

trainerSelect.innerHTML += `

<option value="${t.trainer_id}">

${t.name}

</option>`;

});

}

async function syncEditTrainerFromGroup(){

const gruppeId =
document.getElementById('editGruppe')?.value || '';

const trainerSelect =
document.getElementById('editTrainer');

if(!trainerSelect)return;

trainerSelect.innerHTML =
'<option value="">Trainer wählen...</option>';

if(!gruppeId)return;

const {data,error}=await db
.from('trainer_groups')
.select('trainer_id, trainer_name')
.eq('gruppe_id', gruppeId);

if(error){
console.error(error);
return;
}

(data || []).forEach(row=>{

trainerSelect.innerHTML += `
<option value="${row.trainer_id}">
${row.trainer_name || row.trainer_id}
</option>
`;

});

}

async function syncEditGroupFromTrainer(){

const trainerId =
document.getElementById('editTrainer')?.value || '';

const gruppeSelect =
document.getElementById('editGruppe');

if(!gruppeSelect)return;

gruppeSelect.innerHTML =
'<option value="">Gruppe wählen...</option>';

if(!trainerId)return;

const {data,error}=await db
.from('trainer_groups')
.select('gruppe_id, gruppenname')
.eq('trainer_id', trainerId);

if(error){
console.error(error);
return;
}

(data || []).forEach(row=>{

gruppeSelect.innerHTML += `
<option value="${row.gruppe_id}">
${row.gruppenname || row.gruppe_id}
</option>
`;

});

}

function selectEditStudentPhoto(){

const select =
document.getElementById('editPhotoSelect');

const input =
document.getElementById('editFotoUrl');

if(!select || !input) return;

input.value = select.value || '';

updateEditStudentPhotoPreview();

}

function updateEditStudentPhotoPreview(){

const input =
document.getElementById('editFotoUrl');

const img =
document.getElementById('editStudentPhotoPreview');

if(!input || !img) return;

const url = input.value.trim();

if(!url){
img.src = '';
img.style.display = 'none';
return;
}

if(!url.startsWith('https://') && !url.startsWith('http://')){
img.src = '';
img.style.display = 'none';
return;
}

const afterProtocol = url.slice(url.indexOf('://') + 3);
if(!afterProtocol.includes('/')){
img.src = '';
img.style.display = 'none';
return;
}

img.src = url;
img.style.display = 'block';

}

function openEditStudentForm(student){

hideAllWorkScreens();

document
.getElementById('addStudentScreen')
.classList.remove('hidden');

const formBox =
document.getElementById('addStudentForm');

formBox.innerHTML = `

<div class="add-student-form-box">

<h3>Teilnehmer bearbeiten</h3>

<div class="student-form-grid">

<div>
<label>Nachname</label>
<input id="editNachname"
value="${student.nachname || ''}">
</div>

<div>
<label>Vorname</label>
<input id="editVorname"
value="${student.vorname || ''}">
</div>

<div>
<label>Geschlecht</label>
<select id="editGeschlecht">
  <option value="Keine Angabe" ${(student.geschlecht || 'Keine Angabe') === 'Keine Angabe' ? 'selected' : ''}>Keine Angabe</option>
  <option value="Männlich" ${student.geschlecht === 'Männlich' ? 'selected' : ''}>Männlich</option>
  <option value="Weiblich" ${student.geschlecht === 'Weiblich' ? 'selected' : ''}>Weiblich</option>
  <option value="Divers" ${student.geschlecht === 'Divers' ? 'selected' : ''}>Divers</option>
</select>
</div>

<div>
<label>Geburtsdatum</label>
<input
id="editGeburtsdatum"
type="date"
value="${student.geburtsdatum || ''}">
</div>

<div>
<label>Aktuelles Gewicht</label>
<input
id="editGewicht"
value="${student.aktuelles_gewicht || ''}">
</div>

<div>
<label>Gruppe</label>
<select
id="editGruppe"
onchange="syncEditTrainerFromGroup()">
</select>
</div>

<div>
<label>Trainer</label>
<select
id="editTrainer"
onchange="syncEditGroupFromTrainer()">
</select>
</div>

<div>
<label>Kyu-Grad</label>
<select
id="editKyu"
onchange="syncEditObiFromKyu()">
</select>
</div>

<div>
<label>OBI / Gürtelfarbe</label>
<select
id="editObi"
onchange="syncEditKyuFromObi()">
</select>
</div>

<div>
<label>Telefon</label>
<input
id="editTelefon"
value="${student.telefon || ''}">
</div>

<div>
<label>E-Mail</label>
<input
id="editEmail"
value="${student.email || ''}">
</div>

</div>

<label>Foto aus Supabase Storage</label>

<select
id="editPhotoSelect"
onchange="selectEditStudentPhoto()">
<option value="">Foto auswählen...</option>
</select>

<label>FotoURL</label>

<input
id="editFotoUrl"
value="${student.foto_url || ''}"
oninput="updateEditStudentPhotoPreview()">

<label>Foto Vorschau</label>

<div class="photo-preview-box">

<img
id="editStudentPhotoPreview"
class="photo-preview-img"
src="${student.foto_url || ''}">

</div>

<label>Kommentar</label>

<input
id="editKommentar"
value="${student.kommentar || ''}">

<button
class="save"
onclick="saveEditedStudent(${student.id})">

Speichern

</button>

<button
class="cancel"
onclick="cancelStudentEditForm()">

Abbrechen

</button>

</div>
`;

loadKyuObiOptionsForEditStudent(
student.kyu_grad,
student.guertelfarbe
);

loadGroupsAndTrainersForEditStudent(student);

loadStudentPhotosForEditStudent(student);
updateEditStudentPhotoPreview();

}

async function loadKyuObiOptionsForEditStudent(currentKyu, currentObi){

await ensureKyuObiLookup();

const kyuSelect = document.getElementById('editKyu');
const obiSelect = document.getElementById('editObi');

if(!kyuSelect || !obiSelect) return;

kyuSelect.innerHTML = '';
obiSelect.innerHTML = '';

kyuObiLookup.forEach(row => {

kyuSelect.innerHTML += `
<option value="${row.kyu_grad}">
${row.kyu_grad}
</option>`;

obiSelect.innerHTML += `
<option value="${row.guertelfarbe}">
${row.guertelfarbe}
</option>`;

});

kyuSelect.value = currentKyu || '';
obiSelect.value = currentObi || '';

if(!obiSelect.value){
syncEditObiFromKyu();
}

}

function syncEditObiFromKyu(){

const kyu = document.getElementById('editKyu')?.value;
const obiSelect = document.getElementById('editObi');

if(!kyu || !obiSelect) return;

const row = kyuObiLookup.find(r => r.kyu_grad === kyu);

if(row){
obiSelect.value = row.guertelfarbe;
}

}

function syncEditKyuFromObi(){

const obi = document.getElementById('editObi')?.value;
const kyuSelect = document.getElementById('editKyu');

if(!obi || !kyuSelect) return;

const row = kyuObiLookup.find(r => r.guertelfarbe === obi);

if(row){
kyuSelect.value = row.kyu_grad;
}

}

async function showStudentStats(id){
  


const visibleScreens = [
  'adminStudentScreen',
  'attendanceScreen',
  'groupScreen',
  'adminScreen',
  'buchhaltungScreen',
  'clubStatistikScreen',
  'groupOverviewScreen',
  'adminStatistikScreen',
  'adminBuchhaltungScreen',
  'trainerAdminScreen'
];

if(currentView==='orphanStudents'){

previousScreenBeforeStats =
'orphanStudentsScreen';

}else{

previousScreenBeforeStats =
visibleScreens.find(screenId => {

const el =
document.getElementById(screenId);

return el &&
!el.classList.contains('hidden');

}) || null;

}

currentView='studentStats';

hideAllWorkScreens();

document
.getElementById('studentStatsScreen')
.classList.remove('hidden');

const box = document.getElementById('studentStatsBox');

if(box){
  box.innerHTML = 'Daten werden geladen...';
}

const html = await buildStudentStatsHtml(id);

if(box){
  box.innerHTML = html;
}

}

async function buildStudentStatsHtml(id){

const student = await getStudentFullData(id);

if(!student){
return 'Schüler nicht gefunden';
}

const possibleStudentIds = [
String(student.id || ''),
String(student.student_id || '')
].filter(Boolean);

const { data, error } = await db
.from('attendance')
.select('student_id, gruppe_id, datum, anwesenheit')
.in('student_id', possibleStudentIds);

if(error){
console.error(error);
return 'Fehler beim Laden der Statistik.';
}

const rows = (data || []).filter(row => {

const attendanceStudentId =
String(row.student_id || '');

const isSameStudent =
possibleStudentIds.includes(attendanceStudentId);

const isPresent =
String(row.anwesenheit || '').toUpperCase() === 'JA';

return isSameStudent && isPresent;

});

const unique = {};

rows.forEach(row => {

const dateKey =
String(row.datum || '').slice(0,10);

if(!dateKey) return;

const key =
String(row.student_id) + '|' +
String(row.gruppe_id) + '|' +
dateKey;

unique[key] = row;

});

const attendance =
Object.values(unique);

const now = new Date();

const currentYear = now.getFullYear();
const currentMonth = now.getMonth();

const startOfWeek = new Date(now);
const day = startOfWeek.getDay() || 7;

startOfWeek.setDate(startOfWeek.getDate() - day + 1);
startOfWeek.setHours(0,0,0,0);

let trainingsWoche = 0;
let trainingsMonat = 0;
let trainingsJahr = 0;

attendance.forEach(row => {

const dateText =
String(row.datum || '').slice(0,10);

const d = new Date(dateText);

if(isNaN(d.getTime())) return;

if(d >= startOfWeek){
trainingsWoche++;
}

if(
d.getFullYear() === currentYear &&
d.getMonth() === currentMonth
){
trainingsMonat++;
}

if(d.getFullYear() === currentYear){
trainingsJahr++;
}

});

student.trainingsWoche = trainingsWoche;
student.trainingsMonat = trainingsMonat;
student.trainingsJahr = trainingsJahr;
student.trainingsGesamt = attendance.length;
student.calculatedRating = attendance.length;

return buildStudentInfoHtml(student);

}

async function openAddStudentForm(){

hideAllWorkScreens();

document
.getElementById('addStudentScreen')
.classList.remove('hidden');

const groupSelect = document.getElementById('groupSelect');
const groupId = groupSelect?.value || '';

// sport_id für sport-spezifische Felder und Rank/Belt-Mapping
let formSportId = String(currentTrainer?.sport_id || selectedLoginContext?.sportId || '')
  .split(/[;,]/)[0].trim() || null;
if (!formSportId && groupId) {
  const { data: grp } = await db
    .from('groups').select('sport_id').eq('gruppe_id', groupId).maybeSingle();
  formSportId = grp?.sport_id || null;
}

const formCfg = getSportConfig(formSportId);
const formBox = document.getElementById('addStudentForm');

formBox.innerHTML = `
<div class="add-student-form-box">

<h3>Neuen Teilnehmer hinzufügen</h3>

<div class="student-form-grid">

<div>
<label>Nachname</label>
<input id="newNachname" placeholder="Nachname">
</div>

<div>
<label>Vorname</label>
<input id="newVorname" placeholder="Vorname">
</div>

<div>
<label>Geschlecht</label>
<select id="newGeschlecht">
  <option value="Keine Angabe">Keine Angabe</option>
  <option value="Männlich">Männlich</option>
  <option value="Weiblich">Weiblich</option>
  <option value="Divers">Divers</option>
</select>
</div>

<div>
<label>Geburtsdatum</label>

<div class="birthdate-row">

  <input
    id="newGeburtTag"
    type="number"
    min="1"
    max="31"
    placeholder="Tag">

  <span class="date-dot">.</span>

  <input
    id="newGeburtMonat"
    type="number"
    min="1"
    max="12"
    placeholder="Monat">

  <span class="date-dot">.</span>

  <input
    id="newGeburtJahr"
    type="number"
    min="1900"
    max="2100"
    placeholder="Jahr">

</div>

</div>

<div>
<label>Aktuelles Gewicht</label>
<input id="newGewicht" type="number" placeholder="kg">
</div>

<div>
<label>${formCfg.graduationLabel}</label>
<select id="newKyu" onchange="syncNewObiFromKyu()"></select>
</div>

<div>
<label>${formCfg.beltLabel}</label>
<select id="newObi" onchange="syncNewKyuFromObi()"></select>
</div>

<div>
<label>Telefon</label>
<input id="newTelefon" placeholder="Telefon">
</div>

<div>
<label>E-Mail</label>
<input id="newEmail" placeholder="E-Mail">
</div>

</div>

<label>Foto aus Supabase Storage</label>
<select
id="newPhotoSelect"
onchange="selectNewStudentPhoto()">
<option value="">Foto auswählen...</option>
</select>

<label>FotoURL</label>
<input
id="newFotoUrl"
placeholder="Google Drive Foto-Link optional"
oninput="updateNewStudentPhotoPreview()">

<label>Foto Vorschau</label>
<div class="photo-preview-box">
  <img
    id="newStudentPhotoPreview"
    class="photo-preview-img"
    src=""
    alt=""
  >
</div>

<label>Kommentar</label>
<input id="newKommentar" placeholder="Kommentar">

<button
class="save"
onclick="showPromoTransition(()=>saveNewStudent('${groupId}'))">
Speichern
</button>

<button
class="cancel"
onclick="showPromoTransition(()=>cancelAddStudentForm('${groupId}'))">
Abbrechen
</button>

</div>
`;

await loadKyuObiOptionsForNewStudent(formSportId);

}

async function cancelAddStudentForm(groupId){

hideAllWorkScreens();

if(groupId){
  document.getElementById('attendanceScreen').classList.remove('hidden');
  await loadStudentsListForAttendance(groupId);
  await loadTodayAttendanceCount(groupId);
  return;
}

goRoleHome();

}

function updateNewStudentPhotoPreview(){

const input =
document.getElementById('newFotoUrl');

const img =
document.getElementById('newStudentPhotoPreview');

if(!input || !img) return;

const url = input.value.trim();

if(!url){
img.src = '';
img.style.display = 'none';
return;
}

if(!url.startsWith('https://') && !url.startsWith('http://')){
img.src = '';
img.style.display = 'none';
return;
}

const afterProtocol = url.slice(url.indexOf('://') + 3);
if(!afterProtocol.includes('/')){
img.src = '';
img.style.display = 'none';
return;
}

img.src = url;
img.style.display = 'block';

}

let kyuObiLookup = [];
let _kyuObiLookupLoaded = false;

async function ensureKyuObiLookup() {
  if (_kyuObiLookupLoaded) return kyuObiLookup;
  const { data, error } = await db
    .from('kyu_lookup')
    .select('kyu_grad, guertelfarbe')
    .order('id', { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  kyuObiLookup = data || [];
  _kyuObiLookupLoaded = true;
  return kyuObiLookup;
}

async function loadKyuObiOptionsForNewStudent(sportId){

    await ensureKyuObiLookup();

    currentNewStudentLookup = getRankBeltLookup(sportId);

    const kyuSelect = document.getElementById('newKyu');
    const obiSelect = document.getElementById('newObi');

    if(!kyuSelect || !obiSelect) return;

    kyuSelect.innerHTML='';
    obiSelect.innerHTML='';

    currentNewStudentLookup.forEach(row=>{

        kyuSelect.innerHTML +=
        `<option value="${row.kyu_grad}">${row.kyu_grad}</option>`;

        obiSelect.innerHTML +=
        `<option value="${row.guertelfarbe}">${row.guertelfarbe}</option>`;
    });

    syncNewObiFromKyu();
}

function todayBerlin() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

function syncNewObiFromKyu(){
    const lookup = currentNewStudentLookup.length ? currentNewStudentLookup : kyuObiLookup;
    const kyu = document.getElementById('newKyu')?.value;
    const found = lookup.find(x => x.kyu_grad === kyu);
    if(found){
        document.getElementById('newObi').value = found.guertelfarbe;
    }
}

function syncNewKyuFromObi(){
    const lookup = currentNewStudentLookup.length ? currentNewStudentLookup : kyuObiLookup;
    const obi = document.getElementById('newObi')?.value;
    const found = lookup.find(x => x.guertelfarbe === obi);
    if(found){
        document.getElementById('newKyu').value = found.kyu_grad;
    }
}

function buildBirthDateForSupabase(day, month, year) {

  day = String(day || '').trim();
  month = String(month || '').trim();
  year = String(year || '').trim();

  if (!day && !month && !year) {
    return null;
  }

  if (!day || !month || !year) {
    showCustomMessage('Bitte Geburtsdatum vollständig eingeben: Tag, Monat und Jahr.');
    throw new Error('Geburtsdatum unvollständig');
  }

  if (day.length === 1) day = '0' + day;
  if (month.length === 1) month = '0' + month;

  return year + '-' + month + '-' + day;
}

async function saveNewStudent(groupId) {

  const vorname =
    document.getElementById('newVorname')?.value?.trim() || '';

  const nachname =
    document.getElementById('newNachname')?.value?.trim() || '';

  if (!vorname || !nachname) {
    showCustomMessage('Bitte Vorname und Nachname eingeben.');
    return;
  }

  const { data: groupData, error: groupError } = await db
    .from('groups')
    .select('sport_id')
    .eq('gruppe_id', groupId)
    .maybeSingle();

  if (groupError) {
    console.error(groupError);
    showCustomMessage('Fehler beim Laden der Sportart der Gruppe.');
    return;
  }

  const sportId = groupData?.sport_id || '';

  if (!sportId) {
    showCustomMessage('Diese Gruppe hat keine Sportart. Bitte zuerst sport_id bei der Gruppe prüfen.');
    return;
  }

  const today = todayBerlin();

  const payload = {
    vorname: vorname,
    nachname: nachname,

    geburtsdatum: buildBirthDateForSupabase(
      document.getElementById('newGeburtTag')?.value,
      document.getElementById('newGeburtMonat')?.value,
      document.getElementById('newGeburtJahr')?.value
    ),

    aktuelles_gewicht:
      document.getElementById('newGewicht')?.value || null,

    kyu_grad:
      document.getElementById('newKyu')?.value || '',

    guertelfarbe:
      document.getElementById('newObi')?.value || '',

    telefon:
      document.getElementById('newTelefon')?.value?.trim() || '',

    email:
      document.getElementById('newEmail')?.value?.trim() || '',

    foto_url:
      document.getElementById('newFotoUrl')?.value?.trim() || '',

    kommentar:
      document.getElementById('newKommentar')?.value?.trim() || '',

    geschlecht:
      document.getElementById('newGeschlecht')?.value || 'Keine Angabe',

    gruppe_id: groupId,
    sport_id: sportId,

    trainer:
      currentTrainer ? currentTrainer.name : '',

    aktiv: 'JA',

    vertrag_status: 'OFFEN',
    probetraining_status: 'AKTIV',
    eintrittsdatum: today,
    probetraining_start: today,
    buchhaltung_relevant: 'JA',
    club_id: currentClub.club_id
  };

  const { error } = await db
    .from('students')
    .insert([payload]);

  if (error) {
    console.error(error);
    showCustomMessage('Fehler beim Speichern: ' + error.message);
    return;
  }

  showCustomMessage(
  'Neuer Student wurde erfolgreich gespeichert.',
  async function() {

    await showPromoTransition(async () => {

      hideAllWorkScreens();

      document
        .getElementById('attendanceScreen')
        .classList.remove('hidden');

      await loadStudentsListForAttendance(groupId);
      await loadTodayAttendanceCount(groupId);

    });

  }
  
);

}

function getStudentId(student) {
    return (
        student?.id ||
        student?.student_id ||
        student?.StudentID ||
        null
    );
}

async function saveEditedStudent(studentId){

const payload = {
  nachname: document.getElementById('editNachname')?.value?.trim() || '',
  vorname: document.getElementById('editVorname')?.value?.trim() || '',
  geburtsdatum: document.getElementById('editGeburtsdatum')?.value || null,
  aktuelles_gewicht: document.getElementById('editGewicht')?.value || null,

  gruppe_id:
document.getElementById('editGruppe')?.value || '',



  kyu_grad: document.getElementById('editKyu')?.value || '',
  guertelfarbe: document.getElementById('editObi')?.value || '',
  telefon: document.getElementById('editTelefon')?.value?.trim() || '',
  email: document.getElementById('editEmail')?.value?.trim() || '',
  foto_url: document.getElementById('editFotoUrl')?.value?.trim() || '',
  kommentar: document.getElementById('editKommentar')?.value?.trim() || '',
  geschlecht: document.getElementById('editGeschlecht')?.value || 'Keine Angabe'
};

const { data, error } = await db
.from('students')
.update(payload)
.eq('id', studentId)
.select();

if(error){
  console.error(error);
  showCustomMessage('Fehler beim Speichern: ' + error.message);
  return;
}

if(!data || data.length === 0){
  showCustomMessage('Keine Änderung gespeichert. Prüfe Supabase-Rechte oder Student-ID.');
  return;
}

showCustomMessage('Änderungen gespeichert.');

if(previousScreenBeforeEditStudent === 'orphanStudentsScreen'){

hideAllWorkScreens();

document
.getElementById('orphanStudentsScreen')
.classList.remove('hidden');

currentView = 'orphanStudents';

document.getElementById('currentGroupInfo').textContent =
'Aktuelle Seite: Schüler ohne Gruppe / Trainer';

await loadOrphanStudents();

previousScreenBeforeEditStudent = null;

return;

}

if(previousScreenBeforeEditStudent === 'trainerAdminScreen'){

  hideAllWorkScreens();

  document
    .getElementById('trainerAdminScreen')
    .classList.remove('hidden');

  document
    .getElementById('trainerFilterBlock')
    ?.classList.remove('hidden');

  document
    .getElementById('trainerStudentListBlock')
    ?.classList.remove('hidden');

  await applyTrainerFilters();

  previousScreenBeforeEditStudent = null;

  return;
}

if(previousScreenBeforeEditStudent === 'attendanceScreen'){

  hideAllWorkScreens();

  document
    .getElementById('attendanceScreen')
    .classList.remove('hidden');

  const groupId =
    document.getElementById('groupSelect')?.value || '';

  if(groupId){
    await loadStudentsListForAttendance(groupId);
    await loadTodayAttendanceCount(groupId);
  }

  previousScreenBeforeEditStudent = null;

  return;

}

if(previousScreenBeforeEditStudent === 'adminStudentScreen'){

  hideAllWorkScreens();
  document.getElementById('adminStudentScreen').classList.remove('hidden');
  previousScreenBeforeEditStudent = null;
  await applyAdminStudentFilter();
  return;

}

if(previousScreenBeforeEditStudent === 'groupScreen'){

  hideAllWorkScreens();
  document.getElementById('groupScreen').classList.remove('hidden');
  previousScreenBeforeEditStudent = null;
  await applyGroupFilter();
  return;

}

if(previousScreenBeforeEditStudent === 'clubStatistikScreen'){

  hideAllWorkScreens();
  document.getElementById('clubStudentStatsScreen').classList.remove('hidden');
  previousScreenBeforeEditStudent = null;
  await showFilteredStudentsForStatistics();
  return;

}

cancelStudentEditForm();

}

function selectNewStudentPhoto(){

const select =
document.getElementById('newPhotoSelect');

const fotoInput =
document.getElementById('newFotoUrl');

const preview =
document.getElementById('newStudentPhotoPreview');

if(!select || !fotoInput || !preview) return;

fotoInput.value = select.value || '';

preview.src = select.value || '';

}

async function showClubStatistikScreen() {
  hideAllWorkScreens();

  currentView = 'clubStatistik';

  document
    .getElementById('clubStatistikScreen')
    .classList.remove('hidden');

    await loadClubSportFilter();

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Club Statistik';

  document.getElementById('mainStatus').textContent = '';

  await loadClubStatisticsSupabase();

  await loadSportStatsOverview();

  document.getElementById('statsResult').textContent =
    'Keine Statistik geladen.';

  document.getElementById('statsStudentsList').innerHTML = '';
}

async function openClubStudentStatsFromClub() {

  previousView = 'clubStatistik';
  currentView = 'clubStudentStats';

  hideAllWorkScreens();

  document
    .getElementById('clubStudentStatsScreen')
    ?.classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Club Statistik / Schüler Statistik';

  await loadClubStudentSportFilter();
  await showFilteredStudentsForStatistics();
}

async function loadClubSportFilter() {

  const select =
    document.getElementById('clubSportFilter');

  if(!select)return;

  select.innerHTML = `
    <option value="">
      Alle Sportarten
    </option>
  `;

  const {data,error}=await db
    .from('sports')
    .select('sport_id, name')
    .eq('aktiv','JA')
    .eq('club_id', currentClub.club_id)
    .order('sort_order',{ascending:true});

  if(error){
    console.error(error);
    select.innerHTML = '<option value="">Fehler beim Laden der Sportarten</option>';
    return;
  }

  (data || []).forEach(function(sport){

    select.innerHTML += `
      <option value="${sport.sport_id}">
        ${sport.name}
      </option>
    `;

  });

  select.value = getSelectedClubSport();

}

async function loadClubStudentSportFilter() {

  const select =
    document.getElementById('clubStudentSportFilter');

  if(!select)return;

  select.innerHTML = `
    <option value="">
      Alle Sportarten
    </option>
  `;

  const {data,error}=await db
    .from('sports')
    .select('sport_id, name')
    .eq('aktiv','JA')
    .eq('club_id', currentClub.club_id)
    .order('sort_order',{ascending:true});

  if(error){
    console.error(error);
    select.innerHTML = '<option value="">Fehler beim Laden der Sportarten</option>';
    return;
  }

  (data || []).forEach(function(sport){

    select.innerHTML += `
      <option value="${sport.sport_id}">
        ${sport.name}
      </option>
    `;

  });

  select.value = getSelectedClubSport();

}

async function handleClubStudentSportFilterChange() {

  const select =
    document.getElementById('clubStudentSportFilter');

  setSelectedClubSport(
    select?.value || ''
  );

  await showFilteredStudentsForStatistics();

}

async function handleClubSportFilterChange() {

  const select =
    document.getElementById('clubSportFilter');

  setSelectedClubSport(
    select?.value || ''
  );

  await loadClubStatisticsSupabase();
  await loadSportStatsOverview();

  const clubStudentStatsScreen = document.getElementById('clubStudentStatsScreen');
  if (clubStudentStatsScreen && !clubStudentStatsScreen.classList.contains('hidden')) {
    await showFilteredStudentsForStatistics();
  }

}

async function loadSportStatsOverview() {

  const box =
    document.getElementById('sportStatsOverviewList');

  if (!box) return;

  box.innerHTML = 'Sportarten werden geladen...';

  const selectedSport =
    document.getElementById('clubSportFilter')?.value || '';

  let sportsQuery = db
    .from('sports')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('name', { ascending: true });

  if (selectedSport) {
    sportsQuery = sportsQuery.eq('sport_id', selectedSport);
  }

  const { data: sports } = await sportsQuery;

  const { data: trainers } = await db
    .from('trainers')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id);

  const { data: groups } = await db
    .from('groups')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id);

  const { data: students } = await db
    .from('students')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id);

  const sportStats = (sports || []).map(sport => {

    const trainerCount =
      (trainers || []).filter(t =>
        t.sport_id === sport.sport_id &&
        String(t.rolle || '').toUpperCase() === 'TRAINER'
      ).length;

    const groupCount =
      (groups || []).filter(g =>
        g.sport_id === sport.sport_id
      ).length;

    const studentCount =
      (students || []).filter(s =>
        s.sport_id === sport.sport_id
      ).length;

    return {
      sport,
      trainerCount,
      groupCount,
      studentCount
    };

  });

  sportStats.sort((a, b) => {

    if (b.studentCount !== a.studentCount) {
      return b.studentCount - a.studentCount;
    }

    if (b.groupCount !== a.groupCount) {
      return b.groupCount - a.groupCount;
    }

    return b.trainerCount - a.trainerCount;

  });

  box.innerHTML = '';

  sportStats.forEach(item => {

    box.innerHTML += `
      <div class="sport-stat-row">

        <div class="sport-stat-icon-box">
          <img
            src="${getSportImageUrl(item.sport)}"
            class="sport-stat-icon"
          >
        </div>

        <div class="sport-stat-values">
          <div>Gruppen: ${item.groupCount}</div>
          <div>Trainer: ${item.trainerCount}</div>
          <div>Schüler: ${item.studentCount}</div>
        </div>

      </div>
    `;

  });

}

async function loadClubStatisticsSupabase() {
  const selectedSport =
  document.getElementById('clubSportFilter')?.value || '';

let trainersQuery = db
  .from('trainers')
  .select('*')
  .eq('aktiv', 'JA')
  .eq('club_id', currentClub.club_id);

let groupsQuery = db
  .from('groups')
  .select('*')
  .eq('aktiv', 'JA')
  .eq('club_id', currentClub.club_id);

let studentsQuery = db
  .from('students')
  .select('*')
  .eq('aktiv', 'JA')
  .eq('club_id', currentClub.club_id);

if (selectedSport) {
  trainersQuery = trainersQuery.eq('sport_id', selectedSport);
  groupsQuery = groupsQuery.eq('sport_id', selectedSport);
  studentsQuery = studentsQuery.eq('sport_id', selectedSport);
}

const { data: trainers } = await trainersQuery;
const { data: groups } = await groupsQuery;
const { data: students } = await studentsQuery;

  const trainerCount = (trainers || []).filter(t =>
    String(t.rolle || '').toUpperCase() === 'TRAINER'
  ).length;

  document.getElementById('clubTrainerCount').textContent = trainerCount;
  document.getElementById('clubGroupCount').textContent = (groups || []).length;
  document.getElementById('clubStudentCount').textContent = (students || []).length;

  const gCount = { 'Männlich': 0, 'Weiblich': 0, 'Divers': 0, 'Keine Angabe': 0 };
  (students || []).forEach(s => {
    const g = String(s.geschlecht || 'Keine Angabe');
    if (gCount[g] !== undefined) gCount[g]++;
    else gCount['Keine Angabe']++;
  });
  const gBox = document.getElementById('clubStudentGenderStats');
  if (gBox) {
    gBox.innerHTML = `
      <span class="csg-badge csg-male">♂ ${gCount['Männlich']}</span>
      <span class="csg-badge csg-female">♀ ${gCount['Weiblich']}</span>
      <span class="csg-badge csg-divers">⚧ ${gCount['Divers']}</span>
      <span class="csg-badge csg-unknown">– ${gCount['Keine Angabe']}</span>
    `;
  }
}

function getClubObiRank(obi) {
  const value = String(obi || '').toLowerCase().trim();

  const map = {
    'weiß': 1,
    'weiss': 1,
    'weiß-gelb': 2,
    'weiss-gelb': 2,
    'gelb': 3,
    'gelb-orange': 4,
    'orange': 5,
    'orange-grün': 6,
    'orange-gruen': 6,
    'grün': 7,
    'gruen': 7,
    'blau': 8,
    'braun': 9,
    'schwarz': 10
  };

  return map[value] || null;
}

function getClubStudentAge(student) {
  if (student.alter) return Number(student.alter);

  if (!student.geburtsdatum) return null;

  const birth = new Date(student.geburtsdatum);
  const today = new Date();

  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();

  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age;
}

async function getClubFilteredStudents() {
  const ageFrom = document.getElementById('statAgeFrom')?.value;
  const ageTo = document.getElementById('statAgeTo')?.value;
  const obiFrom = document.getElementById('statObiFrom')?.value;
  const obiTo = document.getElementById('statObiTo')?.value;
  const geschlecht = document.getElementById('statGeschlecht')?.value || '';

  const selectedSport =
    document.getElementById('clubStudentSportFilter')?.value ||
    document.getElementById('clubSportFilter')?.value ||
    '';

  const { data, error } = await db
    .from('students')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id);

  if (error) {
    console.error(error);
    return [];
  }

  return (data || []).filter(student => {
    if (selectedSport && student.sport_id !== selectedSport) {
      return false;
    }

    const age = getClubStudentAge(student);
    const obiRank = getClubObiRank(student.guertelfarbe);

    if (ageFrom && (age === null || age < Number(ageFrom))) return false;
    if (ageTo && (age === null || age > Number(ageTo))) return false;

    if (obiFrom && (obiRank === null || obiRank < Number(obiFrom))) return false;
    if (obiTo && (obiRank === null || obiRank > Number(obiTo))) return false;

    if (geschlecht && String(student.geschlecht || 'Keine Angabe') !== geschlecht) return false;

    return true;
  });
}

async function applyStatsFilter() {
  const resultBox = document.getElementById('statsResult');

  resultBox.textContent = 'Statistik wird geladen...';

  const filtered = await getClubFilteredStudents();

  const gCount = {
    'Männlich': 0,
    'Weiblich': 0,
    'Divers': 0,
    'Keine Angabe': 0
  };
  filtered.forEach(s => {
    const g = String(s.geschlecht || 'Keine Angabe');
    if (gCount[g] !== undefined) gCount[g]++;
    else gCount['Keine Angabe']++;
  });

  resultBox.innerHTML = `
    <div class="geschlecht-stat-row">
      <span class="geschlecht-stat-badge badge-blue">Gesamt: <strong>${filtered.length}</strong></span>
      <span class="geschlecht-stat-badge badge-blue">♂ Männlich: <strong>${gCount['Männlich']}</strong></span>
      <span class="geschlecht-stat-badge badge-pink">♀ Weiblich: <strong>${gCount['Weiblich']}</strong></span>
      <span class="geschlecht-stat-badge badge-purple">⚧ Divers: <strong>${gCount['Divers']}</strong></span>
      <span class="geschlecht-stat-badge badge-gray">— Keine Angabe: <strong>${gCount['Keine Angabe']}</strong></span>
    </div>
  `;

  await renderStudentTableUniversal(filtered, {
    containerId: 'statsStudentsList',
    showCheckbox: false,
    showGroup: true,
    showComment: false
  });
}

async function showFilteredStudentsForStatistics() {
  const box = document.getElementById('statsStudentsList');
  box.innerHTML = 'Schüler werden geladen...';

  const filtered = await getClubFilteredStudents();

  const gCount = { 'Männlich': 0, 'Weiblich': 0, 'Divers': 0, 'Keine Angabe': 0 };
  filtered.forEach(s => {
    const g = String(s.geschlecht || 'Keine Angabe');
    if (gCount[g] !== undefined) gCount[g]++;
    else gCount['Keine Angabe']++;
  });
  const resultBox = document.getElementById('statsResult');
  if (resultBox) {
    resultBox.innerHTML = `
      <div class="geschlecht-stat-row">
        <span class="geschlecht-stat-badge badge-blue">Gesamt: <strong>${filtered.length}</strong></span>
        <span class="geschlecht-stat-badge badge-blue">♂ Männlich: <strong>${gCount['Männlich']}</strong></span>
        <span class="geschlecht-stat-badge badge-pink">♀ Weiblich: <strong>${gCount['Weiblich']}</strong></span>
        <span class="geschlecht-stat-badge badge-purple">⚧ Divers: <strong>${gCount['Divers']}</strong></span>
        <span class="geschlecht-stat-badge badge-gray">— Keine Angabe: <strong>${gCount['Keine Angabe']}</strong></span>
      </div>
    `;
  }

  await renderStudentTableUniversal(filtered, {
    containerId: 'statsStudentsList',
    showCheckbox: false,
    showGroup: true,
    showComment: false
  });
}

function hideFilteredStudentsForStatistics() {
  document.getElementById('statsStudentsList').innerHTML = '';
}

async function openTrainerStatistikFromClub() {
  previousView = 'clubStatistik';
  currentView = 'trainerAdminFromClub';

  await openTrainerStatistikScreen();

  currentView = 'trainerAdminFromClub';

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Club Statistik / Trainer Statistik';
}

async function openTrainerStatistikScreen() {
  if (!currentTrainer || currentTrainer.role !== 'Admin') return;

  hideAllWorkScreens();

  document.getElementById('trainerAdminScreen').classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Trainer Statistik';

  document.getElementById('mainStatus').textContent = '';

  await loadTrainerOverviewSportFilter();
  await loadTrainerAdminOverview();
}

async function loadTrainerAdminOverview() {
  const select = document.getElementById('trainerAdminSelect');
  const selectedSport = getSelectedClubSport();

  if (!select) return;

  select.innerHTML = '<option value="">Trainer werden geladen...</option>';

  const { data, error } = await db
    .from('trainers')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('rolle', 'Trainer')
    .eq('club_id', currentClub.club_id)
    .order('name', { ascending: true });

  if (error) {
    console.error(error);
    select.innerHTML = '<option value="">Fehler beim Laden</option>';
    return;
  }

  let filteredTrainers = data || [];

  if (selectedSport) {
    filteredTrainers = filteredTrainers.filter(trainer =>
      String(trainer.sport_id || '')
        .split(/[;,]/)
        .map(x => x.trim())
        .includes(selectedSport)
    );
  }

  const totalBox = document.getElementById('trainerTotalCount');

  if (totalBox) {
    totalBox.textContent = filteredTrainers.length;
  }

  select.innerHTML = '<option value="">Bitte Trainer auswählen...</option>';

  filteredTrainers.forEach(trainer => {
    select.innerHTML += `
      <option value="${trainer.trainer_id}">
        ${trainer.name || '-'}
      </option>
    `;
  });

  select.onchange = async function () {
    updateTrainerActionButtons();

    if (!this.value) {
      await showAllTrainersStatistics();
    } else {
      await showTrainerAdmin();
    }
  };

  updateTrainerActionButtons();
  await showAllTrainersStatistics();
}

function updateTrainerActionButtons() {
  const select = document.getElementById('trainerAdminSelect');
  const editBtn = document.getElementById('editSelectedTrainerBtn');
  const deleteBtn = document.getElementById('deleteSelectedTrainerBtn');

  const active = !!(select && select.value);

  if (editBtn) editBtn.disabled = !active;
  if (deleteBtn) deleteBtn.disabled = !active;
}

async function showAllTrainersStatistics() {

  const box =
    document.getElementById('trainerInfoBoxModern');

  if (!box) return;

  box.innerHTML = 'Trainerdaten werden geladen...';

  const selectedSport =
    getSelectedClubSport();

  const [
    trainersResult,
    groupsResult,
    linksResult,
    studentsResult,
    sportsResult
  ] = await Promise.all([

    db.from('trainers')
      .select('*')
      .eq('aktiv', 'JA')
      .eq('rolle', 'Trainer')
      .eq('club_id', currentClub.club_id)
      .order('name', { ascending: true }),

    db.from('groups')
      .select('*')
      .eq('aktiv', 'JA')
      .eq('club_id', currentClub.club_id),

    db.from('trainer_groups')
      .select('*')
      .eq('club_id', currentClub.club_id),

    db.from('students')
      .select('*')
      .eq('aktiv', 'JA')
      .eq('club_id', currentClub.club_id),

    db.from('sports')
      .select('sport_id, name')
      .eq('club_id', currentClub.club_id)

  ]);

  if (
    trainersResult.error ||
    groupsResult.error ||
    linksResult.error ||
    studentsResult.error
  ) {

    box.innerHTML =
      'Fehler beim Laden der Trainerdaten.';

    return;
  }

  const sportsMap = {};
  (sportsResult.data || []).forEach(s => {
    if (s.sport_id) sportsMap[s.sport_id] = s.name || s.sport_id;
  });

  let filteredTrainers =
    trainersResult.data || [];

  if (selectedSport) {

    filteredTrainers =
      filteredTrainers.filter(trainer =>

        String(trainer.sport_id || '')
          .split(/[;,]/)
          .map(x => x.trim())
          .includes(selectedSport)

      );

  }

  box.innerHTML = renderTrainerCards(

    filteredTrainers,

    groupsResult.data || [],

    linksResult.data || [],

    studentsResult.data || [],

    sportsMap

  );

}

async function showTrainerAdmin() {
  const select = document.getElementById('trainerAdminSelect');
  const trainerId = select?.value || '';
  const box = document.getElementById('trainerInfoBoxModern');

  if (!trainerId || !box) return;

  box.innerHTML = 'Trainer wird geladen...';

  const [trainersResult, groupsResult, linksResult, studentsResult, sportsResult] =
    await Promise.all([
      db.from('trainers').select('*').eq('trainer_id', trainerId).eq('club_id', currentClub.club_id),
      db.from('groups').select('*').eq('aktiv', 'JA').eq('club_id', currentClub.club_id),
      db.from('trainer_groups').select('*').eq('trainer_id', trainerId).eq('club_id', currentClub.club_id),
      db.from('students').select('*').eq('aktiv', 'JA').eq('club_id', currentClub.club_id),
      db.from('sports').select('sport_id, name').eq('club_id', currentClub.club_id)
    ]);

  if (trainersResult.error || groupsResult.error || linksResult.error || studentsResult.error) {
    box.innerHTML = 'Fehler beim Laden des Trainers.';
    return;
  }

  const sportsMap = {};
  (sportsResult.data || []).forEach(s => {
    if (s.sport_id) sportsMap[s.sport_id] = s.name || s.sport_id;
  });

  box.innerHTML = renderTrainerCards(
    trainersResult.data || [],
    groupsResult.data || [],
    linksResult.data || [],
    studentsResult.data || [],
    sportsMap
  );

  const _adminSportId = String(currentTrainer?.sport_id || selectedLoginContext?.sportId || '')
    .split(/[;,]/)[0].trim();
  applyTrainerFilterSportCfg(_adminSportId);
  applyWeightButtonVisibility(_adminSportId);
}

async function toggleTrainerStudentFilter() {

  const filterBlock = document.getElementById('trainerFilterBlock');
  const listBlock = document.getElementById('trainerStudentListBlock');

  if (!filterBlock || !listBlock) return;

  filterBlock.classList.remove('hidden');
  listBlock.classList.remove('hidden');

  await loadTrainerFilterGroups();
  await applyTrainerFilters();
}

async function loadTrainerFilterGroups() {

  const groupSelect = document.getElementById('trainerFilterGroup');
  const trainerSelect = document.getElementById('trainerAdminSelect');

  if (!groupSelect) return;

  const trainerId = trainerSelect?.value || '';

  let groups = [];

  if (trainerId) {

    const { data, error } = await db
      .from('trainer_groups')
      .select('gruppe_id, gruppenname')
      .eq('trainer_id', trainerId)
      .order('gruppenname', { ascending: true });

    if (error) {
      console.error(error);
      groupSelect.innerHTML = '<option value="">Fehler beim Laden der Gruppen</option>';
      return;
    }

    groups = data || [];

  } else {

    const { data, error } = await db
      .from('groups')
      .select('gruppe_id, gruppenname')
      .eq('aktiv', 'JA')
      .order('gruppenname', { ascending: true });

    if (error) {
      console.error(error);
      groupSelect.innerHTML = '<option value="">Fehler beim Laden der Gruppen</option>';
      return;
    }

    groups = data || [];
  }

  groupSelect.innerHTML = '<option value="">Alle Gruppen</option>';

  groups.forEach(group => {
    groupSelect.innerHTML += `
      <option value="${group.gruppe_id}">
        ${group.gruppenname || group.gruppe_id}
      </option>
    `;
  });
}

function applyWeightButtonVisibility(sportId) {
  const show = getSportConfig(sportId).showWeight;
  const btn1 = document.getElementById('weightButton');
  const btn2 = document.getElementById('attendanceWeightButton');
  if (btn1) btn1.classList.toggle('hidden', !show);
  if (btn2) btn2.classList.toggle('hidden', !show);
}

function applyTrainerFilterSportCfg(sportId) {
  const cfg       = getSportConfig(sportId);
  const showGrad  = cfg.showGraduation;
  const gradLabel = cfg.graduationLabel;
  const showBelt  = cfg.showBelt;
  const beltLabel = cfg.beltLabel;

  // ── groupScreen (Trainer-eigener Schüler Statistik) ──────
  const gsKyuFromWrap  = document.getElementById('groupStatKyuFromWrap');
  const gsKyuToWrap    = document.getElementById('groupStatKyuToWrap');
  const gsObiFromWrap  = document.getElementById('groupStatObiFromWrap');
  const gsObiToWrap    = document.getElementById('groupStatObiToWrap');
  const gsKyuFromLabel = document.getElementById('groupStatKyuFromLabel');
  const gsKyuToLabel   = document.getElementById('groupStatKyuToLabel');
  const gsObiFromLabel = document.getElementById('groupStatObiFromLabel');
  const gsObiToLabel   = document.getElementById('groupStatObiToLabel');

  if (gsKyuFromWrap)  gsKyuFromWrap.style.display  = showGrad ? '' : 'none';
  if (gsKyuToWrap)    gsKyuToWrap.style.display    = showGrad ? '' : 'none';
  if (gsKyuFromLabel) gsKyuFromLabel.textContent   = gradLabel + ' von';
  if (gsKyuToLabel)   gsKyuToLabel.textContent     = gradLabel + ' bis';
  if (gsObiFromWrap)  gsObiFromWrap.style.display  = showBelt ? '' : 'none';
  if (gsObiToWrap)    gsObiToWrap.style.display    = showBelt ? '' : 'none';
  if (gsObiFromLabel) gsObiFromLabel.textContent   = beltLabel + ' von';
  if (gsObiToLabel)   gsObiToLabel.textContent     = beltLabel + ' bis';

  // ── trainerAdminScreen (Admin → Trainer-Übersicht) ───────
  const taKyuFromWrap  = document.getElementById('trainerFilterKyuFromWrap');
  const taKyuToWrap    = document.getElementById('trainerFilterKyuToWrap');
  const taObiFromWrap  = document.getElementById('trainerFilterObiFromWrap');
  const taObiToWrap    = document.getElementById('trainerFilterObiToWrap');
  const taKyuFromLabel = document.getElementById('trainerFilterKyuFromLabel');
  const taKyuToLabel   = document.getElementById('trainerFilterKyuToLabel');
  const taObiFromLabel = document.getElementById('trainerFilterObiFromLabel');
  const taObiToLabel   = document.getElementById('trainerFilterObiToLabel');

  if (taKyuFromWrap)  taKyuFromWrap.style.display  = showGrad ? '' : 'none';
  if (taKyuToWrap)    taKyuToWrap.style.display    = showGrad ? '' : 'none';
  if (taKyuFromLabel) taKyuFromLabel.textContent   = gradLabel + ' von';
  if (taKyuToLabel)   taKyuToLabel.textContent     = gradLabel + ' bis';
  if (taObiFromWrap)  taObiFromWrap.style.display  = showBelt ? '' : 'none';
  if (taObiToWrap)    taObiToWrap.style.display    = showBelt ? '' : 'none';
  if (taObiFromLabel) taObiFromLabel.textContent   = beltLabel + ' von';
  if (taObiToLabel)   taObiToLabel.textContent     = beltLabel + ' bis';
}

async function applyTrainerFilters() {

  const trainerSelect = document.getElementById('trainerAdminSelect');
  const trainerId = trainerSelect?.value || '';

  const listBlock = document.getElementById('trainerStudentListBlock');
  const textBox = document.getElementById('trainerStudentsFoundText');

  if (listBlock) listBlock.classList.remove('hidden');

  const { data: students, error } = await db
    .from('students')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id);

  if (error) {
    console.error(error);
    showCustomMessage('Fehler beim Laden der Schüler: ' + error.message);
    return;
  }

  let allowedGroupIds = [];

  if (trainerId) {
    const { data: links } = await db
      .from('trainer_groups')
      .select('gruppe_id')
      .eq('trainer_id', trainerId)
      .eq('club_id', currentClub.club_id);

    allowedGroupIds = (links || []).map(x => x.gruppe_id);
  }

  let filtered = filterStudentsUniversal(students || [], {
    name: document.getElementById('filterName')?.value || '',
    ageFrom: document.getElementById('trainerFilterAgeFrom')?.value || '',
    ageTo: document.getElementById('trainerFilterAgeTo')?.value || '',
    kyuFrom: document.getElementById('trainerFilterKyuFrom')?.value || '',
    kyuTo: document.getElementById('trainerFilterKyuTo')?.value || '',
    obiFrom: document.getElementById('trainerFilterObiFrom')?.value || '',
    obiTo: document.getElementById('trainerFilterObiTo')?.value || '',
    geschlecht: document.getElementById('trainerFilterGeschlecht')?.value || '',
    groupId: document.getElementById('trainerFilterGroup')?.value || '',
    allowedGroupIds: trainerId ? allowedGroupIds : []
  });

  if (textBox) {
    textBox.textContent = 'Gefunden: ' + filtered.length + ' Schüler';
  }

  await renderStudentTableUniversal(filtered, {
    containerId: 'trainerStudentsList',
    showCheckbox: false,
    showGroup: true,
    showComment: false
  });
}

async function resetTrainerFilters() {

  await resetFiltersUniversal({
    fields: [
      'filterName',
      'trainerFilterAgeFrom',
      'trainerFilterAgeTo',
      'trainerFilterKyuFrom',
      'trainerFilterKyuTo',
      'trainerFilterObiFrom',
      'trainerFilterObiTo',
      'trainerFilterGroup',
      'trainerFilterGeschlecht'
    ],
    suggestionsId: 'trainerStudentNameSuggestions',
    callback: applyTrainerFilters
  });
}

function renderTrainerCards(trainers, groups, links, students, sportsMap = {}) {
  const colors = [
    'trainer-blue',
    'trainer-green',
    'trainer-orange',
    'trainer-purple',
    'trainer-red'
  ];

  if (!trainers.length) {
    return `
      <div class="trainer-empty-card">
        <div class="trainer-empty-icon">📋</div>
        Keine Trainer gefunden.
      </div>
    `;
  }

  const trainersWithStats = trainers.map(trainer => {
    const trainerId = String(trainer.trainer_id || '').trim();

    const trainerLinks = links.filter(link =>
      String(link.trainer_id || '').trim() === trainerId
    );

    const trainerGroupIds = trainerLinks.map(link =>
      String(link.gruppe_id || '').trim()
    );

    const trainerGroups = groups.filter(group =>
      trainerGroupIds.includes(String(group.gruppe_id || '').trim())
    );

    const trainerStudents = students.filter(student => {
      const ids = String(student.gruppe_id || '')
        .split(/[;,]/)
        .map(x => x.trim())
        .filter(Boolean);

      return ids.some(id => trainerGroupIds.includes(id));
    });

    const uniqueStudents = {};
    trainerStudents.forEach(student => {
      const id = String(student.id || student.student_id || '');
      if (id) uniqueStudents[id] = true;
    });

    return {
      trainer,
      trainerGroups,
      uniqueStudents,
      totalStudents: Object.keys(uniqueStudents).length,
      totalGroups: trainerGroups.length,
      groupHtmlParts: trainerGroups.map((group, groupIndex) => {
        const groupId = String(group.gruppe_id || '').trim();

        const groupStudentCount = students.filter(student => {
          const ids = String(student.gruppe_id || '')
            .split(/[;,]/)
            .map(x => x.trim())
            .filter(Boolean);

          return ids.includes(groupId);
        }).length;

        return `
          <div class="trainer-info-group-row">
            <div class="trainer-info-group-name">
              ${groupIndex + 1}) ${group.gruppenname || group.gruppe_id || '-'}
            </div>

            <div class="trainer-info-group-time">
              ${renderGroupTrainingTimeBadges(group.trainingszeit)}
            </div>

            <div class="trainer-info-group-count">
              👥 ${groupStudentCount} Schüler
            </div>
          </div>
        `;
      })
    };
  });

  trainersWithStats.sort((a, b) => {
    const studentDiff = (b.totalStudents || 0) - (a.totalStudents || 0);
    if (studentDiff !== 0) return studentDiff;
    return (b.totalGroups || 0) - (a.totalGroups || 0);
  });

  return trainersWithStats.map(({ trainer, trainerGroups, uniqueStudents, groupHtmlParts }, index) => {
    let groupHtml = groupHtmlParts.join('');

    if (!groupHtml) {
      groupHtml = `
        <div class="trainer-info-group-row">
          Keine Gruppen zugeordnet.
        </div>
      `;
    }

    return `
      <div class="trainer-info-modern-card ${colors[index % colors.length]}">

        <div class="trainer-info-modern-header">

          <div class="trainer-info-name">
            <div class="trainer-info-avatar">👤</div>

            <div>
              <div>${trainer.name || '-'}</div>
              <div class="small">
                📞 ${trainer.telefon || 'keine Telefon'}<br>
                ✉️ ${trainer.email || 'keine E-Mail'}
              </div>
            </div>
          </div>

          <div class="trainer-info-summary">
            <div class="trainer-info-pill groups">
              🏅 Sportart: ${sportsMap[String(trainer.sport_id || '').trim()] || '-'}
            </div>

            <div class="trainer-info-pill groups">
              👥 Gruppen: ${trainerGroups.length}
            </div>

            <div class="trainer-info-pill students">
              👨‍🎓 Gesamt Schüler: ${Object.keys(uniqueStudents).length}
            </div>
          </div>

        </div>

        <div class="trainer-info-groups">
          ${groupHtml}
        </div>

      </div>
    `;
  }).join('');
}

function splitTrainerNameForEdit(name) {
  const parts = String(name || '').trim().split(/\s+/);

  if (parts.length <= 1) {
    return { nachname: name || '', vorname: '' };
  }

  return {
    nachname: parts[0],
    vorname: parts.slice(1).join(' ')
  };
}

async function openEditSelectedTrainer() {
  const select = document.getElementById('trainerAdminSelect');
  const trainerId = select?.value || '';

  if (!trainerId) {
    showCustomMessage('Bitte zuerst Trainer auswählen.');
    return;
  }

  const [trainerResult, groupsResult, trainerGroupsResult] = await Promise.all([
    db.from('trainers').select('*').eq('trainer_id', trainerId).eq('club_id', currentClub.club_id).single(),
    db.from('groups').select('*').eq('aktiv', 'JA').eq('club_id', currentClub.club_id).order('gruppenname', { ascending: true }),
    db.from('trainer_groups').select('*').eq('trainer_id', trainerId).eq('club_id', currentClub.club_id)
  ]);

  if (trainerResult.error) {
    showCustomMessage('Fehler Trainer laden: ' + trainerResult.error.message);
    return;
  }

  const trainer = trainerResult.data;
  const roleLower =
String(trainer.rolle || 'Trainer')
.toLowerCase();

let roleLabel = 'Trainer';

if(roleLower === 'admin'){
roleLabel = 'Administrator';
}

if(roleLower === 'buchhaltung'){
roleLabel = 'Buchhalter';
}

const mainTitle =
document.getElementById('editTrainerMainTitle');

const cardTitle =
document.getElementById('editTrainerCardTitle');

const mainSubtitle =
document.getElementById('editTrainerMainSubtitle');

const infoTitle =
document.getElementById('editTrainerInfoTitle');

const infoSubtitle =
document.getElementById('editTrainerInfoSubtitle');

if(mainTitle){
mainTitle.textContent =
roleLabel + ' bearbeiten';
}

const currentInfo =
document.getElementById('currentGroupInfo');

if(currentInfo){
currentInfo.textContent =
'Aktuelle Seite: ' + roleLabel + ' bearbeiten';
}

if(cardTitle){
cardTitle.textContent =
roleLabel + ' bearbeiten';
}

if(mainSubtitle){
mainSubtitle.textContent =
roleLabel + 'daten bearbeiten.';
}

if(infoTitle){
infoTitle.textContent =
roleLabel + ' Informationen';
}

if(infoSubtitle){
infoSubtitle.textContent =
'Grundlegende Daten des ' + roleLabel + 's';
}
  const nameParts = splitTrainerNameForEdit(trainer.name || '');

  document.getElementById('editTrainerIdHidden').value = trainer.trainer_id || '';
  document.getElementById('editTrainerNachnameNew').value = nameParts.nachname || '';
  document.getElementById('editTrainerVornameNew').value = nameParts.vorname || '';
  document.getElementById('editTrainerTelefonNew').value = trainer.telefon || '';
  document.getElementById('editTrainerEmailNew').value = trainer.email || '';
  document.getElementById('editTrainerPinNew').value = trainer.pin || '';
  document.getElementById('editTrainerRoleNew').value = trainer.rolle || 'Trainer';

  const selectedGroupIds = (trainerGroupsResult.data || [])
    .map(x => String(x.gruppe_id || '').trim())
    .filter(Boolean);

  const groupsBox = document.getElementById('editTrainerGroupsBoxNew');
  const groupsCard =
groupsBox
? groupsBox.closest('.add-trainer-modern-card')
: null;

if (
  String(trainer.rolle || '').toLowerCase() === 'admin' ||
  String(trainer.rolle || '').toLowerCase() === 'buchhaltung'
) {

  if (groupsCard) {
    groupsCard.classList.add('hidden');
  }

  groupsBox.innerHTML = '';

} else {

  if (groupsCard) {
    groupsCard.classList.remove('hidden');
  }

  const trainerSportIds = String(trainer.sport_id || '')
    .split(/[;,]/)
    .map(x => x.trim())
    .filter(Boolean);

  const filteredGroups = (groupsResult.data || []).filter(group =>
    trainerSportIds.length === 0 ||
    trainerSportIds.includes(String(group.sport_id || '').trim())
  );

  groupsBox.innerHTML = `
    <div class="add-trainer-groups-grid">
      ${filteredGroups.map(group => {
        const checked = selectedGroupIds.includes(String(group.gruppe_id)) ? 'checked' : '';

        return `
          <label class="add-trainer-group-line">
            <input
              type="checkbox"
              class="editTrainerGroupCheckbox"
              value="${group.gruppe_id}"
              data-name="${group.gruppenname || ''}"
              ${checked}
            >
            <span>${group.gruppenname || group.gruppe_id}</span>
          </label>
        `;
      }).join('')}
    </div>
  `;
}

  hideAllWorkScreens();

  document.getElementById('editTrainerScreen').classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
  'Aktuelle Seite: ' + roleLabel + ' bearbeiten';
}

async function saveEditedTrainer() {
  const trainerId = document.getElementById('editTrainerIdHidden')?.value || '';

  const nachname = document.getElementById('editTrainerNachnameNew')?.value?.trim() || '';
  const vorname = document.getElementById('editTrainerVornameNew')?.value?.trim() || '';
  const telefon = document.getElementById('editTrainerTelefonNew')?.value?.trim() || '';
  const email = document.getElementById('editTrainerEmailNew')?.value?.trim() || '';
  const pin = document.getElementById('editTrainerPinNew')?.value?.trim() || '';
  const rolle = document.getElementById('editTrainerRoleNew')?.value || '';

  const name = (nachname + ' ' + vorname).trim();

  if (!trainerId || !name || !pin) {
    showCustomMessage('Bitte Name und PIN eingeben.');
    return;
  }

  const { error: trainerError } = await db
    .from('trainers')
    .update({
      name,
      telefon,
      email,
      pin,
      rolle,
      aktiv: 'JA'
    })
    .eq('trainer_id', trainerId);

  if (trainerError) {
    showCustomMessage('Fehler beim Speichern: ' + trainerError.message);
    return;
  }

  const { error: deleteTrainerGroupsError } = await db
    .from('trainer_groups')
    .delete()
    .eq('trainer_id', trainerId);

  if (deleteTrainerGroupsError) {
    showCustomMessage('Fehler beim Entfernen der Gruppenverbindungen: ' + deleteTrainerGroupsError.message);
    return;
  }

  const checkedGroups = Array.from(
    document.querySelectorAll('.editTrainerGroupCheckbox:checked')
  );

  const rows = checkedGroups.map(cb => ({
    trainer_id: trainerId,
    trainer_name: name,
    gruppe_id: cb.value,
    gruppenname: cb.dataset.name || '',
    club_id: currentClub.club_id
  }));

  if (rows.length > 0) {
    const { error: linkError } = await db
      .from('trainer_groups')
      .insert(rows);

    if (linkError) {
      showCustomMessage('Trainer gespeichert, aber Gruppenfehler: ' + linkError.message);
      return;
    }
  }

  showCustomMessage(
'Trainer wurde erfolgreich gespeichert.'
);

if (previousView === 'adminBuchhaltung') {

  hideAllWorkScreens();

  currentView = 'adminBuchhaltung';

  document
    .getElementById('adminBuchhaltungScreen')
    .classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Administrator / Buchhaltung';

  await loadAdminBuchhaltungUsers();

  return;
}

await openTrainerStatistikScreen();

const select = document.getElementById('trainerAdminSelect');

if (select) {
  select.value = trainerId;
  updateTrainerActionButtons();
  await showTrainerAdmin();
}
}

async function deleteSelectedTrainer(){

const select =
document.getElementById('trainerAdminSelect');

const trainerId =
select?.value || '';

if(!trainerId){
showCustomMessage('Bitte zuerst einen Trainer auswählen.');
return;
}

const { data: trainer, error } = await db
.from('trainers')
.select('*')
.eq('trainer_id', trainerId)
.single();

if(error || !trainer){
showCustomMessage('Trainer wurde nicht gefunden.');
return;
}

document.getElementById('deleteConfirmText').textContent =
'Trainer wirklich deaktivieren?\n\n' +
(trainer.name || '-');

document.getElementById('confirmDeleteBtn').onclick =
async function(){

closeDeleteConfirm();

const { error: updateError } = await db
.from('trainers')
.update({ aktiv:'NEIN' })
.eq('trainer_id', trainerId);

if(updateError){
showCustomMessage('Fehler: ' + updateError.message);
return;
}

showCustomMessage('Trainer wurde deaktiviert.');

await loadTrainerAdminOverview();

};

document
.getElementById('deleteConfirmOverlay')
.classList.remove('hidden');

}

async function showGroupOverviewScreen() {
  if (!currentTrainer || currentTrainer.role !== 'Admin') return;

  previousView = 'clubStatistik';
  currentView = 'groupOverview';

  hideAllWorkScreens();

  document.getElementById('groupOverviewScreen').classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Gruppen Übersicht';

  document.getElementById('mainStatus').textContent =
    'Gruppen werden geladen.';

  await loadGroupOverviewSportFilter();

  const selectedSport =
    document.getElementById('groupOverviewSportFilter')?.value || '';

  let groupsQuery = db
    .from('groups')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('gruppe_id', { ascending: true });

  if (selectedSport) {
    groupsQuery = groupsQuery.eq('sport_id', selectedSport);
  }

  const [
    groupsResult,
    studentsResult,
    trainerGroupsResult,
    attendanceResult,
    sportsResult
  ] = await Promise.all([
    groupsQuery,
    db.from('students').select('*').eq('aktiv', 'JA').eq('club_id', currentClub.club_id),
    db.from('trainer_groups').select('*').eq('club_id', currentClub.club_id),
    db.from('attendance').select('*').eq('anwesenheit', 'JA').eq('club_id', currentClub.club_id),
    db.from('sports').select('sport_id, name').eq('club_id', currentClub.club_id)
  ]);

  if (
    groupsResult.error ||
    studentsResult.error ||
    trainerGroupsResult.error ||
    attendanceResult.error
  ) {
    document.getElementById('mainStatus').textContent =
      'Fehler beim Laden der Gruppen Übersicht.';
    return;
  }

  const groups = groupsResult.data || [];

  let students = studentsResult.data || [];

  if (selectedSport) {
    students = students.filter(student =>
      String(student.sport_id || '') === String(selectedSport)
    );
  }

  const trainerGroups = trainerGroupsResult.data || [];
  const attendance = attendanceResult.data || [];

  const sportsMap = {};
  (sportsResult.data || []).forEach(s => {
    if (s.sport_id) sportsMap[s.sport_id] = s.name || s.sport_id;
  });

  document.getElementById('overviewGroupCount').textContent = groups.length;
  document.getElementById('overviewStudentCount').textContent = students.length;

  const todayKey = todayBerlin();

  const groupIds = groups.map(g => String(g.gruppe_id || '').trim());

  const todayPresent = attendance.filter(row =>
    groupIds.includes(String(row.gruppe_id || '').trim()) &&
    String(row.datum || '').slice(0, 10) === todayKey
  ).length;

  document.getElementById('todayAttendanceCount').textContent = todayPresent;

  const cardColors = [
    'trainer-blue',
    'trainer-green',
    'trainer-orange',
    'trainer-purple',
    'trainer-red'
  ];

  let html = '';

  groups.forEach((group, index) => {
    const groupId = String(group.gruppe_id || '').trim();

    const groupStudents = students.filter(student => {
      const ids = String(student.gruppe_id || '')
        .split(/[;,]/)
        .map(x => x.trim())
        .filter(Boolean);

      return ids.includes(groupId);
    });

    const groupTrainers = trainerGroups
      .filter(row => String(row.gruppe_id || '').trim() === groupId)
      .map(row => row.trainer_name)
      .filter(Boolean)
      .join(', ');

    const groupTodayPresent = attendance.filter(row =>
      String(row.gruppe_id || '').trim() === groupId &&
      String(row.datum || '').slice(0, 10) === todayKey
    ).length;

    const cardClass = cardColors[index % cardColors.length];

    html += `
      <div class="trainer-overview-card trainer-slim ${cardClass}">
        <div style="
          display:grid;
          grid-template-columns:70px 1.2fr 0.8fr 0.8fr 0.7fr 0.8fr 150px;
          gap:14px;
          align-items:center;
        ">

          <div class="trainer-overview-icon">👥</div>

          <div>
            <div style="font-size:18px;font-weight:900;">
              ${group.gruppenname || group.gruppe_id || '-'}
            </div>
            <div class="small">
              ${renderGroupTrainingTimeBadges(group.trainingszeit)}
            </div>
          </div>

          <div>
            🏅 ${sportsMap[String(group.sport_id || '').trim()] || '-'}
          </div>

          <div>
            <b>Trainer</b><br>
            ${groupTrainers || '-'}
          </div>

          <div>
            <b>Schüler</b><br>
            👥 ${groupStudents.length}
          </div>

          <div>
            <b>Heute anwesend</b><br>
            ✅ ${groupTodayPresent}
          </div>

          <div class="group-overview-actions">
            <button
              class="group-action-btn view"
              onclick="showCustomMessage('Gruppenansicht ist in der Anwesenheitsansicht verfügbar.')">
              👁
            </button>

            <button
              class="group-action-btn edit"
              onclick="openEditGroup('${groupId}')">
              <img
                src="https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Buttons/Stud_Edit.png"
                alt="Bearbeiten">
            </button>

            <button
              class="group-action-btn delete"
              onclick="deleteGroup('${groupId}')">
              <img
                src="https://whorwleydkziejjafsea.supabase.co/storage/v1/object/public/Buttons/Stud_Delete.png"
                alt="Löschen">
            </button>
          </div>

        </div>
      </div>
    `;
  });

  document.getElementById('groupOverviewContent').innerHTML = html;
  document.getElementById('mainStatus').textContent = '';
}

async function loadGroupOverviewSportFilter() {

  const select =
    document.getElementById('groupOverviewSportFilter');

  if(!select)return;

  select.innerHTML = `
    <option value="">
      Alle Sportarten
    </option>
  `;

  const {data,error}=await db
    .from('sports')
    .select('sport_id, name')
    .eq('aktiv','JA')
    .eq('club_id', currentClub.club_id)
    .order('sort_order',{ascending:true});

  if(error){
    console.error(error);
    select.innerHTML = '<option value="">Fehler beim Laden der Sportarten</option>';
    return;
  }

  (data || []).forEach(function(sport){

    select.innerHTML += `
      <option value="${sport.sport_id}">
        ${sport.name}
      </option>
    `;

  });

  select.value = getSelectedClubSport();

}

async function handleGroupOverviewSportFilterChange() {

  const select =
    document.getElementById('groupOverviewSportFilter');

  setSelectedClubSport(
    select?.value || ''
  );

  await showGroupOverviewScreen();

}

async function handleTrainerOverviewSportFilterChange() {

  const select =
    document.getElementById('trainerOverviewSportFilter');

  setSelectedClubSport(
    select?.value || ''
  );

  await loadTrainerAdminOverview();

}

async function handleAttendanceStatSportFilterChange() {

  const select =
    document.getElementById('attendanceStatSportFilter');

  setSelectedClubSport(
    select?.value || ''
  );

  await loadAttendanceStatSportFilter();

  await loadAdminStatistikFilters();

}

async function loadTrainerOverviewSportFilter() {

  const select =
    document.getElementById('trainerOverviewSportFilter');

  if(!select)return;

  select.innerHTML = `
    <option value="">
      Alle Sportarten
    </option>
  `;

  const {data,error}=await db
    .from('sports')
    .select('sport_id, name')
    .eq('aktiv','JA')
    .eq('club_id', currentClub.club_id)
    .order('sort_order',{ascending:true});

  if(error){
    console.error(error);
    select.innerHTML = '<option value="">Fehler beim Laden der Sportarten</option>';
    return;
  }

  (data || []).forEach(function(sport){

    select.innerHTML += `
      <option value="${sport.sport_id}">
        ${sport.name}
      </option>
    `;

  });

  select.value = getSelectedClubSport();

}

async function loadAttendanceStatSportFilter() {

  const select =
    document.getElementById('attendanceStatSportFilter');

  if(!select)return;

  select.innerHTML = `
    <option value="">
      Alle Sportarten
    </option>
  `;

  const {data,error}=await db
    .from('sports')
    .select('sport_id, name')
    .eq('aktiv','JA')
    .eq('club_id', currentClub.club_id)
    .order('sort_order',{ascending:true});

  if(error){
    console.error(error);
    select.innerHTML = '<option value="">Fehler beim Laden der Sportarten</option>';
    return;
  }

  (data || []).forEach(function(sport){

    select.innerHTML += `
      <option value="${sport.sport_id}">
        ${sport.name}
      </option>
    `;

  });

  select.value = getSelectedClubSport();

}

async function openEditGroup(groupId) {
  if (!groupId) return;

  previousView = 'groupOverview';
  currentView = 'editGroup';

  const { data: group, error } = await db
    .from('groups')
    .select('*')
    .eq('gruppe_id', groupId)
    .single();

  if (error || !group) {
    showCustomMessage('Gruppe nicht gefunden.');
    return;
  }

  hideAllWorkScreens();

  document.getElementById('editGroupScreen').classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Gruppe bearbeiten';

  document.getElementById('editGroupIdHidden').value = group.gruppe_id || '';
  document.getElementById('editGroupIdDisplay').value = group.gruppe_id || '';
  document.getElementById('editGroupNameNew').value = group.gruppenname || '';
  document.getElementById('editGroupAlterNew').value = group.alter || '';
  document.getElementById('editGroupNiveauNew').value = group.niveau || '';
 
  await loadEditGroupTrainerCheckboxes(groupId, group.sport_id || '');
  setEditTrainingDaysFromGroup(group);
}

async function loadEditGroupTrainerCheckboxes(groupId, groupSportId) {
  const box = document.getElementById('editGroupTrainerCheckboxBox');
  const text = document.getElementById('editGroupSelectedTrainerText');

  if (!box || !text) return;

  const [trainersResult, linksResult] = await Promise.all([
    db.from('trainers').select('*').eq('aktiv', 'JA').eq('rolle', 'Trainer').eq('club_id', currentClub.club_id).order('name', { ascending: true }),
    db.from('trainer_groups').select('*').eq('gruppe_id', groupId).eq('club_id', currentClub.club_id)
  ]);

  const allTrainers = (trainersResult.data || []).filter(trainer => {
    if (!groupSportId) return true;
    const trainerSports = String(trainer.sport_id || '')
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);
    return trainerSports.includes(groupSportId);
  });

  const selectedTrainerIds = (linksResult.data || [])
    .map(row => String(row.trainer_id || '').trim());

  box.innerHTML = allTrainers.map(trainer => {
    const checked = selectedTrainerIds.includes(String(trainer.trainer_id)) ? 'checked' : '';

    return `
      <label class="check-line">
        <input
          type="checkbox"
          class="editGroupTrainerCheckbox"
          value="${trainer.trainer_id}"
          data-name="${trainer.name || ''}"
          onchange="updateEditGroupSelectedTrainerText()"
          ${checked}
        >
        ${trainer.name || '-'}
      </label>
    `;
  }).join('');

  updateEditGroupSelectedTrainerText();
}

function toggleEditGroupTrainerBox() {
  const box = document.getElementById('editGroupTrainerCheckboxBox');
  if (box) box.classList.toggle('hidden');
}

function updateEditGroupSelectedTrainerText() {
  const text = document.getElementById('editGroupSelectedTrainerText');
  const checked = Array.from(
    document.querySelectorAll('.editGroupTrainerCheckbox:checked')
  );

  if (!text) return;

  if (checked.length === 0) {
    text.textContent = 'Trainer auswählen...';
    return;
  }

  text.textContent = checked
    .map(cb => cb.dataset.name || cb.value)
    .join(', ');
}

async function saveEditedGroup() {
  const groupId = document.getElementById('editGroupIdHidden')?.value || '';

  const gruppenname = document.getElementById('editGroupNameNew')?.value?.trim() || '';
  const alter = document.getElementById('editGroupAlterNew')?.value?.trim() || '';
  const niveau = document.getElementById('editGroupNiveauNew')?.value?.trim() || '';
  const trainingstag = document.getElementById('editGroupTrainingstagNew')?.value?.trim() || '';
  const trainingszeit = document.getElementById('editGroupTrainingszeitNew')?.value?.trim() || '';

  if (!groupId || !gruppenname) {
    showCustomMessage('Bitte Gruppenname eingeben.');
    return;
  }

  const checkedTrainers = Array.from(
    document.querySelectorAll('.editGroupTrainerCheckbox:checked')
  );

  const trainerNames = checkedTrainers
    .map(cb => cb.dataset.name || '')
    .filter(Boolean)
    .join(', ');

  const { error: groupError } = await db
    .from('groups')
    .update({
      gruppenname,
      alter,
      niveau,
      trainingstag,
      trainingszeit,
      trainer: trainerNames,
      aktiv: 'JA'
    })
    .eq('gruppe_id', groupId);

  if (groupError) {
    showCustomMessage('Fehler beim Speichern: ' + groupError.message);
    return;
  }

  const { error: deleteGroupLinksError } = await db
    .from('trainer_groups')
    .delete()
    .eq('gruppe_id', groupId);

  if (deleteGroupLinksError) {
    showCustomMessage('Fehler beim Entfernen der Trainer-Zuordnungen: ' + deleteGroupLinksError.message);
    return;
  }

  const rows = checkedTrainers.map(cb => ({
    trainer_id: cb.value,
    trainer_name: cb.dataset.name || '',
    gruppe_id: groupId,
    gruppenname,
    club_id: currentClub.club_id
  }));

  if (rows.length > 0) {
    const { error: linkError } = await db
      .from('trainer_groups')
      .insert(rows);

    if (linkError) {
      showCustomMessage('Gruppe gespeichert, aber Trainer-Zuordnung Fehler: ' + linkError.message);
      return;
    }
  }

  showCustomMessage(
'Gruppe gespeichert',
'Die Gruppendaten wurden erfolgreich gespeichert.',
'success'
);

  await backToGroupOverview();
}

async function deleteGroup(groupId) {
  if (!groupId) return;

  document.getElementById('deleteConfirmText').textContent =
'Gruppe wirklich deaktivieren?\n\nSchüler werden nicht gelöscht.';

document.getElementById('confirmDeleteBtn').onclick =
async function(){

closeDeleteConfirm();

const { error: groupError } = await db
.from('groups')
.update({ aktiv: 'NEIN' })
.eq('gruppe_id', groupId);

if (groupError) {
showCustomMessage('Fehler beim Deaktivieren: ' + groupError.message);
return;
}

const { error: deleteLinksError } = await db
.from('trainer_groups')
.delete()
.eq('gruppe_id', groupId);

if (deleteLinksError) {
  showCustomMessage('Fehler beim Entfernen der Trainer-Zuordnungen: ' + deleteLinksError.message);
  return;
}

showCustomMessage('Gruppe wurde deaktiviert.');

await showGroupOverviewScreen();

};

document
.getElementById('deleteConfirmOverlay')
.classList.remove('hidden');

return;

  const { error: groupError } = await db
    .from('groups')
    .update({ aktiv: 'NEIN' })
    .eq('gruppe_id', groupId);

  if (groupError) {
    showCustomMessage('Fehler beim Deaktivieren: ' + groupError.message);
    return;
  }

  await db
    .from('trainer_groups')
    .delete()
    .eq('gruppe_id', groupId);

  showCustomMessage('Gruppe wurde deaktiviert.');

  await showGroupOverviewScreen();
}

async function backToGroupOverview() {
  previousView = 'clubStatistik';
  currentView = 'groupOverview';

  hideAllWorkScreens();

  document.getElementById('groupOverviewScreen').classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Gruppen Übersicht';

  await showGroupOverviewScreen();
}

function toggleEditTrainingDaysBox() {
  const box = document.getElementById('editTrainingDaysCheckboxBox');
  if (box) box.classList.toggle('hidden');
}

function getEditSelectedTrainingDays() {
  return Array.from(
    document.querySelectorAll('#editTrainingDaysCheckboxBox input[type="checkbox"]:checked')
  ).map(cb => cb.value);
}

function updateEditTrainingDaysText() {
  const days = getEditSelectedTrainingDays();

  document.getElementById('editSelectedTrainingDaysText').textContent =
    days.length ? days.join(', ') : 'Trainingstage auswählen...';

  document.getElementById('editGroupTrainingstagNew').value =
    days.join(', ');

  renderEditTrainingDayTimeFields(days);
}

function renderEditTrainingDayTimeFields(days, existingTimes = {}) {
  const box = document.getElementById('editTrainingDayTimesBox');
  if (!box) return;

  if (!days.length) {
    box.innerHTML = '<div class="small">Bitte zuerst Trainingstage auswählen.</div>';
    document.getElementById('editGroupTrainingszeitNew').value = '';
    return;
  }

  box.innerHTML = days.map(day => `
    <div class="day-time-line">
      <div class="day-time-label">${day}</div>
      <input
        class="day-time-input editDayTimeInput"
        data-day="${day}"
        value="${existingTimes[day] || ''}"
        placeholder="z.B. 16:30-17:30"
        oninput="collectEditTrainingTimesByDay()">
    </div>
  `).join('');

  collectEditTrainingTimesByDay();
}

function collectEditTrainingTimesByDay() {
  const result = Array.from(
    document.querySelectorAll('.editDayTimeInput')
  )
    .map(input => {
      const day = input.dataset.day;
      const time = input.value.trim();
      return time ? `${day} ${time}` : '';
    })
    .filter(Boolean)
    .join('; ');

  document.getElementById('editGroupTrainingszeitNew').value = result;
}

function normalizeTrainingDay(value) {
  const v = String(value || '').replace('.', '').trim();

  const map = {
    Montag: 'Mo',
    Dienstag: 'Di',
    Mittwoch: 'Mi',
    Donnerstag: 'Do',
    Freitag: 'Fr',
    Samstag: 'Sa',
    Sonntag: 'So',
    Mo: 'Mo',
    Di: 'Di',
    Mi: 'Mi',
    Do: 'Do',
    Fr: 'Fr',
    Sa: 'Sa',
    So: 'So'
  };

  return map[v] || '';
}

function parseEditTrainingDaysAndTimes(daysText, timeText) {
  const days = [];
  const times = {};

  String(daysText || '')
    .split(/[;,]/)
    .map(x => normalizeTrainingDay(x))
    .filter(Boolean)
    .forEach(day => {
      if (!days.includes(day)) days.push(day);
    });

  String(timeText || '')
    .split(';')
    .map(x => x.trim())
    .filter(Boolean)
    .forEach(part => {
      const match = part.match(/^(Mo|Di|Mi|Do|Fr|Sa|So)\.?\s+(.+)$/);
      if (!match) return;

      const day = normalizeTrainingDay(match[1]);
      const time = match[2];

      if (day) {
        times[day] = time;
        if (!days.includes(day)) days.push(day);
      }
    });

  return { days, times };
}

function setEditTrainingDaysFromGroup(group) {
  const parsed = parseEditTrainingDaysAndTimes(
    group.trainingstag || '',
    group.trainingszeit || ''
  );

  document
    .querySelectorAll('#editTrainingDaysCheckboxBox input[type="checkbox"]')
    .forEach(cb => {
      cb.checked = parsed.days.includes(cb.value);
    });

  document.getElementById('editSelectedTrainingDaysText').textContent =
    parsed.days.length ? parsed.days.join(', ') : 'Trainingstage auswählen...';

  document.getElementById('editGroupTrainingstagNew').value =
    parsed.days.join(', ');

  renderEditTrainingDayTimeFields(parsed.days, parsed.times);
}

function renderGroupTrainingTimeBadges(trainingTimeText) {
  const colors = ['blue', 'green', 'orange', 'purple', 'red'];

  const parts = String(trainingTimeText || '')
    .split(';')
    .map(x => x.trim())
    .filter(Boolean);

  if (!parts.length) return '-';

  return `
    <div class="group-time-badges">
      ${parts.map((part, index) => `
        <span class="group-time-badge ${colors[index % colors.length]}">
          ${part}
        </span>
      `).join('')}
    </div>
  `;
}

async function showAdminStatistikCenter() {
  if (!currentTrainer || currentTrainer.role !== 'Admin') return;

  previousView = 'clubStatistik';
  currentView = 'adminStatistikCenter';

  hideAllWorkScreens();

  document
    .getElementById('adminStatistikScreen')
    .classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Studenten Anwesenheit Statistik';

  document.getElementById('mainStatus').textContent = '';

  await loadAttendanceStatSportFilter();
  await loadAdminStatistikFilters();
}

async function loadAdminAttendanceFiltersSupabase() {
  await Promise.all([
    loadAdminAttendanceGroupsSupabase(),
    loadAdminAttendanceTrainersSupabase()
  ]);
}

async function loadAdminAttendanceGroupsSupabase() {
  await loadAdminStatistikFilters();
}

async function loadAdminAttendanceTrainersSupabase() {
  await loadAdminStatistikFilters();
}

async function loadAdminStatistikFilters() {
  const selectedSport = getSelectedClubSport();

  const [groupsResult, trainersResult, linksResult, sportsResult] = await Promise.all([
    db.from('groups').select('*').eq('aktiv', 'JA').eq('club_id', currentClub.club_id).order('gruppenname', { ascending: true }),
    db.from('trainers').select('*').eq('aktiv', 'JA').eq('club_id', currentClub.club_id).order('name', { ascending: true }),
    db.from('trainer_groups').select('*').eq('club_id', currentClub.club_id),
    db.from('sports').select('sport_id, name').eq('aktiv', 'JA').eq('club_id', currentClub.club_id)
  ]);

  if (groupsResult.error || trainersResult.error || linksResult.error || sportsResult.error) {
    document.getElementById('mainStatus').textContent =
      'Fehler beim Laden der Filter.';
    return;
  }

  let groups = groupsResult.data || [];

  let trainers = (trainersResult.data || []).filter(t =>
    String(t.rolle || '').toUpperCase() === 'TRAINER'
  );

  if (selectedSport) {
    groups = groups.filter(group =>
      String(group.sport_id || '') === String(selectedSport)
    );

    trainers = trainers.filter(trainer =>
      String(trainer.sport_id || '')
        .split(/[;,]/)
        .map(x => x.trim())
        .includes(selectedSport)
    );
  }

  window.adminStatGroupsSupabase = groups;
  window.adminStatTrainersSupabase = trainers;
  window.adminStatTrainerGroupsSupabase = linksResult.data || [];
  window.adminStatSportsSupabase = sportsResult.data || [];

  rebuildAdminStatGroupSelectSupabase();
  rebuildAdminStatTrainerSelectSupabase();

  document.getElementById('mainStatus').textContent = '';
}

function rebuildAdminStatGroupSelectSupabase() {
  const groupSelect = document.getElementById('adminStatGroup');
  const trainerSelect = document.getElementById('adminStatTrainer');

  if (!groupSelect) return;

  const selectedTrainerId = trainerSelect ? trainerSelect.value : '';
  const oldValue = groupSelect.value;

  let groups = window.adminStatGroupsSupabase || [];

  if (selectedTrainerId) {
    const allowedGroupIds = (window.adminStatTrainerGroupsSupabase || [])
      .filter(x => String(x.trainer_id) === String(selectedTrainerId))
      .map(x => String(x.gruppe_id));

    groups = groups.filter(g =>
      allowedGroupIds.includes(String(g.gruppe_id))
    );
  }

  groupSelect.innerHTML = '<option value="">Alle Gruppen</option>';

  groups.forEach(group => {
    const option = document.createElement('option');
    option.value = group.gruppe_id;
    option.textContent = group.gruppenname || group.gruppe_id;
    groupSelect.appendChild(option);
  });

  if ([...groupSelect.options].some(opt => opt.value === oldValue)) {
    groupSelect.value = oldValue;
  }
}

function rebuildAdminStatTrainerSelectSupabase() {
  const groupSelect = document.getElementById('adminStatGroup');
  const trainerSelect = document.getElementById('adminStatTrainer');

  if (!trainerSelect) return;

  const selectedGroupId = groupSelect ? groupSelect.value : '';
  const oldValue = trainerSelect.value;

  let trainers = window.adminStatTrainersSupabase || [];

  if (selectedGroupId) {
    const allowedTrainerIds = (window.adminStatTrainerGroupsSupabase || [])
      .filter(x => String(x.gruppe_id) === String(selectedGroupId))
      .map(x => String(x.trainer_id));

    trainers = trainers.filter(t =>
      allowedTrainerIds.includes(String(t.trainer_id))
    );
  }

  trainerSelect.innerHTML = '<option value="">Alle Trainer</option>';

  trainers.forEach(trainer => {
    const option = document.createElement('option');
    option.value = trainer.trainer_id;
    option.textContent = trainer.name || trainer.trainer_id;
    trainerSelect.appendChild(option);
  });

  if ([...trainerSelect.options].some(opt => opt.value === oldValue)) {
    trainerSelect.value = oldValue;
  }
}

async function loadAdminAttendanceStatisticsSupabase() {
  const resultBox = document.getElementById('adminAttendanceResult');

  if (!resultBox) return;

  resultBox.innerHTML = 'Statistik wird geladen.';

  const selectedSport = getSelectedClubSport();

  const dateFrom = document.getElementById('adminStatDateFrom')?.value || '';
  const dateTo = document.getElementById('adminStatDateTo')?.value || '';
  const gruppeId = document.getElementById('adminStatGroup')?.value || '';
  const trainerId = document.getElementById('adminStatTrainer')?.value || '';

  let allowedGroupIds = [];

  if (selectedSport) {
    allowedGroupIds = (window.adminStatGroupsSupabase || [])
      .filter(group => String(group.sport_id || '') === String(selectedSport))
      .map(group => String(group.gruppe_id || '').trim())
      .filter(Boolean);

    if (allowedGroupIds.length === 0) {
      resultBox.innerHTML = '<div class="small">Keine Daten gefunden.</div>';
      return;
    }
  }

  let query = db
    .from('attendance')
    .select('*')
    .eq('anwesenheit', 'JA')
    .eq('club_id', currentClub.club_id);

  if (dateFrom) {
    query = query.gte('datum', dateFrom);
  }

  if (dateTo) {
    query = query.lte('datum', dateTo + 'T23:59:59');
  }

  if (gruppeId) {
    query = query.eq('gruppe_id', gruppeId);
  }

  const { data, error } = await query;

  if (error) {
    resultBox.innerHTML = 'Fehler: ' + error.message;
    return;
  }

  let rows = data || [];

  if (selectedSport && !gruppeId) {
    rows = rows.filter(row =>
      allowedGroupIds.includes(
        String(row.gruppe_id || '').trim()
      )
    );
  }

  if (trainerId) {
    const trainer = (window.adminStatTrainersSupabase || [])
      .find(t => String(t.trainer_id) === String(trainerId));

    const trainerName = trainer ? trainer.name : '';

    rows = rows.filter(row =>
      String(row.trainer || '').trim() === String(trainerName).trim()
    );
  }

  if (rows.length === 0) {
    resultBox.innerHTML = '<div class="small">Keine Daten gefunden.</div>';
    return;
  }

  const groupMap = {};
  (window.adminStatGroupsSupabase || []).forEach(group => {
    groupMap[String(group.gruppe_id)] =
      group.gruppenname || group.gruppe_id;
  });

  const sportNameMap = {};
  (window.adminStatSportsSupabase || []).forEach(sport => {
    sportNameMap[String(sport.sport_id)] = sport.name || '-';
  });

  const groupSportMap = {};
  (window.adminStatGroupsSupabase || []).forEach(group => {
    groupSportMap[String(group.gruppe_id)] = String(group.sport_id || '');
  });

  const resultMap = {};

  rows.forEach(row => {
    const dateKey = String(row.datum || '').slice(0, 10);
    const groupKey = String(row.gruppe_id || '');

    if (!dateKey || !groupKey) return;

    const key = dateKey + '|' + groupKey;

    if (!resultMap[key]) {
      const sportId = groupSportMap[groupKey] || '';
      resultMap[key] = {
        dateKey,
        datum: dateKey.split('-').reverse().join('.'),
        gruppeName: groupMap[groupKey] || groupKey,
        sportName: sportNameMap[sportId] || '-',
        trainer: row.trainer || '-',
        students: {}
      };
    }

    if (row.student_id) {
      resultMap[key].students[String(row.student_id)] = true;
    }
  });

  const finalRows = Object.values(resultMap)
    .map(item => ({
      ...item,
      anwesend: Object.keys(item.students).length
    }))
    .sort((a, b) =>
      String(a.dateKey).localeCompare(String(b.dateKey)) ||
      String(a.gruppeName).localeCompare(String(b.gruppeName))
    );

  const totalPresent = finalRows.reduce(
    (sum, row) => sum + row.anwesend,
    0
  );

  const groupedByDate = {};

  finalRows.forEach(row => {
    if (!groupedByDate[row.datum]) {
      groupedByDate[row.datum] = [];
    }

    groupedByDate[row.datum].push(row);
  });

  const colors = [
    'attendance-date-card-0',
    'attendance-date-card-1',
    'attendance-date-card-2',
    'attendance-date-card-3'
  ];

  let html = `
    <div class="stat-summary-grid">
      <div class="stat-card">
        <b>Gefundene Einträge</b>
        <div class="big-number">${finalRows.length}</div>
      </div>

      <div class="stat-card">
        <b>Gesamt Anwesenheit</b>
        <div class="big-number">${totalPresent}</div>
      </div>
    </div>
  `;

  Object.keys(groupedByDate).forEach((date, index) => {
    const dateRows = groupedByDate[date];

    html += `
      <div class="attendance-date-card ${colors[index % colors.length]}">
        <div class="attendance-date-title">📅 ${date}</div>
    `;

    dateRows.forEach(row => {
      html += `
        <div class="attendance-date-row">
          <div>
            <b>Sportart</b><br>
            ${row.sportName}
          </div>

          <div>
            <b>Gruppe</b><br>
            ${row.gruppeName}
          </div>

          <div>
            <b>Trainer</b><br>
            ${row.trainer || '-'}
          </div>

          <div>
            <b>Anwesend</b><br>
            <span class="attendance-date-count">${row.anwesend}</span>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  });

  resultBox.innerHTML = html;
}

async function showAddGroup() {
  if (!currentTrainer || currentTrainer.role !== 'Admin') return;

  previousView = 'adminScreen';
  currentView = 'addGroup';

  hideAllWorkScreens();

  document
    .getElementById('addGroupScreen')
    .classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Neue Gruppe hinzufügen';

  document.getElementById('mainStatus').textContent = '';

  if (typeof loadTrainerCheckboxes === 'function') {
    await loadTrainerCheckboxes();
  }

  if (typeof loadSportsForNewGroup === 'function') {
  await loadSportsForNewGroup();
}

  if (typeof resetTrainingDays === 'function') {
    resetTrainingDays();
  }
}

async function loadSportsForNewGroup() {

  const select =
    document.getElementById('newGroupSport');

  if (!select) return;

  select.innerHTML = `
    <option value="">
      Sportarten werden geladen...
    </option>
  `;

  const { data, error } = await db
    .from('sports')
    .select('sport_id, name')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('sort_order', { ascending: true });

  if (error) {

    console.error(error);

    select.innerHTML = `
      <option value="">
        Fehler beim Laden
      </option>
    `;

    return;
  }

  select.innerHTML = `
    <option value="">
      Sportart auswählen...
    </option>
  `;

  (data || []).forEach(function(sport) {

    select.innerHTML += `
      <option value="${sport.sport_id}">
        ${sport.name}
      </option>
    `;

  });

}

async function loadTrainerCheckboxes() {
  const list = document.getElementById('trainerCheckboxList');
  const noTrainer = document.getElementById('noTrainerCheckbox');

  if (!list) return;

  list.innerHTML = 'Trainer werden geladen...';

  const selectedSport =
  document.getElementById('newGroupSport')?.value || '';

let query = db
  .from('trainers')
  .select('*')
  .eq('aktiv', 'JA')
  .eq('rolle', 'Trainer')
  .eq('club_id', currentClub.club_id)
  .order('name', { ascending: true });

if (selectedSport) {
  query = query.ilike('sport_id', '%' + selectedSport + '%');
}

const { data, error } = await query;

  if (error) {
    list.innerHTML = 'Fehler beim Laden.';
    return;
  }

  list.innerHTML = (data || []).map(trainer => `
    <label class="check-line">
      <input
        type="checkbox"
        class="newGroupTrainerCheckbox"
        value="${trainer.trainer_id}"
        data-name="${trainer.name || ''}"
        onchange="updateSelectedTrainerText()"
      >
      ${trainer.name || '-'}
    </label>
  `).join('');

  if (noTrainer) noTrainer.checked = false;
  updateSelectedTrainerText();
}

function toggleTrainerCheckboxBox() {
  document
    .getElementById('trainerCheckboxBox')
    ?.classList.toggle('hidden');
}

function handleNoTrainerCheckbox() {
  const noTrainer = document.getElementById('noTrainerCheckbox');
  const checks = document.querySelectorAll('.newGroupTrainerCheckbox');

  if (noTrainer?.checked) {
    checks.forEach(cb => cb.checked = false);
  }

  updateSelectedTrainerText();
}

function updateSelectedTrainerText() {
  const text = document.getElementById('selectedTrainerText');
  const noTrainer = document.getElementById('noTrainerCheckbox');

  const checked = Array.from(
    document.querySelectorAll('.newGroupTrainerCheckbox:checked')
  );

  if (!text) return;

  if (noTrainer?.checked) {
    text.textContent = 'Kein Trainer';
    return;
  }

  text.textContent = checked.length
    ? checked.map(cb => cb.dataset.name || cb.value).join(', ')
    : 'Trainer auswählen...';
}

function toggleTrainingDaysBox() {
  document
    .getElementById('trainingDaysCheckboxBox')
    ?.classList.toggle('hidden');
}

function getSelectedTrainingDays() {
  return Array.from(
    document.querySelectorAll('#trainingDaysCheckboxBox input[type="checkbox"]:checked')
  ).map(cb => cb.value);
}

function updateTrainingDaysText() {
  const days = getSelectedTrainingDays();

  document.getElementById('selectedTrainingDaysText').textContent =
    days.length ? days.join(', ') : 'Trainingstage auswählen...';

  renderTrainingDayTimeFields(days);
}

function renderTrainingDayTimeFields(days) {
  const box = document.getElementById('trainingDayTimesBox');
  if (!box) return;

  if (!days.length) {
    box.innerHTML = '<div class="small">Bitte zuerst Trainingstage auswählen.</div>';
    document.getElementById('newTrainingszeit').value = '';
    return;
  }

  box.innerHTML = days.map(day => `
    <div class="day-time-line">
      <div class="day-time-label">${day}</div>
      <input
        class="day-time-input newDayTimeInput"
        data-day="${day}"
        placeholder="z.B. 16:30-17:30"
        oninput="collectNewTrainingTimesByDay()">
    </div>
  `).join('');

  collectNewTrainingTimesByDay();
}

function collectNewTrainingTimesByDay() {
  const result = Array.from(
    document.querySelectorAll('.newDayTimeInput')
  )
    .map(input => {
      const day = input.dataset.day;
      const time = input.value.trim();
      return time ? `${day} ${time}` : '';
    })
    .filter(Boolean)
    .join('; ');

  document.getElementById('newTrainingszeit').value = result;
}

function resetTrainingDays() {
  document
    .querySelectorAll('#trainingDaysCheckboxBox input[type="checkbox"]')
    .forEach(cb => cb.checked = false);

  document.getElementById('selectedTrainingDaysText').textContent =
    'Trainingstage auswählen...';

  document.getElementById('trainingDayTimesBox').innerHTML =
    '<div class="small">Bitte zuerst Trainingstage auswählen.</div>';

  document.getElementById('newTrainingszeit').value = '';
}

async function saveNewGroup() {
  const gruppenname = document.getElementById('newGruppenname')?.value.trim() || '';
  const gruppeId = document.getElementById('newGruppeId')?.value.trim() || '';
  const alter = document.getElementById('newAlter')?.value.trim() || '';
  const niveau = document.getElementById('newNiveau')?.value.trim() || '';
  const trainingszeit = document.getElementById('newTrainingszeit')?.value.trim() || '';
  const notizen = document.getElementById('newGroupNotes')?.value.trim() || '';
  const sportId =
  document.getElementById('newGroupSport')?.value ||
  getSelectedClubSport();

  const trainingstage = getSelectedTrainingDays().join(', ');

  const checkedTrainers = Array.from(
    document.querySelectorAll('.newGroupTrainerCheckbox:checked')
  );

  const trainerNames = checkedTrainers
    .map(cb => cb.dataset.name || '')
    .filter(Boolean)
    .join(', ');

  if (!gruppenname) {
    showCustomMessage('Bitte Gruppennamen eingeben.');
    return;
  }

  if (!gruppeId) {
    showCustomMessage('Bitte GruppeID eingeben.');
    return;
  }

  if (!sportId) {
    showCustomMessage('Bitte zuerst Sportart auswählen.');
    return;
  }

  const { data: existingGroup } = await db
    .from('groups')
    .select('gruppe_id')
    .eq('gruppe_id', gruppeId)
    .maybeSingle();

  if (existingGroup) {
    showCustomMessage('Diese GruppeID existiert bereits.');
    return;
  }

  const { error: groupError } = await db
    .from('groups')
    .insert([{
      gruppe_id: gruppeId,
      gruppenname,
      alter,
      niveau,
      trainingstag: trainingstage,
      trainingszeit,
      trainer: trainerNames,
      notizen,
      sport_id: sportId,
      aktiv: 'JA',
      club_id: currentClub.club_id
    }]);

  if (groupError) {
    showCustomMessage(
      'Fehler beim Speichern der Gruppe: ' +
      groupError.message
    );
    return;
  }

  const rows = checkedTrainers.map(cb => ({
    trainer_id: cb.value,
    trainer_name: cb.dataset.name || '',
    gruppe_id: gruppeId,
    gruppenname,
    club_id: currentClub.club_id
  }));

  if (rows.length > 0) {
    const { error: linkError } = await db
      .from('trainer_groups')
      .insert(rows);

    if (linkError) {
      showCustomMessage(
        'Gruppe gespeichert, aber Trainer-Zuordnung Fehler: ' +
        linkError.message
      );
      return;
    }
  }

  showCustomMessage(
    'Gruppe wurde erfolgreich gespeichert.\n\n' +
    'Sportart: ' + sportId + '\n' +
    'Gruppenname: ' + gruppenname + '\n' +
    'Alter: ' + (alter || '-') + '\n' +
    'Trainingstage: ' + (trainingstage || '-') + '\n' +
    'Trainingszeit: ' + (trainingszeit || '-') + '\n' +
    'Trainer: ' + (trainerNames || '-'),

    async function() {
      clearNewGroupForm();

      await showPromoTransition(async () => {
        await showGroupOverviewScreen();
      });
    }
  );

  return;
}

function clearNewGroupForm() {
  document.getElementById('newGruppenname').value = '';
  document.getElementById('newGruppeId').value = '';
  document.getElementById('newAlter').value = '';
  document.getElementById('newNiveau').value = '';
  document.getElementById('newTrainingszeit').value = '';
  document.getElementById('newGroupNotes').value = '';

  document
    .querySelectorAll('.newGroupTrainerCheckbox')
    .forEach(cb => cb.checked = false);

  const noTrainer = document.getElementById('noTrainerCheckbox');
  if (noTrainer) noTrainer.checked = false;

  updateSelectedTrainerText();
  resetTrainingDays();
}

async function backToTrainerStatistik() {

  hideAllWorkScreens();

  if (previousView === 'adminBuchhaltung') {

    currentView = 'adminBuchhaltung';

    document
      .getElementById('adminBuchhaltungScreen')
      .classList.remove('hidden');

    document.getElementById('currentGroupInfo').textContent =
      'Aktuelle Seite: Administrator / Buchhaltung';

    await loadAdminBuchhaltungUsers();

    return;
  }

  previousView = 'clubStatistik';
  currentView = 'trainerAdminFromClub';

  document
    .getElementById('trainerAdminScreen')
    .classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Club Statistik / Trainer Statistik';

  await loadTrainerAdminOverview();
}

async function openTrainerStatistikFromAdmin() {
  previousView = 'adminScreen';
  currentView = 'trainerAdmin';

  await openTrainerStatistikScreen();

  currentView = 'trainerAdmin';
  previousView = 'adminScreen';

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Trainer Statistik';
}

async function showAddAdminBuchForm() {

  if (!currentTrainer || currentTrainer.role !== 'Admin') return;

  previousView = 'adminBuchhaltung';
  currentView = 'addTrainer';

  hideAllWorkScreens();

  document
    .getElementById('addTrainerScreen')
    .classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Neuen Administrator / Buchhalter hinzufügen';

  document.getElementById('mainStatus').textContent = '';

  document.getElementById('newTrainerNachname').value = '';
  document.getElementById('newTrainerVorname').value = '';
  document.getElementById('newTrainerTelefon').value = '';
  document.getElementById('newTrainerEmail').value = '';
  document.getElementById('newTrainerPin').value = '';

  const roleSelect =
    document.getElementById('newTrainerRole');

  if (roleSelect) {
    roleSelect.innerHTML = `
      <option value="Admin">Admin</option>
      <option value="Buchhaltung">Buchhaltung</option>
    `;
    roleSelect.value = 'Admin';
  }

  const groupsBox =
    document.getElementById('newTrainerGroupsBox');

  const groupsCard =
    groupsBox
      ? groupsBox.closest('.add-trainer-modern-card')
      : null;

  if (groupsBox) {
    groupsBox.innerHTML = '';
  }

  if (groupsCard) {
    groupsCard.classList.add('hidden');
  }

  const heroText =
document.querySelector(
'#addTrainerScreen .add-trainer-hero .small'
);

if(heroText){
heroText.textContent =
'Erstelle einen neuen Administrator oder Buchhalter.';
}

const sectionText =
document.querySelector(
'#addTrainerScreen .add-trainer-section-title .small'
);

if(sectionText){
sectionText.textContent =
'Grundlegende Daten des Administrators oder Buchhalters';
}

  const saveBtn =
    document.querySelector('#addTrainerScreen .add-trainer-save');

  if (saveBtn) {
    saveBtn.textContent = '✓ Zugang speichern';
  }
}

async function showAddTrainer() {
  if (!currentTrainer || currentTrainer.role !== 'Admin') return;

  previousView = 'adminScreen';
  currentView = 'addTrainer';

  hideAllWorkScreens();

  document
    .getElementById('addTrainerScreen')
    .classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Neuen Trainer hinzufügen';

  document.getElementById('mainStatus').textContent = '';

  await loadSportsForNewTrainer();
  await loadNewTrainerGroups();
}

async function loadSportsForNewTrainer() {

  const select =
    document.getElementById('newTrainerSport');

  if (!select) return;

  select.innerHTML = `
    <option value="">
      Sportarten werden geladen...
    </option>
  `;

  const { data, error } = await db
    .from('sports')
    .select('sport_id, name')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('sort_order', { ascending: true });

  if (error) {

    console.error(error);

    select.innerHTML = `
      <option value="">
        Fehler beim Laden
      </option>
    `;

    return;
  }

  select.innerHTML = `
    <option value="">
      Keine Sportart / Verwaltung
    </option>
  `;

  (data || []).forEach(function(sport) {

    select.innerHTML += `
      <option value="${sport.sport_id}">
        ${sport.name}
      </option>
    `;

  });

  await handleNewTrainerSportChange();

}

async function handleNewTrainerSportChange() {

  const sportSelect =
    document.getElementById('newTrainerSport');

  const roleSelect =
    document.getElementById('newTrainerRole');

  if (!sportSelect || !roleSelect) return;

  const selectedSport = sportSelect.value || '';

  const groupsCard =
  document.getElementById('newTrainerGroupsCard');

  if (selectedSport) {

    if (groupsCard) {
  groupsCard.classList.remove('hidden');
}

    roleSelect.innerHTML = `
      <option value="Trainer">Trainer</option>
    `;

    roleSelect.value = 'Trainer';

    await loadNewTrainerGroups();

  } else {

    if (groupsCard) {
  groupsCard.classList.add('hidden');
}

    roleSelect.innerHTML = `
      <option value="Admin">Admin</option>
      <option value="Buchhaltung">Buchhaltung</option>
    `;

    roleSelect.value = 'Admin';
  }

}

async function loadNewTrainerGroups() {
  const box = document.getElementById('newTrainerGroupsBox');
  if (!box) return;

  box.innerHTML = 'Gruppen werden geladen...';

  const selectedSport =
  document.getElementById('newTrainerSport')?.value || '';

let query = db
  .from('groups')
  .select('*')
  .eq('aktiv', 'JA')
  .eq('club_id', currentClub.club_id)
  .order('gruppenname', { ascending: true });

if (selectedSport) {
  query = query.eq('sport_id', selectedSport);
}

const { data, error } = await query;

  if (error) {
    box.innerHTML = 'Fehler beim Laden der Gruppen.';
    return;
  }

  box.innerHTML = (data || []).map(group => `
    <label class="add-trainer-group-line">
      <input
        type="checkbox"
        class="newTrainerGroupCheckbox"
        value="${group.gruppe_id}"
        data-name="${group.gruppenname || ''}"
      >
      <span>
        ${group.gruppenname || group.gruppe_id}
        ${group.trainingszeit ? ' ' + group.trainingszeit : ''}
      </span>
    </label>
  `).join('');
}

async function saveNewTrainer() {
  const nachname = document.getElementById('newTrainerNachname')?.value.trim() || '';
  const vorname = document.getElementById('newTrainerVorname')?.value.trim() || '';
  const telefon = document.getElementById('newTrainerTelefon')?.value.trim() || '';
  const email = document.getElementById('newTrainerEmail')?.value.trim() || '';
  const pin = document.getElementById('newTrainerPin')?.value.trim() || '';
  const rolle = document.getElementById('newTrainerRole')?.value || 'Trainer';
  const sportId =
  document.getElementById('newTrainerSport')?.value || '';

  const name = (nachname + ' ' + vorname).trim();

  if (!name) {
    showCustomMessage('Bitte Name eingeben.');
    return;
  }

  if (!pin) {
    showCustomMessage('Bitte PIN eingeben.');
    return;
  }

  const trainerId =
    'TR-' + Date.now().toString().slice(-6);

  const { error: trainerError } = await db
    .from('trainers')
    .insert([{
      trainer_id: trainerId,
      name,
      telefon,
      email,
      pin,
      rolle,
      sport_id: sportId,
      aktiv: 'JA',
      club_id: currentClub.club_id
    }]);

  if (trainerError) {
    showCustomMessage('Fehler beim Speichern des Trainers: ' + trainerError.message);
    return;
  }

  const checkedGroups = Array.from(
    document.querySelectorAll('.newTrainerGroupCheckbox:checked')
  );

  const rows = checkedGroups.map(cb => ({
    trainer_id: trainerId,
    trainer_name: name,
    gruppe_id: cb.value,
    gruppenname: cb.dataset.name || '',
    club_id: currentClub.club_id
  }));

  if (rows.length > 0) {
    const { error: groupError } = await db
      .from('trainer_groups')
      .insert(rows);

    if (groupError) {
      showCustomMessage('Trainer gespeichert, aber Gruppen-Zuordnung Fehler: ' + groupError.message);
      return;
    }
  }

  const roleText =
rolle === 'Buchhaltung'
? 'Buchhalter'
: rolle === 'Admin'
? 'Administrator'
: 'Trainer';

showCustomMessage(
roleText + ' wurde erfolgreich gespeichert.'
);

clearNewTrainerForm();

if(previousView === 'adminBuchhaltung'){

hideAllWorkScreens();

currentView = 'adminBuchhaltung';

document
.getElementById('adminBuchhaltungScreen')
.classList.remove('hidden');

document.getElementById('currentGroupInfo').textContent =
'Aktuelle Seite: Administrator / Buchhaltung';

await loadAdminBuchhaltungUsers();

return;

}

showPromoTransition(async () => {
  await openTrainerStatistikFromAdmin();
});
}

function clearNewTrainerForm() {
  document.getElementById('newTrainerNachname').value = '';
  document.getElementById('newTrainerVorname').value = '';
  document.getElementById('newTrainerTelefon').value = '';
  document.getElementById('newTrainerEmail').value = '';
  document.getElementById('newTrainerPin').value = '';
  document.getElementById('newTrainerRole').value = 'Trainer';

  document
    .querySelectorAll('.newTrainerGroupCheckbox')
    .forEach(cb => cb.checked = false);
}

function addNewSport(){

const popup =
document.getElementById('addSportPopup');

if(!popup)return;

document.getElementById('newSportNameInput').value = '';

document.getElementById('newSportImageSelect').innerHTML =
'<option value="">Bitte zuerst Sportart eingeben</option>';

popup.classList.remove('hidden');

}

function closeAddSportPopup(){

const popup =
document.getElementById('addSportPopup');

if(popup){
popup.classList.add('hidden');
}

}

async function loadMatchingSportImages(){

  const input = document.getElementById('newSportNameInput');
  const select = document.getElementById('newSportImageSelect');

  if(!input || !select)return;

  const searchText = input.value.toLowerCase().trim();

  if(!searchText){
    select.innerHTML =
      '<option value="">Bitte zuerst Sportart eingeben</option>';
    return;
  }

  const fallbackFiles = [
    'BOXEN.png',
    'GYMNASTIK.png',
    'JIU-JITSU.png',
    'JUDO.png',
    'KICKBOXEN.png',
    'MUAY_THAI.png',
    'TAEKWON_DO.png',
    'TAI_CHI.png'
  ];

  const {data,error}=await db.storage
    .from('Sport_ikon')
    .list('',{ limit:100 });

  let files = [];

  if(!error && data && data.length > 0){
    files = data.map(file => file.name);
  }else{
    files = fallbackFiles;
  }

  function normalize(value){
    return String(value || '')
      .toLowerCase()
      .replace(/\.(png|jpg|jpeg|webp)$/g,'')
      .replace(/_/g,' ')
      .replace(/-/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  const search = normalize(searchText);
  const searchCompact = search.replace(/\s/g,'');

  const matches = files.filter(fileName => {

    const fileText = normalize(fileName);
    const fileCompact = fileText.replace(/\s/g,'');

    return (
      fileText.includes(search) ||
      fileCompact.includes(searchCompact) ||
      search.includes(fileText)
    );
  });

  if(matches.length === 0){
    select.innerHTML =
      '<option value="">Keine passende Datei gefunden</option>';
    return;
  }

  select.innerHTML =
    '<option value="">Bitte Bild auswählen</option>' +
    matches.map(fileName => `
      <option value="${fileName}">
        ${fileName}
      </option>
    `).join('');
}

async function saveNewSportFromPopup(){

const nameInput =
document.getElementById('newSportNameInput');

const imageSelect =
document.getElementById('newSportImageSelect');

const sportName =
(nameInput?.value || '').trim();

const iconFile =
imageSelect?.value || '';

if(!sportName){
showCustomMessage('Bitte Sportart Name eingeben.');
return;
}

if(!iconFile){
showCustomMessage('Bitte Bild auswählen.');
return;
}

const sportId =
sportName
.toLowerCase()
.trim()
.replaceAll(' ','')
.replaceAll('-','')
.replaceAll('ä','ae')
.replaceAll('ö','oe')
.replaceAll('ü','ue')
.replaceAll('ß','ss');

const {error}=await db
.from('sports')
.insert([{
sport_id:sportId,
name:sportName,
icon_file:iconFile,
aktiv:'JA',
sort_order:999,
club_id:currentClub.club_id
}]);

if(error){
console.error(error);
showCustomMessage('Sport konnte nicht gespeichert werden: ' + error.message);
return;
}

closeAddSportPopup();
await loadSportManagementList();

}

async function deleteSport(sportId, sportName){

  const displayName = sportName || sportId || '-';

  document.getElementById('deleteConfirmText').innerHTML = `
    <div style="text-align:left;line-height:1.7;">
      <b>Sportart wirklich löschen?</b><br><br>
      <b>Sportart:</b> ${displayName}<br><br>
      Diese Aktion entfernt die Sportart aus der Liste.
    </div>
  `;

  document.getElementById('confirmDeleteBtn').onclick = async function(){

    closeDeleteConfirm();

    const {error}=await db
      .from('sports')
      .delete()
      .eq('sport_id',sportId);

    if(error){

      console.error(error);

      showCustomMessage(
        'Sport konnte nicht gelöscht werden: ' +
        error.message
      );

      return;
    }

    await loadSportManagementList();

    showCustomMessage(
      'Sportart "' + displayName + '" wurde gelöscht.'
    );
  };

  document
    .getElementById('deleteConfirmOverlay')
    .classList.remove('hidden');
}

/* =========================================================
   ZEITRAUM STATISTIK — ЭТАП 1 (визуальная заготовка)
   Supabase-расчёты будут добавлены в следующих этапах.
========================================================= */

async function showZeitraumStatistikScreen() {
  hideAllWorkScreens();
  previousView = 'clubStatistik';
  currentView  = 'zeitraumStatistik';

  const screen = document.getElementById('zeitraumStatistikScreen');
  if (screen) screen.classList.remove('hidden');

  document.getElementById('currentGroupInfo').textContent =
    'Aktuelle Seite: Club Statistik / Zeitraum Statistik';

  await loadZeitraumSportFilter();
  handleZrAnalyseTypChange();
  loadZrAvailableMonths();
  loadZrAvailableYears();
}

/**
 * Загружает виды спорта из Supabase и рендерит карточки.
 *
 * КАЧЕСТВО ИЗОБРАЖЕНИЙ:
 * Используем .select('*') чтобы getSportImageUrl() получил
 * все поля (sport_id, icon_file и др.) и смог найти
 * наилучший URL через STARTSEITE_CARD_FILES (большие PNG
 * из Startseite_1/ бакета) — тот же источник, что на ST1.
 *
 * ПЕРВАЯ КАРТОЧКА — "Alle Sportarten" с логотипом клуба.
 * data-sport-id="__alle__" — служебный идентификатор.
 */
async function loadZeitraumSportFilter() {
  const strip = document.getElementById('zrSportFilterStrip');
  if (!strip) return;

  strip.innerHTML = '<div class="zr-sport-loading">Sportarten werden geladen...</div>';
  strip.className = 'zr-sport-grid';

  // select('*') — все поля нужны getSportImageUrl для корректного
  // приоритета: STARTSEITE_CARD_FILES → STARTSEITE_ICON_FILES → icon_file
  const { data, error } = await db
    .from('sports')
    .select('*')
    .eq('aktiv', 'JA')
    .eq('club_id', currentClub.club_id)
    .order('sort_order', { ascending: true });

  if (error || !data || data.length === 0) {
    strip.innerHTML = '<div class="zr-sport-loading">Keine aktiven Sportarten gefunden.</div>';
    return;
  }

  // ── Карточка "Alle Sportarten" ──────────────────────────────────
  const alleCard = `
    <button
      type="button"
      class="zr-sport-card zr-sport-card--alle"
      data-sport-id="__alle__"
      data-sport-name="Alle Sportarten"
      onclick="toggleZrSport(this)"
      title="Alle Sportarten"
    >
      <img src="${getClubLogoUrl()}" alt="Alle Sportarten" class="zr-alle-logo">
      <div class="zr-sport-card-name">Alle Sportarten</div>
      <div class="zr-sport-card-check" aria-hidden="true">✓</div>
    </button>
  `;

  // ── Карточки конкретных видов спорта ────────────────────────────
  const sportCards = data.map(function(sport) {
    // getSportImageUrl приоритет:
    // 1. STARTSEITE_CARD_FILES[sport_id] → крупный PNG из Startseite_1/
    // 2. STARTSEITE_ICON_FILES[sport_id] → тот же крупный PNG
    // 3. SPORT_ICON_URL + sport.icon_file → маленькая иконка (fallback)
    const imgUrl = getSportImageUrl(sport);

    return `
      <button
        type="button"
        class="zr-sport-card"
        data-sport-id="${sport.sport_id}"
        data-sport-name="${sport.name}"
        onclick="toggleZrSport(this)"
        title="${sport.name}"
      >
        ${imgUrl
          ? `<img src="${imgUrl}" alt="${sport.name}">`
          : `<div class="zr-sport-card-fallback">🥋</div>`
        }
        <div class="zr-sport-card-check" aria-hidden="true">✓</div>
      </button>
    `;
  }).join('');

  strip.innerHTML = alleCard + sportCards;
}

/**
 * Переключает выбор карточки спорта с взаимоисключающей логикой:
 *
 * Клик по "Alle Sportarten":
 *   → снимает все конкретные виды спорта
 *   → переключает саму Alle Sportarten
 *
 * Клик по конкретному спорту:
 *   → снимает "Alle Sportarten"
 *   → переключает данный спорт
 */
/**
 * Переключает выбор карточки спорта.
 *
 * "Alle Sportarten" — управляющая кнопка "выбрать всё / снять всё":
 *   • Если НЕ все конкретные спорты выбраны → выбрать ВСЕ + подсветить Alle.
 *   • Если ВСЕ конкретные спорты уже выбраны → снять ВСЕ включая Alle.
 *
 * Конкретный спорт:
 *   • Переключает себя.
 *   • Alle Sportarten автоматически становится активной если ВСЕ спорты
 *     теперь выбраны, и снимается если хотя бы один не выбран.
 */
function toggleZrSport(btn) {
  const isAlle = btn.dataset.sportId === '__alle__';

  // Все конкретные карточки (не Alle)
  const allSpecific = document.querySelectorAll(
    '.zr-sport-card:not([data-sport-id="__alle__"])'
  );
  const alleBtn = document.querySelector('.zr-sport-card[data-sport-id="__alle__"]');

  if (isAlle) {
    // Сколько конкретных уже выбрано
    const activeCount = document.querySelectorAll(
      '.zr-sport-card:not([data-sport-id="__alle__"]).zr-sport-card--active'
    ).length;
    const totalCount = allSpecific.length;

    if (activeCount === totalCount && totalCount > 0) {
      // Все уже выбраны → снять ВСЕ
      btn.classList.remove('zr-sport-card--active');
      allSpecific.forEach(function(c) { c.classList.remove('zr-sport-card--active'); });
    } else {
      // Не все выбраны → выбрать ВСЕ
      btn.classList.add('zr-sport-card--active');
      allSpecific.forEach(function(c) { c.classList.add('zr-sport-card--active'); });
    }

  } else {
    // Конкретный спорт: переключаем его
    btn.classList.toggle('zr-sport-card--active');

    // Синхронизируем состояние Alle Sportarten:
    // активна только когда ВСЕ конкретные спорты выбраны
    if (alleBtn) {
      const activeCount = document.querySelectorAll(
        '.zr-sport-card:not([data-sport-id="__alle__"]).zr-sport-card--active'
      ).length;
      const totalCount = allSpecific.length;

      if (activeCount === totalCount && totalCount > 0) {
        alleBtn.classList.add('zr-sport-card--active');
      } else {
        alleBtn.classList.remove('zr-sport-card--active');
      }
    }
  }

  handleZrSportChange();
}

/**
 * Обновляет видимость блока Kennzahl и сбрасывает результаты.
 *
 * "Alle Sportarten" НЕ считается как вид спорта — она управляющая кнопка.
 * Kennzahl определяется только по реальным выбранным видам спорта:
 *   0 или 1 спорт  → Kennzahl СКРЫТ  (система покажет все показатели)
 *   2+ спорта      → Kennzahl ВИДЕН  (нужно выбрать один показатель для сравнения)
 */
function handleZrSportChange() {
  const specificActive = document.querySelectorAll(
    '.zr-sport-card:not([data-sport-id="__alle__"]).zr-sport-card--active'
  ).length;

  const showKennzahl = specificActive >= 2;

  const kennzahlBlock = document.getElementById('zrKennzahlBlock');
  if (kennzahlBlock) {
    kennzahlBlock.classList.toggle('hidden', !showKennzahl);
  }

  resetZrResultBox();
}

/**
 * Переключает видимость блоков Jahre/Monate
 * при смене Analyse-Typ.
 */
function handleZrAnalyseTypChange() {
  const selected = document.querySelector('input[name="zrAnalyseTyp"]:checked');
  const typ = selected ? selected.value : 'jahresvergleich';

  const jahreBlock  = document.getElementById('zrJahreBlock');
  const monateBlock = document.getElementById('zrMonateBlock');

  if (typ === 'jahresvergleich') {
    if (jahreBlock)  jahreBlock.classList.remove('hidden');
    if (monateBlock) monateBlock.classList.add('hidden');
  } else {
    if (jahreBlock)  jahreBlock.classList.add('hidden');
    if (monateBlock) monateBlock.classList.remove('hidden');
  }
  resetZrResultBox();
}

/**
 * Сбрасывает блок результатов к состоянию-заглушке.
 */
function resetZrResultBox() {
  const box = document.getElementById('zrResultBox');
  if (!box) return;
  box.innerHTML = `
    <div class="zr-result-placeholder">
      <div class="zr-result-placeholder-icon">📊</div>
      <div>Bitte Filter auswählen und Analyse starten.</div>
    </div>
  `;
}

/* =========================================================
   ZEITRAUM STATISTIK — ЭТАП 2
   Jahresvergleich + Letzte 12 Monate
========================================================= */

const ZR_KENNZAHL_MAP = {
  students_active_count: { label: 'Schüler',    unit: 'Schüler'   },
  trainers_count:        { label: 'Trainer',     unit: 'Trainer'   },
  groups_count:          { label: 'Gruppen',     unit: 'Gruppen'   },
  attendance_count:      { label: 'Anwesenheit', unit: 'Einträge'  },
  trainings_count:       { label: 'Trainings',   unit: 'Trainings' },
};

const ZR_ALL_KENNZAHLEN = [
  'groups_count',
  'trainers_count',
  'students_active_count',
  'attendance_count',
  'trainings_count',
];

/* Нормализация sport_id из таблицы sports (строчные) →
   формат в club_yearly_snapshots / club_monthly_stats (заглавные) */
const ZR_SPORT_ID_MAP = {
  judo:       'JUDO',
  jiujitsu:   'JIU_JITSU',
  taekwondo:  'TAEKWON_DO',
  boxen:      'BOXEN',
  kickboxen:  'KICKBOXEN',
  muaythai:   'MUAY_THAI',
  taichi:     'TAI_CHI',
};

function zrNormalizeSportId(id) {
  if (!id) return id;
  const lower = String(id).toLowerCase();
  return ZR_SPORT_ID_MAP[lower] || String(id).toUpperCase();
}

const ZR_MONTH_NAMES = [
  '', 'Jan','Feb','Mär','Apr','Mai','Jun',
  'Jul','Aug','Sep','Okt','Nov','Dez'
];

/* ---------------------------------------------------------
   ЗАГРУЗКА ГОДОВ В ЧЕКБОКСЫ (zrJahreGrid)
--------------------------------------------------------- */
async function loadZrAvailableYears() {
  const grid = document.getElementById('zrJahreGrid');
  if (!grid) return;

  grid.innerHTML = '<div class="zr-placeholder-hint">Jahre werden geladen…</div>';

  const { data, error } = await db
    .from('club_yearly_snapshots')
    .select('year')
    .eq('club_id', currentClub.club_id)
    .order('year', { ascending: false });

  if (error || !data || data.length === 0) {
    grid.innerHTML = '<div class="zr-placeholder-hint">Keine Jahres-Daten gefunden.</div>';
    return;
  }

  const years = [...new Set(data.map(r => r.year))].sort(function(a, b) { return b - a; });

  grid.innerHTML = years.map(function(y) {
    return `
      <label class="zr-check-label">
        <input type="checkbox" class="zr-year-check" value="${y}" checked>
        <span>${y}</span>
      </label>`;
  }).join('');
}

/* ---------------------------------------------------------
   ГЕНЕРАЦИЯ ПОСЛЕДНИХ 12 МЕСЯЦЕВ В ЧЕКБОКСЫ (zrMonateGrid)
--------------------------------------------------------- */
function loadZrAvailableMonths() {
  const grid = document.getElementById('zrMonateGrid');
  if (!grid) return;

  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  grid.innerHTML = months.map(function(m) {
    const key   = `${m.year}-${String(m.month).padStart(2, '0')}`;
    const label = `${ZR_MONTH_NAMES[m.month]} ${m.year}`;
    return `
      <label class="zr-check-label">
        <input type="checkbox" class="zr-monat-check" value="${key}" checked>
        <span>${label}</span>
      </label>`;
  }).join('');
}

/* ---------------------------------------------------------
   ПОЛУЧЕНИЕ ВЫБРАННЫХ ГОДОВ / МЕСЯЦЕВ ИЗ ЧЕКБОКСОВ
--------------------------------------------------------- */
function zrGetSelectedYears() {
  return Array.from(
    document.querySelectorAll('.zr-year-check:checked')
  ).map(function(el) { return Number(el.value); });
}

function zrGetSelectedMonthKeys() {
  return Array.from(
    document.querySelectorAll('.zr-monat-check:checked')
  ).map(function(el) { return el.value; });
}

/* ---------------------------------------------------------
   ГЛАВНАЯ ФУНКЦИЯ «Analyse starten»
--------------------------------------------------------- */
async function startZeitraumAnalyse() {
  const box = document.getElementById('zrResultBox');
  if (!box) return;

  /* Выбранные виды спорта (только конкретные, не __alle__) */
  const selectedSports = Array.from(
    document.querySelectorAll(
      '.zr-sport-card:not([data-sport-id="__alle__"]).zr-sport-card--active'
    )
  ).map(function(btn) {
    return { id: btn.dataset.sportId, name: btn.dataset.sportName };
  });

  if (selectedSports.length === 0) {
    box.innerHTML = `
      <div class="zr-result-placeholder zr-result-warn">
        <div class="zr-result-placeholder-icon">⚠️</div>
        <div>Bitte mindestens eine Sportart auswählen.</div>
      </div>`;
    return;
  }

  /* Тип анализа */
  const typEl  = document.querySelector('input[name="zrAnalyseTyp"]:checked');
  const typ    = typEl ? typEl.value : 'jahresvergleich';

  /* Kennzahl */
  const kzEl   = document.getElementById('zrKennzahlSelect');
  const kennzahl = kzEl ? kzEl.value : 'students_active_count';

  const isSingle = selectedSports.length === 1;
  /* sport_id из таблицы sports — строчные (judo, taichi).
     В club_yearly_snapshots / club_monthly_stats — заглавные (JUDO, TAI_CHI).
     Нормализуем перед запросом. */
  const sportIds = selectedSports.map(function(s) { return zrNormalizeSportId(s.id); });

  console.log('ZR selected sports:', selectedSports);
  console.log('ZR normalized sportIds:', sportIds);
  console.log('ZR typ:', typ);
  console.log('ZR kennzahl:', kennzahl);

  box.innerHTML = `
    <div class="zr-result-placeholder">
      <div class="zr-result-placeholder-icon">⏳</div>
      <div>Daten werden geladen…</div>
    </div>`;

  /* ── JAHRESVERGLEICH ─────────────────────────────────── */
  if (typ === 'jahresvergleich') {
    const selectedYears = zrGetSelectedYears();
    console.log('ZR selected years:', selectedYears);

    const rows = await zrLoadYearlySnapshots(sportIds, selectedYears);
    console.log('ZR yearly rows:', rows);

    if (!rows || rows.length === 0) {
      box.innerHTML = `
        <div class="zr-result-placeholder zr-result-warn">
          <div class="zr-result-placeholder-icon">📭</div>
          <div>Keine Statistikdaten für die ausgewählten Filter gefunden.</div>
        </div>`;
      return;
    }

    const grouped = zrGroupSnapshots(rows);
    let html = '';

    if (isSingle) {
      const sport  = selectedSports[0];
      const normId = zrNormalizeSportId(sport.id);
      ZR_ALL_KENNZAHLEN.forEach(function(kz) {
        html += zrRenderJahresvergleichTable(sport.name, grouped[normId] || {}, kz, false);
      });
    } else {
      /* Gesamtverein — первый блок */
      const gesamtData = buildGesamtvereinDataYearly(grouped, sportIds, kennzahl);
      html += zrRenderJahresvergleichTable('Gesamtverein', gesamtData, kennzahl, true);
      /* Отдельные виды спорта */
      selectedSports.forEach(function(sport) {
        const normId = zrNormalizeSportId(sport.id);
        html += zrRenderJahresvergleichTable(sport.name, grouped[normId] || {}, kennzahl, false);
      });
    }

    box.innerHTML = html || `
      <div class="zr-result-placeholder zr-result-warn">
        <div class="zr-result-placeholder-icon">📭</div>
        <div>Keine Statistikdaten für die ausgewählten Filter gefunden.</div>
      </div>`;
    return;
  }

  /* ── LETZTE 12 MONATE ────────────────────────────────── */
  const selectedMonthKeys = zrGetSelectedMonthKeys();

  if (selectedMonthKeys.length === 0) {
    box.innerHTML = `
      <div class="zr-result-placeholder zr-result-warn">
        <div class="zr-result-placeholder-icon">⚠️</div>
        <div>Bitte mindestens einen Monat auswählen.</div>
      </div>`;
    return;
  }

  console.log('ZR selected monthKeys:', selectedMonthKeys);

  const monthRows = await zrLoadMonthlyStats(sportIds, selectedMonthKeys);
  console.log('ZR monthly rows:', monthRows);

  if (!monthRows || monthRows.length === 0) {
    box.innerHTML = `
      <div class="zr-result-placeholder zr-result-warn">
        <div class="zr-result-placeholder-icon">📭</div>
        <div>Keine Monatsdaten für die ausgewählten Filter gefunden.</div>
      </div>`;
    return;
  }

  const monthGrouped = zrGroupMonthlyStats(monthRows);
  let html = '';

  if (isSingle) {
    const sport  = selectedSports[0];
    const normId = zrNormalizeSportId(sport.id);
    ZR_ALL_KENNZAHLEN.forEach(function(kz) {
      html += zrRenderLetzte12MonateTable(sport.name, monthGrouped[normId] || {}, kz, selectedMonthKeys, false);
    });
  } else {
    /* Gesamtverein — первый блок */
    const gesamtMonthData = buildGesamtvereinDataMonthly(monthGrouped, sportIds, selectedMonthKeys);
    html += zrRenderLetzte12MonateTable('Gesamtverein', gesamtMonthData, kennzahl, selectedMonthKeys, true);
    /* Отдельные виды спорта */
    selectedSports.forEach(function(sport) {
      const normId = zrNormalizeSportId(sport.id);
      html += zrRenderLetzte12MonateTable(sport.name, monthGrouped[normId] || {}, kennzahl, selectedMonthKeys, false);
    });
  }

  box.innerHTML = html || `
    <div class="zr-result-placeholder zr-result-warn">
      <div class="zr-result-placeholder-icon">📭</div>
      <div>Keine Monatsdaten für die ausgewählten Filter gefunden.</div>
    </div>`;
}

/* ---------------------------------------------------------
   ЗАГРУЗКА ДАННЫХ ИЗ Supabase
--------------------------------------------------------- */
async function zrLoadYearlySnapshots(sportIds, selectedYears) {
  let query = db
    .from('club_yearly_snapshots')
    .select('*')
    .in('sport_id', sportIds)
    .eq('club_id', currentClub.club_id);

  if (selectedYears && selectedYears.length > 0) {
    query = query.in('year', selectedYears);
  }

  const { data, error } = await query
    .order('year', { ascending: true })
    .order('sport_id', { ascending: true });

  if (error) {
    console.error('zrLoadYearlySnapshots:', error);
    return [];
  }
  return data || [];
}

async function zrLoadMonthlyStats(sportIds, monthKeys) {
  /* monthKeys: ['2025-01', '2025-02', ...] */
  const years  = [...new Set(monthKeys.map(function(k) { return Number(k.split('-')[0]); }))];
  const months = [...new Set(monthKeys.map(function(k) { return Number(k.split('-')[1]); }))];

  const { data, error } = await db
    .from('club_monthly_stats')
    .select('*')
    .in('sport_id', sportIds)
    .eq('club_id', currentClub.club_id)
    .in('year', years)
    .in('month', months)
    .order('year', { ascending: true })
    .order('month', { ascending: true });

  if (error) {
    console.error('zrLoadMonthlyStats:', error);
    return [];
  }
  return data || [];
}

/* ---------------------------------------------------------
   ГРУППИРОВКА ДАННЫХ
--------------------------------------------------------- */
function zrGroupSnapshots(rows) {
  /* grouped[sport_id][year][snapshot_type] = row */
  const grouped = {};
  rows.forEach(function(row) {
    const sid  = row.sport_id;
    const year = row.year;
    const type = row.snapshot_type;
    if (!grouped[sid])       grouped[sid]       = {};
    if (!grouped[sid][year]) grouped[sid][year] = {};
    grouped[sid][year][type] = row;
  });
  return grouped;
}

function zrGroupMonthlyStats(rows) {
  /* grouped[sport_id][year-MM] = row */
  const grouped = {};
  rows.forEach(function(row) {
    const sid = row.sport_id;
    const key = `${row.year}-${String(row.month).padStart(2, '0')}`;
    if (!grouped[sid]) grouped[sid] = {};
    grouped[sid][key] = row;
  });
  return grouped;
}

/* ---------------------------------------------------------
   РЕНДЕР: JAHRESVERGLEICH
--------------------------------------------------------- */
function zrRenderJahresvergleichTable(sportName, sportData, kennzahl, isGesamtverein) {
  const kzMeta      = ZR_KENNZAHL_MAP[kennzahl] || { label: kennzahl, unit: '' };
  const nowMonth    = new Date().getMonth() + 1;
  const monthStr    = String(nowMonth).padStart(2, '0');
  const currentYear = new Date().getFullYear();

  const years = Object.keys(sportData).map(Number).sort(function(a, b) { return a - b; });

  const sectionClass = isGesamtverein ? 'zr-table-section zr-section-gesamt' : 'zr-table-section';
  const sportLabel   = isGesamtverein
    ? `<span class="zr-table-sport zr-gesamt-sport">🏛️ ${sportName}</span>`
    : `<span class="zr-table-sport">${sportName}</span>`;

  if (years.length === 0) {
    return `
      <div class="${sectionClass}">
        <div class="zr-table-section-title">
          ${sportLabel}
          <span class="zr-table-kz-label">${kzMeta.label}entwicklung</span>
        </div>
        <div class="zr-no-data">Keine Daten vorhanden.</div>
      </div>`;
  }

  /*
   * Для Anwesenheit и Trainings итог считается по same_month_start:
   * сравниваем Stand 01.MM первого года с Stand 01.MM последнего года.
   *
   * Для остальных (Schüler, Trainer, Gruppen) — классическая логика:
   * year_start первого года → year_end (или same_month_start) последнего года.
   */
  const isAktivitaet = (kennzahl === 'attendance_count' || kennzahl === 'trainings_count');

  let tableRows = '';
  let gesamtFirstVal = null; let gesamtFirstYear = null;
  let gesamtLastVal  = null; let gesamtLastYear  = null;

  years.forEach(function(year) {
    const snap = sportData[year] || {};
    const ys   = snap['year_start']       ? snap['year_start'][kennzahl]       : null;
    const sms  = snap['same_month_start'] ? snap['same_month_start'][kennzahl] : null;
    const ye   = snap['year_end']         ? snap['year_end'][kennzahl]         : null;
    const isRunning = (year === currentYear && ye === null);

    if (isAktivitaet) {
      if (sms !== null) {
        if (gesamtFirstVal === null) { gesamtFirstVal = sms; gesamtFirstYear = year; }
        gesamtLastVal = sms; gesamtLastYear = year;
      }
    } else {
      if (gesamtFirstVal === null && ys !== null) {
        gesamtFirstVal = ys; gesamtFirstYear = year;
      }
      const endVal = isRunning ? sms : ye;
      if (endVal !== null) { gesamtLastVal = endVal; gesamtLastYear = year; }
    }

    const devBisMonat      = (ys  !== null && sms !== null) ? sms - ys  : null;
    const devBisJahresende = (sms !== null && ye  !== null) ? ye  - sms : null;
    const jahresergebnis   = isRunning
      ? (ys !== null && sms !== null ? sms - ys : null)
      : (ys !== null && ye  !== null ? ye  - ys : null);

    const col2 = ys  !== null ? `${ys} ${kzMeta.unit}`  : '—';
    const col4 = sms !== null ? `${sms} ${kzMeta.unit}` : '—';
    const col5 = isRunning ? '<span class="zr-lauft">läuft noch</span>' : zrDelta(devBisJahresende);
    const col6 = isRunning ? '<span class="zr-lauft">läuft noch</span>' : (ye !== null ? `${ye} ${kzMeta.unit}` : '—');
    const col7 = isRunning ? zrDeltaAktuell(jahresergebnis) : zrDelta(jahresergebnis);

    tableRows += `
      <tr class="${isRunning ? 'zr-row-running' : ''}">
        <td class="zr-td-year">${year}</td>
        <td>${col2}</td>
        <td>${zrDelta(devBisMonat)}</td>
        <td>${col4}</td>
        <td>${col5}</td>
        <td>${col6}</td>
        <td>${col7}</td>
      </tr>`;
  });

  /* ── Карточка итога ─────────────────────────────────── */
  let gesamtCard = '';

  if (years.length < 2) {
    gesamtCard = `
      <div class="zr-gesamt-card">
        <div class="zr-gesamt-card-inner zr-gesamt-hint">
          Für den Gesamtvergleich bitte mindestens zwei Jahre auswählen.
        </div>
      </div>`;

  } else if (isAktivitaet && gesamtFirstYear !== null && gesamtLastYear !== null) {
    /* Двухколоночная карточка для Anwesenheit / Trainings */
    const fy   = gesamtFirstYear;
    const ly   = gesamtLastYear;
    const fSnap = sportData[fy] || {};
    const lSnap = sportData[ly] || {};

    const fSms = fSnap['same_month_start'] ? fSnap['same_month_start'][kennzahl] : null;
    const lSms = lSnap['same_month_start'] ? lSnap['same_month_start'][kennzahl] : null;
    const fYe  = fSnap['year_end']         ? fSnap['year_end'][kennzahl]         : null;
    const lYe  = lSnap['year_end']         ? lSnap['year_end'][kennzahl]         : null;
    const lastYearRunning = (ly === currentYear && lYe === null);

    gesamtCard = zrAktivitaetGesamtCard(
      fy, ly, fSms, lSms, fYe, lYe, lastYearRunning, kzMeta, monthStr
    );

  } else if (!isAktivitaet && gesamtFirstVal !== null && gesamtLastVal !== null && gesamtFirstYear !== gesamtLastYear) {
    gesamtCard = zrGesamtentwicklungCard(
      String(gesamtFirstYear), String(gesamtLastYear),
      gesamtFirstVal, gesamtLastVal, kzMeta
    );
  }

  return `
    <div class="${sectionClass}">
      <div class="zr-table-section-title">
        ${sportLabel}
        <span class="zr-table-kz-label">${kzMeta.label}entwicklung — Jahresvergleich</span>
      </div>
      <div class="zr-table-scroll">
        <table class="zr-table">
          <thead>
            <tr>
              <th>Jahr</th>
              <th>Jahresanfang</th>
              <th>Entwicklung bis Monatsanfang</th>
              <th>Stand 01.${monthStr}</th>
              <th>Entwicklung bis Jahresende</th>
              <th>Jahresende</th>
              <th>Jahresergebnis</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      ${gesamtCard}
    </div>`;
}

/* ---------------------------------------------------------
   РЕНДЕР: LETZTE 12 MONATE
--------------------------------------------------------- */
function zrRenderLetzte12MonateTable(sportName, monthlyData, kennzahl, monthKeys, isGesamtverein) {
  const kzMeta = ZR_KENNZAHL_MAP[kennzahl] || { label: kennzahl, unit: '' };
  const keys   = monthKeys.slice().sort();

  const sectionClass = isGesamtverein ? 'zr-table-section zr-section-gesamt' : 'zr-table-section';
  const sportLabel   = isGesamtverein
    ? `<span class="zr-table-sport zr-gesamt-sport">🏛️ ${sportName}</span>`
    : `<span class="zr-table-sport">${sportName}</span>`;

  if (keys.length === 0) {
    return `
      <div class="${sectionClass}">
        <div class="zr-table-section-title">
          ${sportLabel}
          <span class="zr-table-kz-label">${kzMeta.label}entwicklung — Letzte 12 Monate</span>
        </div>
        <div class="zr-no-data">Keine Monate ausgewählt.</div>
      </div>`;
  }

  let tableRows = '';
  let prevVal = null;

  /* Для Gesamtentwicklung: первое и последнее значение с данными */
  let gesamtFirstVal = null; let gesamtFirstLabel = null;
  let gesamtLastVal  = null; let gesamtLastLabel  = null;

  keys.forEach(function(key) {
    const row = monthlyData[key] || null;
    const val = (row && row[kennzahl] !== undefined && row[kennzahl] !== null)
      ? row[kennzahl] : null;

    const [yearStr, monthNumStr] = key.split('-');
    const label = `${ZR_MONTH_NAMES[Number(monthNumStr)]} ${yearStr}`;

    const valCell   = val !== null ? `${val} ${kzMeta.unit}` : '—';
    const deltaCell = (val !== null && prevVal !== null)
      ? zrDelta(val - prevVal)
      : '<span class="zr-neutral">—</span>';

    tableRows += `
      <tr>
        <td class="zr-td-monat">${label}</td>
        <td>${valCell}</td>
        <td>${deltaCell}</td>
      </tr>`;

    if (val !== null) {
      if (gesamtFirstVal === null) { gesamtFirstVal = val; gesamtFirstLabel = label; }
      gesamtLastVal = val; gesamtLastLabel = label;
      prevVal = val;
    }
  });

  const gesamtCard = (gesamtFirstVal !== null && gesamtLastVal !== null && gesamtFirstLabel !== gesamtLastLabel)
    ? zrGesamtentwicklungCard(gesamtFirstLabel, gesamtLastLabel, gesamtFirstVal, gesamtLastVal, kzMeta)
    : '';

  return `
    <div class="${sectionClass}">
      <div class="zr-table-section-title">
        ${sportLabel}
        <span class="zr-table-kz-label">${kzMeta.label}entwicklung — Letzte 12 Monate</span>
      </div>
      <div class="zr-table-scroll">
        <table class="zr-table">
          <thead>
            <tr>
              <th>Monat</th>
              <th>Wert</th>
              <th>Entwicklung</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      ${gesamtCard}
    </div>`;
}

/* ---------------------------------------------------------
   АГРЕГАЦИЯ GESAMTVEREIN
--------------------------------------------------------- */

/**
 * Суммирует данные Jahresvergleich по всем видам спорта.
 * Возвращает структуру, совместимую с zrRenderJahresvergleichTable:
 * { year: { snapshot_type: { [kennzahl]: summedValue } } }
 * Суммируются ВСЕ kennzahlen из ZR_ALL_KENNZAHLEN, чтобы функция
 * рендера могла работать с любым переданным kennzahl.
 */
function buildGesamtvereinDataYearly(grouped, normSportIds, kennzahl) {
  const result = {};
  const fields = ZR_ALL_KENNZAHLEN;

  normSportIds.forEach(function(sid) {
    const sportData = grouped[sid] || {};
    Object.keys(sportData).forEach(function(yearStr) {
      const year = Number(yearStr);
      if (!result[year]) result[year] = {};
      const snap = sportData[year];

      ['year_start', 'same_month_start', 'year_end'].forEach(function(type) {
        if (!snap[type]) return;
        if (!result[year][type]) result[year][type] = {};
        fields.forEach(function(f) {
          const val = snap[type][f];
          if (val !== null && val !== undefined) {
            result[year][type][f] = (result[year][type][f] || 0) + val;
          }
        });
      });
    });
  });

  return result;
}

/**
 * Суммирует данные Letzte 12 Monate по всем видам спорта.
 * Возвращает структуру, совместимую с zrRenderLetzte12MonateTable:
 * { 'YYYY-MM': { [kennzahl]: summedValue } }
 */
function buildGesamtvereinDataMonthly(monthGrouped, normSportIds, monthKeys) {
  const result = {};
  const fields = ZR_ALL_KENNZAHLEN;

  monthKeys.forEach(function(key) {
    normSportIds.forEach(function(sid) {
      const row = (monthGrouped[sid] || {})[key];
      if (!row) return;
      if (!result[key]) result[key] = {};
      fields.forEach(function(f) {
        const val = row[f];
        if (val !== null && val !== undefined) {
          result[key][f] = (result[key][f] || 0) + val;
        }
      });
    });
  });

  return result;
}

/**
 * Двухколоночная карточка итога для Anwesenheit / Trainings.
 * Левая колонка  — Stand 01.MM (same_month_start)
 * Правая колонка — Jahresende  (year_end)
 */
function zrAktivitaetGesamtCard(fy, ly, fSms, lSms, fYe, lYe, lastYearRunning, kzMeta, monthStr) {
  /* ── Левая колонка: Stand 01.MM ── */
  const standLabel  = `Stand 01.${monthStr}`;
  let standValues   = '—';
  let standDeltaHtml = '<span class="zr-neutral">—</span>';

  if (fSms !== null && lSms !== null) {
    standValues = `${fSms} → ${lSms} ${kzMeta.unit}`;
    const d = lSms - fSms;
    standDeltaHtml = d > 0
      ? `<span class="zr-pos">▲ +${d} ${kzMeta.unit}</span>`
      : d < 0
        ? `<span class="zr-neg">▼ ${d} ${kzMeta.unit}</span>`
        : `<span class="zr-neutral">± 0 ${kzMeta.unit}</span>`;
  } else if (fSms !== null) {
    standValues = `${fSms} → —`;
  }

  /* ── Правая колонка: Jahresende ── */
  let endValues    = '—';
  let endDeltaHtml = '<span class="zr-neutral">—</span>';

  if (lastYearRunning) {
    endValues    = fYe !== null ? `${fYe} → <span class="zr-lauft">läuft noch</span>` : '—';
    endDeltaHtml = '<span class="zr-lauft">läuft noch</span>';
  } else if (fYe !== null && lYe !== null) {
    endValues = `${fYe} → ${lYe} ${kzMeta.unit}`;
    const d = lYe - fYe;
    endDeltaHtml = d > 0
      ? `<span class="zr-pos">▲ +${d} ${kzMeta.unit}</span>`
      : d < 0
        ? `<span class="zr-neg">▼ ${d} ${kzMeta.unit}</span>`
        : `<span class="zr-neutral">± 0 ${kzMeta.unit}</span>`;
  } else if (fYe !== null) {
    endValues = `${fYe} → —`;
  }

  return `
    <div class="zr-gesamt-activity-card">
      <div class="zr-gesamt-activity-title">
        <span class="zr-gesamt-label">Gesamtvergleich</span>
        <span class="zr-gesamt-period">${fy} → ${ly}</span>
      </div>
      <div class="zr-gesamt-activity-grid">
        <div class="zr-gesamt-activity-col">
          <div class="zr-gesamt-activity-label">${standLabel}</div>
          <div class="zr-gesamt-activity-values">${standValues}</div>
          <div class="zr-gesamt-activity-delta">${standDeltaHtml}</div>
        </div>
        <div class="zr-gesamt-activity-col">
          <div class="zr-gesamt-activity-label">Jahresende</div>
          <div class="zr-gesamt-activity-values">${endValues}</div>
          <div class="zr-gesamt-activity-delta">${endDeltaHtml}</div>
        </div>
      </div>
    </div>`;
}

/**
 * Рендерит итоговую карточку Gesamtentwicklung в конце блока.
 */
function zrGesamtentwicklungCard(firstLabel, lastLabel, firstVal, lastVal, kzMeta) {
  const delta = lastVal - firstVal;
  let deltaHtml;
  if (delta > 0) {
    deltaHtml = `<span class="zr-pos">▲ +${delta} ${kzMeta.unit}</span>`;
  } else if (delta < 0) {
    deltaHtml = `<span class="zr-neg">▼ ${delta} ${kzMeta.unit}</span>`;
  } else {
    deltaHtml = `<span class="zr-neutral">± 0 ${kzMeta.unit}</span>`;
  }

  return `
    <div class="zr-gesamt-card">
      <div class="zr-gesamt-card-inner">
        <div class="zr-gesamt-label">Gesamtentwicklung</div>
        <div class="zr-gesamt-period">${firstLabel} → ${lastLabel}</div>
        <div class="zr-gesamt-values">
          <span>${firstVal} ${kzMeta.unit}</span>
          <span class="zr-gesamt-arrow">→</span>
          <span>${lastVal} ${kzMeta.unit}</span>
        </div>
        <div class="zr-gesamt-delta">${deltaHtml}</div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------
   ДЕЛЬТА-ХЕЛПЕРЫ
--------------------------------------------------------- */
function zrDelta(val) {
  if (val === null || val === undefined) return '<span class="zr-neutral">—</span>';
  if (val > 0) return `<span class="zr-pos">▲ +${val}</span>`;
  if (val < 0) return `<span class="zr-neg">▼ ${val}</span>`;
  return `<span class="zr-neutral">0</span>`;
}

function zrDeltaAktuell(val) {
  if (val === null || val === undefined) return '<span class="zr-neutral">—</span>';
  if (val > 0) return `<span class="zr-pos">▲ +${val} aktuell</span>`;
  if (val < 0) return `<span class="zr-neg">▼ ${val} aktuell</span>`;
  return `<span class="zr-neutral">0 aktuell</span>`;
}

// =========================================================
// SUPER ADMIN
// =========================================================

function openSuperAdminLogin() {
  const modal = document.getElementById('superAdminLoginModal');
  if (!modal) return;
  document.getElementById('saUsername').value = '';
  document.getElementById('saPin').value = '';
  document.getElementById('saLoginStatus').textContent = '';
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('saUsername').focus(), 50);
}

function closeSuperAdminLogin() {
  const modal = document.getElementById('superAdminLoginModal');
  if (modal) modal.classList.add('hidden');
}

// Общий движок проверки SA-логина
async function _superAdminLoginCore(username, pin, statusEl) {
  if (!username || !pin) {
    statusEl.textContent = 'Bitte Benutzername und PIN eingeben.';
    return;
  }
  statusEl.textContent = 'Wird geprüft…';
  const { data, error } = await db
    .from('super_admins')
    .select('id, username, name, pin')
    .eq('username', username)
    .maybeSingle();
  if (error || !data || data.pin !== pin) {
    statusEl.textContent = 'Falscher Benutzername oder PIN.';
    return;
  }
  superAdminSession = { id: data.id, username: data.username, name: data.name };
  statusEl.textContent = '';
  if (isSAStandaloneMode) {
    document.getElementById('saStandalonePage').classList.add('hidden');
  } else {
    closeSuperAdminLogin();
  }
  showSuperAdminDashboard();
}

// Вход через модальное окно (gear на странице клуба)
async function superAdminLogin() {
  const username = document.getElementById('saUsername').value.trim();
  const pin      = document.getElementById('saPin').value.trim();
  await _superAdminLoginCore(username, pin, document.getElementById('saLoginStatus'));
}

// Вход через standalone-страницу (?superadmin=1)
async function superAdminLoginStandalone() {
  const username = document.getElementById('saStandaloneUsername').value.trim();
  const pin      = document.getElementById('saStandalonePin').value.trim();
  await _superAdminLoginCore(username, pin, document.getElementById('saStandaloneStatus'));
}

function showSuperAdminDashboard() {
  document.getElementById('superAdminScreen').classList.remove('hidden');
  const nameEl = document.getElementById('saWelcomeName');
  if (nameEl) nameEl.textContent = 'Angemeldet als: ' + (superAdminSession?.name || superAdminSession?.username || '');
  saLoadDashboardBadges();
}

async function saLoadDashboardBadges() {
  const { data: clubs } = await db
    .from('clubs')
    .select('club_id, active, billing_cycle, aktiv_bis, contract_active, contract_end, contract_auto_debit');
  if (!clubs) return;
  const items = clubs.map(c => ({ club: c }));
  saUpdateZahlDashBadges(items);
}

function superAdminLogout() {
  superAdminSession  = null;
  isSuperAdminAccess = false;
  document.getElementById('superAdminScreen').classList.add('hidden');
  document.getElementById('saImpersonationBadge')?.classList.add('hidden');
  document.body.classList.remove('sa-imp-active');
  if (isSAStandaloneMode) {
    document.getElementById('saStandalonePage').classList.remove('hidden');
    document.getElementById('saStandaloneUsername').value = '';
    document.getElementById('saStandalonePin').value      = '';
    document.getElementById('saStandaloneStatus').textContent = '';
    setTimeout(() => document.getElementById('saStandaloneUsername').focus(), 100);
  }
}

function copySALink(btn) {
  const url = `${window.location.origin}/?superadmin=1`;
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✅ Kopiert';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

// =========================================================
// SUPER ADMIN — CLUBS MANAGEMENT
// =========================================================

function saTarifLabel(count) {
  if (count <= 30) return { label: 'Starter', cls: 'sa-tarif-starter' };
  if (count <= 80) return { label: 'Basic',   cls: 'sa-tarif-basic'   };
  return                  { label: 'Pro',     cls: 'sa-tarif-pro'     };
}

function saFormatDate(val) {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString('de-DE'); } catch { return val; }
}

function saExitImpersonation() {
  isSuperAdminAccess = false;
  document.getElementById('saImpersonationBadge')?.classList.add('hidden');
  document.getElementById('clubPaymentWarning')?.classList.add('hidden');
  document.body.classList.remove('sa-imp-active');

  // Скрыть клубский UI (стартовый экран / appBox)
  document.getElementById('sportStartScreen')?.classList.add('hidden');
  document.getElementById('appBox')?.classList.add('hidden');

  // Восстановить standalone-класс если зашли через ?superadmin=1
  if (isSAStandaloneMode) document.body.classList.add('sa-standalone-mode');

  // Вернуться в SA Dashboard → Clubs Management
  document.getElementById('superAdminScreen')?.classList.remove('hidden');
  showSAClubsScreen();
}

async function showSAClubsScreen() {
  document.getElementById('saClubsScreen').classList.remove('hidden');
  document.getElementById('saClubsLoadingMsg').classList.remove('hidden');
  document.getElementById('saClubsList').innerHTML = '';
  await loadAndRenderSAClubs();
}

function hideSAClubsScreen() {
  document.getElementById('saClubsScreen').classList.add('hidden');
}

async function loadAndRenderSAClubs() {
  const loadingEl = document.getElementById('saClubsLoadingMsg');
  const listEl    = document.getElementById('saClubsList');

  // Загружаем все клубы (без фильтра active — SA видит все)
  const { data: clubs, error } = await db
    .from('clubs')
    .select('club_id, club_name, club_short_name, active, aktiv_von, aktiv_bis, last_payment_date, created_at, phone, email, website, logo_url, background_image_url, favicon_url, primary_color, secondary_color, accent_color, billing_cycle, contract_active, contract_number, contract_start, contract_end, contract_auto_debit, contract_note')
    .order('created_at', { ascending: true });

  if (error) {
    loadingEl.textContent = 'Fehler beim Laden: ' + error.message;
    return;
  }

  // Активные ученики
  const { data: studentRows } = await db
    .from('students')
    .select('club_id')
    .eq('aktiv', 'JA');

  const countMap = {};
  (studentRows || []).forEach(r => {
    countMap[r.club_id] = (countMap[r.club_id] || 0) + 1;
  });

  // Hauptadministratoren (по одному на клуб, rolle='Admin')
  const { data: adminRows } = await db
    .from('trainers')
    .select('club_id, name, email, telefon')
    .eq('rolle', 'Admin')
    .eq('aktiv', 'JA');

  const adminMap = {};
  (adminRows || []).forEach(r => {
    if (!adminMap[r.club_id]) adminMap[r.club_id] = r;
  });

  // Активные тарифы из таблицы (для динамического lookup)
  const { data: tarifRows } = await db
    .from('tariff_packages')
    .select('name, min_students, max_students, price, price_monthly, price_quarterly, price_yearly, currency')
    .eq('aktiv', 'JA')
    .order('sort_order', { ascending: true });

  // Сортировка: сначала проблемные клубы, внутри группы — по ближайшей дате
  const sortDate = c => {
    const p = saZahlSortPriority(c);
    if (p <= 1 && c.aktiv_bis)      return new Date(c.aktiv_bis).getTime();
    if (p === 2 && c.contract_end)  return new Date(c.contract_end).getTime();
    return Infinity;
  };
  (clubs || []).sort((a, b) => {
    const pa = saZahlSortPriority(a), pb = saZahlSortPriority(b);
    if (pa !== pb) return pa - pb;
    return sortDate(a) - sortDate(b);
  });

  // Сохраняем в кэш для фильтрации без перезагрузки
  _saClubsCache = clubs.map(c => ({
    club:         c,
    studentCount: countMap[c.club_id] || 0,
    adminTrainer: adminMap[c.club_id] || null,
    tarifRows:    tarifRows || [],
  }));

  loadingEl.classList.add('hidden');
  saClubsRenderVisible(_saClubsCache);
  saClubsFilterReset();
}

function renderSAClubCard(club, studentCount, adminTrainer, tarifRows) {
  // Динамический lookup тарифа + billing_cycle
  const cycle = club.billing_cycle || 'trial';
  const matchedTarif = (tarifRows || []).find(t =>
    studentCount >= t.min_students &&
    (t.max_students == null || studentCount <= t.max_students)
  );

  const cycleLabels = { trial: 'Testperiode', monthly: 'Monatlich', quarterly: 'Quartalsweise', yearly: 'Jährlich' };
  const cycleLabel  = cycleLabels[cycle] || cycle;

  let tarifPill;
  if (cycle === 'trial') {
    tarifPill = `<span class="sa-tarif-pill sa-tarif-trial">${cycleLabel} · 0 EUR</span>`;
  } else if (matchedTarif) {
    const priceMap  = { monthly: matchedTarif.price_monthly, quarterly: matchedTarif.price_quarterly, yearly: matchedTarif.price_yearly };
    const rawPrice  = priceMap[cycle];
    const priceStr  = (rawPrice != null && rawPrice > 0) ? `${rawPrice} ${matchedTarif.currency}` : '—';
    const suffix    = { monthly: '/ Monat', quarterly: '/ Quartal', yearly: '/ Jahr' }[cycle] || '';
    tarifPill = `<span class="sa-tarif-pill">${matchedTarif.name} · ${priceStr} ${suffix}</span>`;
  } else {
    tarifPill = `<span class="sa-tarif-pill sa-tarif-none">Kein Tarif</span>`;
  }

  const isActive = club.active;
  const cardCls  = isActive ? '' : ' sa-club-inactive';
  const statusCls  = isActive ? 'sa-status-aktiv'   : 'sa-status-inaktiv';
  const statusText = isActive ? 'Aktiv'             : 'Inaktiv';
  const clubNameEsc = (club.club_name || club.club_id).replace(/'/g, "\\'");
  const toggleBtn  = isActive
    ? `<button class="sa-club-btn sa-club-btn-deactivate" onclick="saShowClubActionModal('${club.club_id}','${clubNameEsc}')">Deaktivieren</button>`
    : `<button class="sa-club-btn sa-club-btn-activate"   onclick="saActivateClub('${club.club_id}')">Aktivieren</button>`;

  // White Label preview
  const hasLogo = !!club.logo_url;
  const hasBg   = !!club.background_image_url;
  const hasWL   = hasLogo || hasBg || !!club.primary_color;

  const logoThumb = hasLogo
    ? `<img class="sa-club-logo-thumb" src="${club.logo_url}" alt="Logo" title="Logo">`
    : `<div class="sa-club-logo-thumb" title="Kein Logo" style="display:flex;align-items:center;justify-content:center;font-size:16px;opacity:0.3">🖼</div>`;

  const bgThumb = hasBg
    ? `<img class="sa-club-bg-thumb" src="${club.background_image_url}" alt="BG" title="Hintergrund">`
    : '';

  const swatches = [club.primary_color, club.secondary_color, club.accent_color]
    .filter(Boolean)
    .map(c => `<span class="sa-color-swatch" style="background:${c}" title="${c}"></span>`)
    .join('');

  const wlBadge = hasWL
    ? `<span class="sa-wl-badge sa-wl-ok">✓ White Label</span>`
    : `<span class="sa-wl-badge sa-wl-missing">○ Kein Design</span>`;

  const hasContract = club.contract_active === 'JA';
  const contractBadge = hasContract
    ? `<div class="sa-club-contract-badge">
        <span class="sa-club-contract-icon">📄</span>
        <span class="sa-club-contract-text">Vertrag: ${club.contract_number ? 'Nr. ' + club.contract_number + ' · ' : ''}${saFormatDate(club.contract_start)} – ${saFormatDate(club.contract_end)}${club.contract_auto_debit === 'JA' ? ' · Auto-Abbuchung: Ja' : ''}</span>
       </div>`
    : `<div class="sa-club-contract-badge sa-club-contract-none">Vertrag: —</div>`;

  const { payWarn, payDaysLeft, contractWarn, contractDaysLeft } = saGetClubWarningStatus(club);
  const warnIcons = [
    payWarn === 'expired'  ? `<span class="sa-club-warn-icon sa-club-warn--red"   title="Zahlung abgelaufen">🔴</span>` : '',
    payWarn === 'soon'     ? `<span class="sa-club-warn-icon sa-club-warn--orange" title="Zahlung endet in ${payDaysLeft} Tagen">⚠️ ${payDaysLeft}d</span>` : '',
    contractWarn           ? `<span class="sa-club-warn-icon sa-club-warn--blue"   title="Vertrag endet in ${contractDaysLeft} Tagen">📄⚠️ ${contractDaysLeft}d</span>` : '',
  ].join('');

  return `
<div class="sa-club-card${cardCls}" id="sa-card-${club.club_id}">
  <div class="sa-club-card-top">
    <div class="sa-club-card-name-row">
      <div class="sa-club-card-name">${club.club_name || club.club_id}</div>
      ${warnIcons ? `<div class="sa-club-warn-icons">${warnIcons}</div>` : ''}
      <div class="sa-club-card-id">club_id: ${club.club_id}</div>
    </div>
    ${contractBadge}
    <span class="sa-status-badge ${statusCls}">${statusText}</span>
  </div>

  <div class="sa-club-card-meta">
    <div class="sa-club-meta-item">
      <span class="sa-club-meta-label">Aktiv von:</span>
      <span class="sa-club-meta-value">${saFormatDate(club.aktiv_von)}</span>
    </div>
    <div class="sa-club-meta-item">
      <span class="sa-club-meta-label">Aktiv bis:</span>
      <span class="sa-club-meta-value">${saFormatDate(club.aktiv_bis)}</span>
    </div>
    <div class="sa-club-meta-item">
      <span class="sa-club-meta-label">Schüler (aktiv):</span>
      <span class="sa-club-meta-value">${studentCount}</span>
    </div>
    <div class="sa-club-meta-item">
      <span class="sa-club-meta-label">Tarif:</span>
      ${tarifPill}
    </div>
    <div class="sa-club-meta-item">
      <span class="sa-club-meta-label">Letzte Zahlung:</span>
      <span class="sa-club-meta-value">${saFormatDate(club.last_payment_date)}</span>
    </div>
    <div class="sa-club-meta-item">
      <span class="sa-club-meta-label">Erstellt:</span>
      <span class="sa-club-meta-value">${saFormatDate(club.created_at)}</span>
    </div>
  </div>

  <div class="sa-club-wl-row">
    ${logoThumb}
    ${bgThumb}
    ${swatches}
    ${wlBadge}
  </div>

  ${adminTrainer ? `
  <div class="sa-club-admin-row">
    <span class="sa-club-admin-name">${adminTrainer.name || '—'}</span>
    ${adminTrainer.email ? `<span class="sa-club-admin-sep">·</span><span>${adminTrainer.email}</span>` : ''}
    ${adminTrainer.telefon ? `<span class="sa-club-admin-sep">·</span><span>${adminTrainer.telefon}</span>` : ''}
  </div>` : `
  <div class="sa-club-admin-row" style="color:rgba(255,107,107,0.6)">⚠ Kein Administrator</div>`}

  <div class="sa-club-link-row">
    <span class="sa-club-link-label">Club-Link:</span>
    <span class="sa-club-link-url">${window.location.origin}/?club=${club.club_id}</span>
    <button class="sa-club-link-copy-btn" title="Link kopieren"
            onclick="saCopyClubLink('${club.club_id}', this)">
      <span class="sa-copy-icon">⧉</span>
    </button>
  </div>

  <div class="sa-club-card-actions">
    <button class="sa-club-btn sa-club-btn-edit" onclick="showSAEditClubScreen('${club.club_id}')">Bearbeiten</button>
    <button class="sa-club-btn sa-club-btn-open" onclick="saOpenClub('${club.club_id}')">Öffnen</button>
    ${toggleBtn}
  </div>
</div>`;
}

// --- Club Activate (simple, no modal needed) ---
async function saActivateClub(clubId) {
  const { data, error } = await db
    .from('clubs')
    .update({ active: true })
    .eq('club_id', clubId)
    .select();
  if (error) { alert('Fehler: ' + error.message); return; }
  if (!data || data.length === 0) { alert('Update nicht ausgeführt.'); return; }
  await loadAndRenderSAClubs();
}

// --- Club Action Modal state ---
let _saActionClubId   = null;
let _saActionClubName = null;

function saShowClubActionModal(clubId, clubName) {
  _saActionClubId   = clubId;
  _saActionClubName = clubName || clubId;
  document.getElementById('saClubActionSubtitle').textContent =
    `${_saActionClubName}  ·  club_id: ${_saActionClubId}`;
  document.getElementById('saDeleteConfirmClubId').value = '';
  document.getElementById('saDeleteConfirmPin').value    = '';
  document.getElementById('saDeleteError').textContent   = '';
  document.getElementById('saDeleteConfirmBtn').disabled = true;
  saShowActionStep1();
  document.getElementById('saClubActionModal').classList.remove('hidden');
}

function closeSAClubActionModal() {
  document.getElementById('saClubActionModal').classList.add('hidden');
  _saActionClubId = _saActionClubName = null;
}

function saShowActionStep1() {
  document.getElementById('saClubActionStep1').classList.remove('hidden');
  document.getElementById('saClubActionStep2').classList.add('hidden');
}

function saShowDeleteStep() {
  document.getElementById('saClubDeleteSubtitle').textContent =
    `${_saActionClubName}  ·  club_id: ${_saActionClubId}`;
  document.getElementById('saClubActionStep1').classList.add('hidden');
  document.getElementById('saClubActionStep2').classList.remove('hidden');
  setTimeout(() => document.getElementById('saDeleteConfirmClubId').focus(), 50);
}

function saUpdateDeleteBtn() {
  const clubIdVal = document.getElementById('saDeleteConfirmClubId').value.trim();
  const pinVal    = document.getElementById('saDeleteConfirmPin').value.trim();
  document.getElementById('saDeleteConfirmBtn').disabled =
    !(clubIdVal === _saActionClubId && pinVal.length > 0);
}

async function saConfirmDeactivate() {
  if (!_saActionClubId) return;
  const { data, error } = await db
    .from('clubs')
    .update({ active: false })
    .eq('club_id', _saActionClubId)
    .select();
  closeSAClubActionModal();
  if (error) { alert('Fehler: ' + error.message); return; }
  if (!data || data.length === 0) { alert('Update nicht ausgeführt.'); return; }
  await loadAndRenderSAClubs();
}

async function saExecuteClubDelete() {
  const clubIdVal = document.getElementById('saDeleteConfirmClubId').value.trim();
  const pinVal    = document.getElementById('saDeleteConfirmPin').value.trim();
  const errEl     = document.getElementById('saDeleteError');

  if (clubIdVal !== _saActionClubId) {
    errEl.textContent = 'Club-ID stimmt nicht überein.';
    return;
  }

  // PIN gegen DB prüfen
  errEl.textContent = 'PIN wird geprüft…';
  const { data: sa, error: saErr } = await db
    .from('super_admins')
    .select('pin')
    .eq('username', superAdminSession.username)
    .maybeSingle();

  if (saErr || !sa || sa.pin !== pinVal) {
    errEl.textContent = 'Falscher PIN. Löschung abgebrochen.';
    return;
  }

  errEl.textContent = 'Daten werden gelöscht…';
  document.getElementById('saDeleteConfirmBtn').disabled = true;

  const tables = [
    'attendance', 'archiv', 'weight_log', 'delete_candidates',
    'club_monthly_stats', 'club_yearly_snapshots',
    'trainer_groups', 'trainers', 'students', 'groups',
    'club_payments', 'promo_slides', 'promo_media', 'promo_settings', 'sponsors',
  ];

  for (const table of tables) {
    const { error } = await db.from(table).delete().eq('club_id', _saActionClubId);
    if (error) console.warn(`[SA] Delete ${table}:`, error.message);
  }

  const { error: clubErr } = await db
    .from('clubs')
    .delete()
    .eq('club_id', _saActionClubId);

  closeSAClubActionModal();

  if (clubErr) {
    alert('Fehler beim Löschen des Clubs: ' + clubErr.message);
    return;
  }

  await loadAndRenderSAClubs();
}

function saCopyClubLink(clubId, btn) {
  const url = `${window.location.origin}/?club=${clubId}`;
  navigator.clipboard.writeText(url).then(() => {
    const icon = btn.querySelector('.sa-copy-icon');
    if (icon) {
      icon.textContent = '✅';
      setTimeout(() => { icon.textContent = '⧉'; }, 2000);
    }
  });
}

function saCopyClubLinkFromInput(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input || !input.value) return;
  navigator.clipboard.writeText(input.value).then(() => {
    const icon = btn.querySelector('.sa-copy-icon');
    if (icon) {
      icon.textContent = '✅';
      setTimeout(() => { icon.textContent = '⧉'; }, 2000);
    }
  });
}

async function saOpenClub(clubId) {
  if (!superAdminSession) return;

  // Клуб загружается напрямую (без проверки active=true, SA видит всё)
  const { data: club, error } = await db
    .from('clubs')
    .select('*')
    .eq('club_id', clubId)
    .maybeSingle();

  if (error || !club) { alert('Club nicht gefunden.'); return; }

  // Применяем тему клуба
  currentClub = club;
  applyClubSettings();

  // Устанавливаем SA-режим
  isSuperAdminAccess = true;

  // В standalone-режиме убираем класс, чтобы club UI не скрывался
  document.body.classList.remove('sa-standalone-mode');

  // Скрываем все SA-экраны
  document.getElementById('superAdminScreen')?.classList.add('hidden');
  document.getElementById('saClubsScreen')?.classList.add('hidden');
  document.getElementById('saEditClubScreen')?.classList.add('hidden');
  document.getElementById('saNewClubScreen')?.classList.add('hidden');
  document.getElementById('saTarifScreen')?.classList.add('hidden');

  // Показываем бейдж
  const badge = document.getElementById('saImpersonationBadge');
  if (badge) badge.classList.remove('hidden');
  const clubNameEl = document.getElementById('saImpClubName');
  if (clubNameEl) clubNameEl.textContent = '— ' + (club.club_name || clubId);
  document.body.classList.add('sa-imp-active');

  updateClubPaymentWarning();

  // Показываем стартовый экран клуба
  showSportStartScreen();
}

// =========================================================
// SUPER ADMIN — NEUER CLUB
// =========================================================

function showSANewClubScreen() {
  ['saNewClubName','saNewClubShortName','saNewClubId','saNewClubAktivVon',
   'saNewClubAktivBis','saNewClubPhone','saNewClubEmail','saNewClubWebsite',
   'saNewAdminNachname','saNewAdminVorname','saNewAdminTelefon',
   'saNewAdminEmail','saNewAdminPin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  // Сбросить file inputs и превью
  ['saNewClubLogoFile','saNewClubBgFile','saNewClubFaviconFile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
    const nameSpan = el?.closest('.sa-file-upload-area')?.querySelector('.sa-file-name');
    if (nameSpan) nameSpan.textContent = 'Keine Datei';
  });
  ['saNewClubLogoPreview','saNewClubBgPreview','saNewClubFaviconPreview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
  });
  // Сбросить Zahlungsart на trial
  const bcNew = document.getElementById('saNewClubBillingCycle');
  if (bcNew) bcNew.value = 'trial';

  // Сбросить цвета на дефолтные
  saSetColorPair('saNewClubPrimaryColor',   'saNewClubPrimaryColorText',   '#1a2332');
  saSetColorPair('saNewClubSecondaryColor', 'saNewClubSecondaryColorText', '#2d4a6e');
  saSetColorPair('saNewClubAccentColor',    'saNewClubAccentColorText',    '#4fc3f7');

  const hint = document.getElementById('saClubIdHint');
  if (hint) { hint.textContent = ''; hint.className = 'sa-field-hint'; }
  const err = document.getElementById('saNewClubError');
  if (err) err.textContent = '';
  document.getElementById('saNewClubScreen').classList.remove('hidden');
  setTimeout(() => document.getElementById('saNewClubName')?.focus(), 60);
}

function hideSANewClubScreen() {
  document.getElementById('saNewClubScreen').classList.add('hidden');
}

// Авто-подсказка club_id из названия клуба (только если поле ещё пустое)
function saAutoSuggestClubId(name) {
  const idField = document.getElementById('saNewClubId');
  if (!idField || idField.value.trim()) return;
  const slug = name.toLowerCase()
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/\s+/g,'-')
    .replace(/[^a-z0-9-]/g,'')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'');
  idField.value = slug;
}

// Проверка уникальности club_id в реальном времени (debounced)
let _saClubIdTimer = null;
function saCheckClubIdAvailable(value) {
  const hint = document.getElementById('saClubIdHint');
  if (!hint) return;
  const preview = document.getElementById('saNewClubLinkPreview');
  const copyBtn = document.getElementById('saNewClubLinkCopyBtn');
  if (preview) {
    preview.value = value ? `${window.location.origin}/?club=${value}` : '';
    if (copyBtn) copyBtn.disabled = !value;
  }
  clearTimeout(_saClubIdTimer);
  if (!value) { hint.textContent = ''; hint.className = 'sa-field-hint'; return; }
  hint.textContent = 'Wird geprüft…';
  hint.className = 'sa-field-hint sa-hint-check';
  _saClubIdTimer = setTimeout(async () => {
    const { data } = await db.from('clubs').select('club_id').eq('club_id', value).maybeSingle();
    if (data) {
      hint.textContent = '✗ Club-ID bereits vergeben';
      hint.className = 'sa-field-hint sa-hint-error';
    } else {
      hint.textContent = '✓ Club-ID verfügbar';
      hint.className = 'sa-field-hint sa-hint-ok';
    }
  }, 500);
}

async function saveSANewClub() {
  const clubName      = document.getElementById('saNewClubName')?.value.trim()      || '';
  const clubShortName = document.getElementById('saNewClubShortName')?.value.trim() || '';
  const clubId        = document.getElementById('saNewClubId')?.value.trim()         || '';
  const aktivVon      = document.getElementById('saNewClubAktivVon')?.value          || null;
  const aktivBis      = document.getElementById('saNewClubAktivBis')?.value          || null;
  const phone         = document.getElementById('saNewClubPhone')?.value.trim()      || null;
  const email         = document.getElementById('saNewClubEmail')?.value.trim()      || null;
  const website       = document.getElementById('saNewClubWebsite')?.value.trim()    || null;
  const billingCycle  = document.getElementById('saNewClubBillingCycle')?.value      || 'trial';

  const adminNachname = document.getElementById('saNewAdminNachname')?.value.trim() || '';
  const adminVorname  = document.getElementById('saNewAdminVorname')?.value.trim()  || '';
  const adminTelefon  = document.getElementById('saNewAdminTelefon')?.value.trim()  || null;
  const adminEmail    = document.getElementById('saNewAdminEmail')?.value.trim()    || null;
  const adminPin      = document.getElementById('saNewAdminPin')?.value.trim()      || '';

  const errEl = document.getElementById('saNewClubError');
  const setError = (msg) => { if (errEl) errEl.textContent = msg; };
  if (errEl) errEl.textContent = '';

  // Validierung
  if (!clubName)      return setError('Vereinsname ist Pflichtfeld.');
  if (!clubShortName) return setError('Kurzname ist Pflichtfeld.');
  if (!clubId)        return setError('Club-ID ist Pflichtfeld.');
  if (!/^[a-z0-9-]+$/.test(clubId))
    return setError('Club-ID: nur Kleinbuchstaben, Zahlen und Bindestriche.');
  if (!adminNachname) return setError('Nachname des Administrators ist Pflichtfeld.');
  if (!adminPin || adminPin.length < 4)
    return setError('PIN muss mindestens 4 Zeichen haben.');

  // Club-ID Eindeutigkeit prüfen
  const { data: existing } = await db
    .from('clubs').select('club_id').eq('club_id', clubId).maybeSingle();
  if (existing) return setError('Club-ID "' + clubId + '" ist bereits vergeben.');

  // 1. INSERT clubs
  const { error: clubError } = await db
    .from('clubs')
    .insert([{
      club_id:         clubId,
      club_name:       clubName,
      club_short_name: clubShortName,
      active:          true,
      aktiv_von:       aktivVon || null,
      aktiv_bis:       aktivBis || null,
      phone,
      email,
      website,
      billing_cycle:   billingCycle,
      created_at:      new Date().toISOString()
    }]);
  if (clubError) return setError('Fehler beim Erstellen des Clubs: ' + clubError.message);

  // 2. INSERT promo_settings (non-fatal)
  await db.from('promo_settings').upsert(
    [{ club_id: clubId, mode: 'random', duration: 3 }],
    { onConflict: 'club_id' }
  );

  // 3. Загрузка White Label файлов и цветов
  const logoFile    = document.getElementById('saNewClubLogoFile')?.files[0];
  const bgFile      = document.getElementById('saNewClubBgFile')?.files[0];
  const faviconFile = document.getElementById('saNewClubFaviconFile')?.files[0];
  const primaryColor   = document.getElementById('saNewClubPrimaryColorText')?.value || '#1a2332';
  const secondaryColor = document.getElementById('saNewClubSecondaryColorText')?.value || '#2d4a6e';
  const accentColor    = document.getElementById('saNewClubAccentColorText')?.value    || '#4fc3f7';

  const wlUpdate = { primary_color: primaryColor, secondary_color: secondaryColor, accent_color: accentColor };

  if (logoFile) {
    const url = await saUploadClubFile(clubId, logoFile, '_logo');
    if (url) { wlUpdate.logo_url = url; wlUpdate.start_logo_url = url; }
  }
  if (bgFile) {
    const url = await saUploadClubFile(clubId, bgFile, '_bg');
    if (url) wlUpdate.background_image_url = url;
  }
  if (faviconFile) {
    const url = await saUploadClubFile(clubId, faviconFile, '_favicon');
    if (url) wlUpdate.favicon_url = url;
  }

  await db.from('clubs').update(wlUpdate).eq('club_id', clubId);

  // 4. INSERT erster Admin in trainers
  const adminName      = (adminNachname + ' ' + adminVorname).trim();
  const adminTrainerId = 'TR-' + Date.now().toString().slice(-6);

  const { error: trainerError } = await db
    .from('trainers')
    .insert([{
      trainer_id: adminTrainerId,
      name:       adminName,
      telefon:    adminTelefon,
      email:      adminEmail,
      pin:        adminPin,
      rolle:      'Admin',
      aktiv:      'JA',
      club_id:    clubId
    }]);

  if (trainerError) {
    setError('Club erstellt ✓, aber Admin konnte nicht angelegt werden: ' + trainerError.message);
    return;
  }

  // Erfolg
  hideSANewClubScreen();
  await loadAndRenderSAClubs();
}

// =========================================================
// SUPER ADMIN — TARIFPAKETE
// =========================================================

async function showSATarifScreen() {
  document.getElementById('saTarifScreen').classList.remove('hidden');
  document.getElementById('saTarifLoadingMsg').classList.remove('hidden');
  document.getElementById('saTarifList').innerHTML = '';
  await loadAndRenderSATarife();
}

function hideSATarifScreen() {
  document.getElementById('saTarifScreen').classList.add('hidden');
}

async function loadAndRenderSATarife() {
  const loadingEl = document.getElementById('saTarifLoadingMsg');
  const listEl    = document.getElementById('saTarifList');

  const { data: tarife, error } = await db
    .from('tariff_packages')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    loadingEl.textContent = 'Fehler beim Laden: ' + error.message;
    return;
  }

  loadingEl.classList.add('hidden');
  listEl.innerHTML = tarife.map(t => renderSATarifCard(t)).join('');
}

function renderSATarifCard(tarif) {
  const isActive  = tarif.aktiv === 'JA';
  const cardCls   = isActive ? '' : ' sa-tarif-inactive';
  const statusCls = isActive ? 'sa-status-aktiv' : 'sa-status-inaktiv';
  const statusTxt = isActive ? 'Aktiv' : 'Inaktiv';

  const maxLabel = tarif.max_students != null ? tarif.max_students : '∞';
  const cur      = tarif.currency || 'EUR';

  const fmtPrice = (val, suffix) => val > 0
    ? `<div class="sa-tarif-price-item">
         <span class="sa-tarif-price-val">${val} ${cur}</span>
         <span class="sa-tarif-price-lbl">${suffix}</span>
       </div>`
    : `<div class="sa-tarif-price-item sa-tarif-price-empty">
         <span class="sa-tarif-price-val">—</span>
         <span class="sa-tarif-price-lbl">${suffix}</span>
       </div>`;

  const priceHtml = `
    ${fmtPrice(tarif.price_monthly   || 0, 'pro Monat')}
    ${fmtPrice(tarif.price_quarterly || 0, 'pro Quartal')}
    ${fmtPrice(tarif.price_yearly    || 0, 'pro Jahr')}`;

  const toggleBtn = isActive
    ? `<button class="sa-club-btn sa-club-btn-deactivate" onclick="saToggleTarifActive('${tarif.id}', true)">Deaktivieren</button>`
    : `<button class="sa-club-btn sa-club-btn-activate"   onclick="saToggleTarifActive('${tarif.id}', false)">Aktivieren</button>`;

  return `
<div class="sa-tarif-card${cardCls}" id="sa-tarif-${tarif.id}">
  <div class="sa-tarif-name-badge">${tarif.name}</div>

  <div class="sa-tarif-info">
    <div class="sa-tarif-range">
      Schüler: <strong>${tarif.min_students} – ${maxLabel}</strong>
    </div>
    <div class="sa-tarif-prices-grid">${priceHtml}</div>
  </div>

  <span class="sa-status-badge ${statusCls}">${statusTxt}</span>

  <div class="sa-tarif-actions">
    <button class="sa-club-btn sa-club-btn-edit" onclick="showSATarifFormEdit('${tarif.id}')">Bearbeiten</button>
    ${toggleBtn}
  </div>
</div>`;
}

async function saToggleTarifActive(tarifId, currentActive) {
  const newAktiv = currentActive ? 'NEIN' : 'JA';
  const action   = currentActive ? 'deaktivieren' : 'aktivieren';
  if (!confirm(`Tarif wirklich ${action}?`)) return;

  const { data, error } = await db
    .from('tariff_packages')
    .update({ aktiv: newAktiv })
    .eq('id', tarifId)
    .select();

  if (error) { alert('Fehler: ' + error.message); return; }
  if (!data || data.length === 0) {
    alert('Update nicht ausgeführt — RLS möglicherweise aktiv.');
    return;
  }
  await loadAndRenderSATarife();
}

function showSATarifFormNew() {
  document.getElementById('saTarifFormTitle').textContent = 'Neuer Tarif';
  document.getElementById('saTarifFormId').value              = '';
  document.getElementById('saTarifName').value                = '';
  document.getElementById('saTarifAktiv').value               = 'JA';
  document.getElementById('saTarifMin').value                 = '0';
  document.getElementById('saTarifMax').value                 = '';
  document.getElementById('saTarifCurrency').value            = 'EUR';
  document.getElementById('saTarifDesc').value                = '';
  document.getElementById('saTarifSort').value                = '10';
  document.getElementById('saTarifPriceMonthly').value        = '';
  document.getElementById('saTarifPriceQuarterly').value      = '';
  document.getElementById('saTarifPriceYearly').value         = '';
  const err = document.getElementById('saTarifFormError');
  if (err) err.textContent = '';
  document.getElementById('saTarifFormScreen').classList.remove('hidden');
}

async function showSATarifFormEdit(tarifId) {
  const { data: t, error } = await db
    .from('tariff_packages')
    .select('*')
    .eq('id', tarifId)
    .maybeSingle();

  if (error || !t) { alert('Tarif nicht gefunden.'); return; }

  document.getElementById('saTarifFormTitle').textContent = 'Tarif bearbeiten';
  document.getElementById('saTarifFormId').value              = t.id;
  document.getElementById('saTarifName').value                = t.name          || '';
  document.getElementById('saTarifAktiv').value               = t.aktiv         || 'JA';
  document.getElementById('saTarifMin').value                 = t.min_students  ?? 0;
  document.getElementById('saTarifMax').value                 = t.max_students  != null ? t.max_students : '';
  document.getElementById('saTarifCurrency').value            = t.currency      || 'EUR';
  document.getElementById('saTarifDesc').value                = t.description   || '';
  document.getElementById('saTarifSort').value                = t.sort_order    ?? 10;
  document.getElementById('saTarifPriceMonthly').value        = t.price_monthly   ?? '';
  document.getElementById('saTarifPriceQuarterly').value      = t.price_quarterly ?? '';
  document.getElementById('saTarifPriceYearly').value         = t.price_yearly    ?? '';
  const err = document.getElementById('saTarifFormError');
  if (err) err.textContent = '';
  document.getElementById('saTarifFormScreen').classList.remove('hidden');
}

function hideSATarifForm() {
  document.getElementById('saTarifFormScreen').classList.add('hidden');
}

async function saveSATarif() {
  const id        = document.getElementById('saTarifFormId').value.trim();
  const name      = document.getElementById('saTarifName').value.trim();
  const aktiv     = document.getElementById('saTarifAktiv').value;
  const minVal    = document.getElementById('saTarifMin').value;
  const maxVal    = document.getElementById('saTarifMax').value.trim();
  const currency  = document.getElementById('saTarifCurrency').value.trim() || 'EUR';
  const desc      = document.getElementById('saTarifDesc').value.trim()     || null;
  const sort      = document.getElementById('saTarifSort').value;
  const priceM    = document.getElementById('saTarifPriceMonthly').value;
  const priceQ    = document.getElementById('saTarifPriceQuarterly').value;
  const priceY    = document.getElementById('saTarifPriceYearly').value;

  const errEl    = document.getElementById('saTarifFormError');
  const setError = msg => { if (errEl) errEl.textContent = msg; };
  if (errEl) errEl.textContent = '';

  if (!name)     return setError('Paketname ist Pflichtfeld.');
  if (minVal === '') return setError('Schüler von ist Pflichtfeld.');

  const monthlyPrice = priceM !== '' ? parseFloat(priceM) : 0;

  const payload = {
    name,
    aktiv,
    min_students:    parseInt(minVal, 10),
    max_students:    maxVal !== '' ? parseInt(maxVal, 10) : null,
    price:           monthlyPrice,          // обратная совместимость
    price_monthly:   monthlyPrice,
    price_quarterly: priceQ !== '' ? parseFloat(priceQ) : 0,
    price_yearly:    priceY !== '' ? parseFloat(priceY) : 0,
    currency,
    description:     desc,
    sort_order:      parseInt(sort, 10) || 0,
  };

  if (id) {
    const { error } = await db.from('tariff_packages').update(payload).eq('id', id);
    if (error) return setError('Fehler beim Speichern: ' + error.message);
  } else {
    const { error } = await db.from('tariff_packages').insert([payload]);
    if (error) return setError('Fehler beim Erstellen: ' + error.message);
  }

  hideSATarifForm();
  await loadAndRenderSATarife();
}

// =========================================================
// SUPER ADMIN -- CLUB BEARBEITEN
// =========================================================

async function showSAEditClubScreen(clubId) {
  const { data: club, error } = await db
    .from('clubs')
    .select('*')
    .eq('club_id', clubId)
    .maybeSingle();

  if (error || !club) { alert('Club nicht gefunden: ' + (error?.message || '')); return; }

  document.getElementById('saEditClubIdHidden').value  = club.club_id;
  document.getElementById('saEditClubIdDisplay').value = club.club_id;
  const editLink = document.getElementById('saEditClubLinkDisplay');
  if (editLink) editLink.value = `${window.location.origin}/?club=${club.club_id}`;
  document.getElementById('saEditClubName').value       = club.club_name       || '';
  document.getElementById('saEditClubShortName').value  = club.club_short_name || '';
  document.getElementById('saEditClubActive').value     = club.active ? 'true' : 'false';
  document.getElementById('saEditClubAktivVon').value   = club.aktiv_von || '';
  document.getElementById('saEditClubAktivBis').value   = club.aktiv_bis || '';
  document.getElementById('saEditClubPhone').value      = club.phone   || '';
  document.getElementById('saEditClubEmail').value      = club.email   || '';
  document.getElementById('saEditClubWebsite').value    = club.website || '';
  const bcEdit = document.getElementById('saEditClubBillingCycle');
  if (bcEdit) bcEdit.value = club.billing_cycle || 'trial';

  const pc = club.primary_color   || '#1a2332';
  const sc = club.secondary_color || '#2d4a6e';
  const ac = club.accent_color    || '#4fc3f7';
  saSetColorPair('saEditClubPrimaryColor',   'saEditClubPrimaryColorText',   pc);
  saSetColorPair('saEditClubSecondaryColor', 'saEditClubSecondaryColorText', sc);
  saSetColorPair('saEditClubAccentColor',    'saEditClubAccentColorText',    ac);

  saSetEditThumb('saEditClubLogoThumb',    club.logo_url);
  saSetEditThumb('saEditClubBgThumb',      club.background_image_url);
  saSetEditThumb('saEditClubFaviconThumb', club.favicon_url);

  ['saEditClubLogoFile','saEditClubBgFile','saEditClubFaviconFile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
    const nameSpan = el?.closest('.sa-file-upload-area')?.querySelector('.sa-file-name');
    if (nameSpan) nameSpan.textContent = 'Keine Aenderung';
  });
  ['saEditClubLogoPreview','saEditClubBgPreview','saEditClubFaviconPreview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.innerHTML = ''; }
  });

  // Загрузить Hauptadministrator клуба
  const { data: adminTrainer } = await db
    .from('trainers')
    .select('trainer_id, name, telefon, email, pin, rolle')
    .eq('club_id', clubId)
    .eq('rolle', 'Admin')
    .eq('aktiv', 'JA')
    .order('trainer_id', { ascending: true })
    .limit(1)
    .maybeSingle();

  const adminBadge   = document.getElementById('saEditAdminBadge');
  const missingBadge = document.getElementById('saEditAdminMissingBadge');

  if (adminTrainer) {
    document.getElementById('saEditAdminTrainerId').value = adminTrainer.trainer_id;
    // name = "Nachname Vorname" — разбиваем по первому пробелу
    const parts = (adminTrainer.name || '').split(' ');
    document.getElementById('saEditAdminNachname').value = parts[0] || '';
    document.getElementById('saEditAdminVorname').value  = parts.slice(1).join(' ') || '';
    document.getElementById('saEditAdminTelefon').value  = adminTrainer.telefon || '';
    document.getElementById('saEditAdminEmail').value    = adminTrainer.email   || '';
    document.getElementById('saEditAdminPin').value      = '';
    if (adminBadge)   { adminBadge.textContent = adminTrainer.name; adminBadge.classList.remove('hidden'); }
    if (missingBadge) missingBadge.classList.add('hidden');
  } else {
    document.getElementById('saEditAdminTrainerId').value = '';
    document.getElementById('saEditAdminNachname').value  = '';
    document.getElementById('saEditAdminVorname').value   = '';
    document.getElementById('saEditAdminTelefon').value   = '';
    document.getElementById('saEditAdminEmail').value     = '';
    document.getElementById('saEditAdminPin').value       = '';
    if (adminBadge)   adminBadge.classList.add('hidden');
    if (missingBadge) missingBadge.classList.remove('hidden');
  }

  const err = document.getElementById('saEditClubError');
  if (err) err.textContent = '';

  document.getElementById('saEditClubScreen').classList.remove('hidden');
}

function hideSAEditClubScreen() {
  document.getElementById('saEditClubScreen').classList.add('hidden');
}

async function saveSAEditClub() {
  const clubId        = document.getElementById('saEditClubIdHidden')?.value        || '';
  const clubName      = document.getElementById('saEditClubName')?.value.trim()      || '';
  const clubShortName = document.getElementById('saEditClubShortName')?.value.trim() || '';
  const activeVal     = document.getElementById('saEditClubActive')?.value === 'true';
  const aktivVon      = document.getElementById('saEditClubAktivVon')?.value         || null;
  const aktivBis      = document.getElementById('saEditClubAktivBis')?.value         || null;
  const phone         = document.getElementById('saEditClubPhone')?.value.trim()     || null;
  const email         = document.getElementById('saEditClubEmail')?.value.trim()     || null;
  const website       = document.getElementById('saEditClubWebsite')?.value.trim()   || null;
  const billingCycle  = document.getElementById('saEditClubBillingCycle')?.value     || 'trial';
  const primaryColor   = document.getElementById('saEditClubPrimaryColorText')?.value  || '#1a2332';
  const secondaryColor = document.getElementById('saEditClubSecondaryColorText')?.value || '#2d4a6e';
  const accentColor    = document.getElementById('saEditClubAccentColorText')?.value    || '#4fc3f7';

  const errEl   = document.getElementById('saEditClubError');
  const setError = (msg) => { if (errEl) errEl.textContent = msg; };
  if (errEl) errEl.textContent = '';

  if (!clubName)      return setError('Vereinsname ist Pflichtfeld.');
  if (!clubShortName) return setError('Kurzname ist Pflichtfeld.');

  const updatePayload = {
    club_name:       clubName,
    club_short_name: clubShortName,
    active:          activeVal,
    aktiv_von:       aktivVon || null,
    aktiv_bis:       aktivBis || null,
    phone, email, website,
    billing_cycle:   billingCycle,
    primary_color:   primaryColor,
    secondary_color: secondaryColor,
    accent_color:    accentColor,
  };

  const logoFile    = document.getElementById('saEditClubLogoFile')?.files[0];
  const bgFile      = document.getElementById('saEditClubBgFile')?.files[0];
  const faviconFile = document.getElementById('saEditClubFaviconFile')?.files[0];

  if (logoFile) {
    const url = await saUploadClubFile(clubId, logoFile, '_logo');
    if (url) { updatePayload.logo_url = url; updatePayload.start_logo_url = url; }
  }
  if (bgFile) {
    const url = await saUploadClubFile(clubId, bgFile, '_bg');
    if (url) updatePayload.background_image_url = url;
  }
  if (faviconFile) {
    const url = await saUploadClubFile(clubId, faviconFile, '_favicon');
    if (url) updatePayload.favicon_url = url;
  }

  const { error } = await db
    .from('clubs')
    .update(updatePayload)
    .eq('club_id', clubId);

  if (error) return setError('Fehler beim Speichern: ' + error.message);

  // Hauptadministrator speichern
  const adminTrainerId = document.getElementById('saEditAdminTrainerId')?.value || '';
  const adminNachname  = document.getElementById('saEditAdminNachname')?.value.trim() || '';
  const adminVorname   = document.getElementById('saEditAdminVorname')?.value.trim()  || '';
  const adminTelefon   = document.getElementById('saEditAdminTelefon')?.value.trim()  || null;
  const adminEmail     = document.getElementById('saEditAdminEmail')?.value.trim()    || null;
  const adminPin       = document.getElementById('saEditAdminPin')?.value.trim()      || '';

  if (adminNachname) {
    const adminName = (adminNachname + (adminVorname ? ' ' + adminVorname : '')).trim();

    if (adminTrainerId) {
      // UPDATE bestehenden Admin
      const adminUpdate = { name: adminName, telefon: adminTelefon, email: adminEmail };
      if (adminPin.length >= 4) adminUpdate.pin = adminPin;
      const { error: aErr } = await db
        .from('trainers')
        .update(adminUpdate)
        .eq('trainer_id', adminTrainerId)
        .eq('club_id', clubId);
      if (aErr) return setError('Club gespeichert ✓, aber Admin-Update fehlgeschlagen: ' + aErr.message);
    } else {
      // INSERT neuen Admin
      if (!adminPin || adminPin.length < 4)
        return setError('Club gespeichert ✓. Für neuen Admin bitte PIN (min. 4 Zeichen) eingeben.');
      const newTrainerId = 'TR-' + Date.now().toString().slice(-6);
      const { error: aErr } = await db
        .from('trainers')
        .insert([{
          trainer_id: newTrainerId,
          name:       adminName,
          telefon:    adminTelefon,
          email:      adminEmail,
          pin:        adminPin,
          rolle:      'Admin',
          aktiv:      'JA',
          club_id:    clubId
        }]);
      if (aErr) return setError('Club gespeichert ✓, aber Admin konnte nicht angelegt werden: ' + aErr.message);
    }
  }

  hideSAEditClubScreen();
  await loadAndRenderSAClubs();
}

// =========================================================
// SUPER ADMIN -- HELPERS
// =========================================================

async function saUploadClubFile(clubId, file, prefix) {
  const ext      = file.name.split('.').pop().toLowerCase();
  const filePath = clubId + '/' + prefix + '.' + ext;
  const { error } = await db.storage
    .from('promo_slides')
    .upload(filePath, file, { upsert: true, contentType: file.type });
  if (error) { console.error('[SA Upload]', filePath, error); return null; }
  const { data } = db.storage.from('promo_slides').getPublicUrl(filePath);
  return data?.publicUrl || null;
}

function saPreviewFile(input, previewId) {
  const file = input.files[0];
  const nameSpan = input.closest('.sa-file-upload-area')?.querySelector('.sa-file-name');
  if (nameSpan) nameSpan.textContent = file ? file.name : 'Keine Datei';
  const preview = document.getElementById(previewId);
  if (!preview) return;
  if (!file) { preview.classList.add('hidden'); preview.innerHTML = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    preview.innerHTML = '<img src="' + e.target.result + '" alt="Vorschau">';
    preview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function saColorTextSync(textId, colorId) {
  const val = document.getElementById(textId)?.value || '';
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    const picker = document.getElementById(colorId);
    if (picker) picker.value = val;
  }
}

function saSetColorPair(pickerId, textId, value) {
  const picker = document.getElementById(pickerId);
  const text   = document.getElementById(textId);
  if (picker) picker.value = value;
  if (text)   text.value   = value;
}

function saSetEditThumb(thumbId, url) {
  const el = document.getElementById(thumbId);
  if (!el) return;
  if (url) {
    el.innerHTML = '<img src="' + url + '" alt="">';
    el.classList.remove('hidden');
  } else {
    el.innerHTML = '';
    el.classList.add('hidden');
  }
}

// =========================================================
// SUPER ADMIN -- CLUBS SEARCH / FILTER
// =========================================================

// =========================================================
// УНИВЕРСАЛЬНАЯ ФАБРИКА ФИЛЬТРАЦИИ ДЛЯ SA-ЭКРАНОВ
// cfg = { inputId, clearId, sugBoxId, infoId, labelId,
//         getCache, renderFn, matchFn, nameFn, selectFn }
// =========================================================
function saMakeFilter(cfg) {
  function renderVisible(items) {
    cfg.renderFn(items);
  }

  function onInput() {
    const query    = (document.getElementById(cfg.inputId)?.value || '').trim().toLowerCase();
    const clearBtn = document.getElementById(cfg.clearId);
    const sugBox   = document.getElementById(cfg.sugBoxId);
    if (clearBtn) clearBtn.classList.toggle('hidden', !query);
    if (!query) { if (sugBox) sugBox.classList.add('hidden'); return; }

    const cache   = cfg.getCache();
    const matches = cache.filter(item => cfg.matchFn(item, query));
    if (!sugBox) return;

    if (!matches.length) {
      sugBox.innerHTML = '<div class="sa-clubs-suggestions-empty">Keine Clubs gefunden</div>';
      sugBox.classList.remove('hidden');
      return;
    }

    sugBox.innerHTML = matches.slice(0, 10).map(item => {
      const club       = item.club;
      const logoHtml   = club.logo_url
        ? '<img class="sa-suggestion-logo" src="' + club.logo_url + '" alt="">'
        : '<div class="sa-suggestion-logo-placeholder">🏛</div>';
      const statusCls  = club.active ? 'sa-suggestion-aktiv' : 'sa-suggestion-inaktiv';
      const statusTxt  = club.active ? 'Aktiv' : 'Inaktiv';
      const adminLine  = item.adminTrainer ? item.adminTrainer.name : '';
      const metaTxt    = [club.club_id, adminLine].filter(Boolean).join(' · ');
      return '<div class="sa-suggestion-item" onclick="' + cfg.selectFn + '(\'' + club.club_id + '\')">'
        + logoHtml
        + '<div class="sa-suggestion-info">'
        + '<div class="sa-suggestion-name">' + (club.club_name || club.club_id) + '</div>'
        + '<div class="sa-suggestion-meta">' + metaTxt + '</div>'
        + '</div>'
        + '<span class="sa-suggestion-status ' + statusCls + '">' + statusTxt + '</span>'
        + '</div>';
    }).join('');
    sugBox.classList.remove('hidden');
  }

  function onSelect(clubId) {
    const item = cfg.getCache().find(i => i.club.club_id === clubId);
    if (!item) return;
    const sugBox   = document.getElementById(cfg.sugBoxId);
    if (sugBox) sugBox.classList.add('hidden');
    const inp      = document.getElementById(cfg.inputId);
    if (inp) inp.value = cfg.nameFn(item);
    const clearBtn = document.getElementById(cfg.clearId);
    if (clearBtn) clearBtn.classList.remove('hidden');
    renderVisible([item]);
    const info  = document.getElementById(cfg.infoId);
    const label = document.getElementById(cfg.labelId);
    if (label) label.textContent = 'Angezeigt: ' + cfg.nameFn(item);
    if (info)  info.classList.remove('hidden');
  }

  function onReset() {
    const inp      = document.getElementById(cfg.inputId);
    if (inp) inp.value = '';
    const clearBtn = document.getElementById(cfg.clearId);
    if (clearBtn) clearBtn.classList.add('hidden');
    const sugBox   = document.getElementById(cfg.sugBoxId);
    if (sugBox) sugBox.classList.add('hidden');
    const info     = document.getElementById(cfg.infoId);
    if (info) info.classList.add('hidden');
    renderVisible(cfg.getCache());
  }

  return { renderVisible, onInput, onSelect, onReset };
}

// --- Clubs Management filter ---
const _defaultMatch = ({ club, adminTrainer }, q) =>
  (club.club_name       || '').toLowerCase().includes(q) ||
  (club.club_short_name || '').toLowerCase().includes(q) ||
  (club.club_id         || '').toLowerCase().includes(q) ||
  (adminTrainer?.name   || '').toLowerCase().includes(q);

const _clubsFilter = saMakeFilter({
  inputId:   'saClubsSearchInput',
  clearId:   'saClubsSearchClear',
  sugBoxId:  'saClubsSuggestions',
  infoId:    'saClubsFilterInfo',
  labelId:   'saClubsFilterLabel',
  getCache:  () => _saClubsCache,
  renderFn:  items => {
    const listEl = document.getElementById('saClubsList');
    if (!listEl) return;
    listEl.innerHTML = items.length
      ? items.map(({ club, studentCount, adminTrainer, tarifRows }) =>
          renderSAClubCard(club, studentCount, adminTrainer, tarifRows)).join('')
      : '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3);font-size:14px;">Keine Clubs gefunden.</div>';
  },
  matchFn:   _defaultMatch,
  nameFn:    item => item.club.club_name || item.club.club_id,
  selectFn:  'saClubsFilterSelect',
});

function saClubsRenderVisible(items) { _clubsFilter.renderVisible(items); }
function saClubsFilterInput()        { _clubsFilter.onInput(); }
function saClubsFilterSelect(id)     { _clubsFilter.onSelect(id); }
function saClubsFilterReset()        { _clubsFilter.onReset(); }

// --- Zahlungen filter ---
const _zahlFilter = saMakeFilter({
  inputId:   'saZahlSearchInput',
  clearId:   'saZahlSearchClear',
  sugBoxId:  'saZahlSuggestions',
  infoId:    'saZahlFilterInfo',
  labelId:   'saZahlFilterLabel',
  getCache:  () => _saZahlungenCache,
  renderFn:  items => {
    const listEl = document.getElementById('saZahlungenList');
    if (!listEl) return;
    listEl.innerHTML = items.length
      ? items.map(item => renderSAZahlungCard(item)).join('')
      : '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3);font-size:14px;">Keine Clubs gefunden.</div>';
  },
  matchFn:   _defaultMatch,
  nameFn:    item => item.club.club_name || item.club.club_id,
  selectFn:  'saZahlFilterSelect',
});

function saZahlFilterInput()     { _zahlFilter.onInput(); }
function saZahlFilterSelect(id)  { _zahlFilter.onSelect(id); }
function saZahlFilterReset()     { _zahlFilter.onReset(); }

// Скрывать подсказки при клике вне поля (оба экрана)
document.addEventListener('click', function(e) {
  ['saClubsSuggestions', 'saZahlSuggestions'].forEach(id => {
    const sug  = document.getElementById(id);
    const bars = document.querySelectorAll('.sa-clubs-search-bar');
    if (!sug) return;
    let inside = false;
    bars.forEach(b => { if (b.contains(e.target)) inside = true; });
    if (!inside) sug.classList.add('hidden');
  });
});

// =========================================================
// SUPER ADMIN -- ZAHLUNGEN / ABO-VERWALTUNG
// =========================================================

let _saZahlungenCache = [];   // { club, studentCount, adminTrainer, tarifRows, lastPayment }

async function showSAZahlungenScreen() {
  document.getElementById('saZahlungenScreen').classList.remove('hidden');
  document.getElementById('saZahlungenLoadingMsg').classList.remove('hidden');
  document.getElementById('saZahlungenList').innerHTML = '';
  await loadAndRenderSAZahlungen();
}

function hideSAZahlungenScreen() {
  document.getElementById('saZahlungenScreen').classList.add('hidden');
}

async function loadAndRenderSAZahlungen() {
  const loadingEl = document.getElementById('saZahlungenLoadingMsg');
  const listEl    = document.getElementById('saZahlungenList');

  const { data: clubs, error } = await db
    .from('clubs')
    .select('club_id, club_name, club_short_name, active, aktiv_von, aktiv_bis, last_payment_date, billing_cycle, phone, email, contract_active, contract_number, contract_start, contract_end, contract_auto_debit, contract_note')
    .order('club_name', { ascending: true });

  if (error) { loadingEl.textContent = 'Fehler: ' + error.message; return; }

  const { data: studentRows } = await db.from('students').select('club_id').eq('aktiv', 'JA');
  const countMap = {};
  (studentRows || []).forEach(r => { countMap[r.club_id] = (countMap[r.club_id] || 0) + 1; });

  const { data: tarifRows } = await db
    .from('tariff_packages')
    .select('id, name, min_students, max_students, price_monthly, price_quarterly, price_yearly, currency')
    .eq('aktiv', 'JA')
    .order('sort_order', { ascending: true });

  // Администраторы клубов (для поиска по имени)
  const { data: adminRows } = await db
    .from('trainers')
    .select('club_id, name')
    .eq('rolle', 'Admin')
    .eq('aktiv', 'JA');

  const adminMap = {};
  (adminRows || []).forEach(r => { if (!adminMap[r.club_id]) adminMap[r.club_id] = r; });

  // Последние оплаты по каждому клубу
  const { data: payRows } = await db
    .from('club_payments')
    .select('club_id, payment_date, period_end, amount, currency, billing_cycle, tariff_name')
    .order('payment_date', { ascending: false });

  const lastPayMap = {};
  (payRows || []).forEach(p => { if (!lastPayMap[p.club_id]) lastPayMap[p.club_id] = p; });

  // Автодеактивация просроченных клубов
  await saAutoDeactivateExpired(clubs || []);

  _saZahlungenCache = (clubs || [])
    .sort((a, b) => saZahlSortPriority(a) - saZahlSortPriority(b))
    .map(c => ({
      club:         c,
      studentCount: countMap[c.club_id] || 0,
      adminTrainer: adminMap[c.club_id] || null,
      tarifRows:    tarifRows || [],
      lastPayment:  lastPayMap[c.club_id] || null,
    }));

  saUpdateZahlDashBadges(_saZahlungenCache);
  loadingEl.classList.add('hidden');
  _zahlFilter.onReset();
}

// Универсальный расчёт warning-статуса клуба (для Dashboard, Clubs Mgmt, Zahlungen)
function saGetClubWarningStatus(club) {
  const today = new Date(); today.setHours(0,0,0,0);
  const hasAutoContract = club.contract_active === 'JA' && club.contract_auto_debit === 'JA';

  // Оплата
  let payWarn = null, payDaysLeft = null;
  if (club.billing_cycle !== 'trial' && club.aktiv_bis && !hasAutoContract) {
    const bis = new Date(club.aktiv_bis); bis.setHours(0,0,0,0);
    if (bis < today) {
      payWarn = 'expired';
    } else {
      const d = Math.round((bis - today) / 86400000);
      if (d <= 15) { payWarn = 'soon'; payDaysLeft = d; }
    }
  }

  // Контракт
  let contractWarn = null, contractDaysLeft = null;
  if (club.contract_active === 'JA' && club.contract_auto_debit !== 'JA' && club.contract_end) {
    const end = new Date(club.contract_end); end.setHours(0,0,0,0);
    const d = Math.round((end - today) / 86400000);
    if (d <= 30) { contractWarn = 'soon'; contractDaysLeft = d; }
  }

  return { payWarn, payDaysLeft, contractWarn, contractDaysLeft };
}

// Возвращает CSS-статус оплаты клуба для карточки Zahlungen
function saPaymentStatus(club) {
  const cycle = club.billing_cycle || 'trial';
  if (cycle === 'trial') return { cls: 'sa-pay-status-trial', txt: 'Testperiode', cardCls: 'sa-pay-trial', payWarn: null };
  if (!club.aktiv_bis)   return { cls: 'sa-pay-status-open',  txt: 'Offen',       cardCls: '',             payWarn: null };

  const { payWarn, payDaysLeft } = saGetClubWarningStatus(club);
  const today = new Date(); today.setHours(0,0,0,0);
  const bis   = new Date(club.aktiv_bis); bis.setHours(0,0,0,0);

  if (bis < today) return { cls: 'sa-pay-status-overdue', txt: 'Überfällig', cardCls: 'sa-pay-overdue',  payWarn: 'expired' };
  if (payWarn === 'soon') return { cls: 'sa-pay-status-ok', txt: 'Bezahlt', cardCls: 'sa-pay-expiring', payWarn: 'soon', daysLeft: payDaysLeft };
  return { cls: 'sa-pay-status-ok', txt: 'Bezahlt', cardCls: '', payWarn: null };
}

// Возвращает предупреждение по контракту — теперь через универсальную функцию
function saContractWarn(club) {
  const { contractWarn, contractDaysLeft } = saGetClubWarningStatus(club);
  return contractWarn ? { daysLeft: contractDaysLeft } : null;
}

// Приоритет сортировки для Zahlungen-экрана
function saZahlSortPriority(club) {
  const today = new Date(); today.setHours(0,0,0,0);
  if (club.aktiv_bis) {
    const bis = new Date(club.aktiv_bis); bis.setHours(0,0,0,0);
    if (bis < today) return 0;                       // просрочена оплата
    const d = Math.round((bis - today) / 86400000);
    const hasAuto = club.contract_active === 'JA' && club.contract_auto_debit === 'JA';
    if (!hasAuto && d <= 15) return 1;               // оплата скоро заканчивается
  }
  if (saContractWarn(club)) return 2;                // контракт скоро заканчивается
  return 3;                                          // всё ок
}

// Автодеактивация просроченных клубов (без контракта с автосписанием)
async function saAutoDeactivateExpired(clubs) {
  const today = new Date(); today.setHours(0,0,0,0);
  const toDeactivate = clubs.filter(c => {
    if (!c.active) return false;
    if (c.contract_active === 'JA' && c.contract_auto_debit === 'JA') return false;
    if (!c.aktiv_bis) return false;
    const bis = new Date(c.aktiv_bis); bis.setHours(0,0,0,0);
    return bis < today;
  });
  if (!toDeactivate.length) return;
  const ids = toDeactivate.map(c => c.club_id);
  await db.from('clubs').update({ active: false }).in('club_id', ids);
  toDeactivate.forEach(c => { c.active = false; });
}

// Обновить бейджи Dashboard
function saUpdateZahlDashBadges(items) {
  let countExpired = 0, countSoon = 0, countContract = 0;
  items.forEach(({ club }) => {
    const { payWarn, contractWarn } = saGetClubWarningStatus(club);
    if (payWarn === 'expired')    countExpired++;
    else if (payWarn === 'soon')  countSoon++;
    if (contractWarn)             countContract++;
  });
  const el = document.getElementById('saZahlDashBadges');
  if (!el) return;
  const parts = [];
  if (countExpired) parts.push(`<span class="sa-dash-zbadge sa-dash-zbadge--red">🔴 ${countExpired}</span>`);
  if (countSoon)    parts.push(`<span class="sa-dash-zbadge sa-dash-zbadge--orange">⚠ ${countSoon}</span>`);
  if (countContract)parts.push(`<span class="sa-dash-zbadge sa-dash-zbadge--blue">📄 ${countContract}</span>`);
  el.innerHTML = parts.join('');
  el.classList.toggle('hidden', !parts.length);
}

function renderSAZahlungCard({ club, studentCount, tarifRows, lastPayment }) {
  const cycle = club.billing_cycle || 'trial';
  const cycleLabels = { trial: 'Testperiode', monthly: 'Monatlich', quarterly: 'Quartalsweise', yearly: 'Jährlich' };

  const matchedTarif = (tarifRows || []).find(t =>
    studentCount >= t.min_students &&
    (t.max_students == null || studentCount <= t.max_students)
  );
  const priceMap  = { monthly: matchedTarif?.price_monthly, quarterly: matchedTarif?.price_quarterly, yearly: matchedTarif?.price_yearly };
  const curPrice  = priceMap[cycle];
  const priceStr  = cycle === 'trial' ? '0 EUR'
    : (curPrice != null && curPrice > 0 ? curPrice + ' ' + (matchedTarif?.currency || 'EUR') : '—');

  const status       = saPaymentStatus(club);
  const contractWarn = saContractWarn(club);
  const isActive = club.active;

  const lastPayStr = lastPayment
    ? saFormatDate(lastPayment.payment_date) + ' · ' + (lastPayment.amount || '—') + ' ' + (lastPayment.currency || 'EUR')
    : '—';

  // Предупреждение по оплате
  let payWarnRow = '';
  if (status.payWarn === 'expired') {
    payWarnRow = '<div class="sa-pay-warn sa-pay-warn--red">🔴 Zahlung abgelaufen · Club automatisch inaktiv</div>';
  } else if (status.payWarn === 'soon') {
    payWarnRow = '<div class="sa-pay-warn sa-pay-warn--orange">⚠ Zahlung läuft bald ab: noch ' + status.daysLeft + ' Tage</div>';
  }

  // Предупреждение по контракту
  const contractWarnRow = contractWarn !== null
    ? '<div class="sa-pay-warn sa-pay-warn--blue">📄 Vertrag läuft bald ab: noch ' + contractWarn.daysLeft + ' Tage</div>'
    : '';

  const hasContract = club.contract_active === 'JA';
  const contractRow = hasContract
    ? '<div class="sa-pay-contract-row">'
      + '<span class="sa-pay-contract-icon">📋</span>'
      + '<span class="sa-pay-contract-label">Vertrag:</span>'
      + (club.contract_number ? '<span class="sa-pay-contract-value">Nr. ' + club.contract_number + '</span><span class="sa-pay-contract-sep">·</span>' : '')
      + '<span class="sa-pay-contract-value">' + saFormatDate(club.contract_start) + ' – ' + saFormatDate(club.contract_end) + '</span>'
      + (club.contract_auto_debit === 'JA' ? '<span class="sa-pay-contract-sep">·</span><span class="sa-pay-contract-label">Aut. Abbuchung</span><span class="sa-pay-contract-value">Ja</span>' : '')
      + '</div>'
    : '<div class="sa-pay-contract-row"><span class="sa-pay-contract-none">Vertrag: —</span></div>';

  return '<div class="sa-pay-card ' + status.cardCls + '" id="sa-pay-card-' + club.club_id + '">'
    + payWarnRow
    + contractWarnRow
    + '<div class="sa-pay-card-top">'
    +   '<div>'
    +     '<div class="sa-pay-card-name">' + (club.club_name || club.club_id) + '</div>'
    +     '<div class="sa-pay-card-id">club_id: ' + club.club_id + '</div>'
    +   '</div>'
    +   '<span class="sa-pay-status ' + status.cls + '">' + status.txt + '</span>'
    + '</div>'
    + contractRow
    + '<div class="sa-pay-meta">'
    +   '<div class="sa-pay-meta-item"><span class="sa-pay-meta-label">Status</span><span class="sa-pay-meta-value">' + (isActive ? 'Aktiv' : 'Inaktiv') + '</span></div>'
    +   '<div class="sa-pay-meta-item"><span class="sa-pay-meta-label">Schüler aktiv</span><span class="sa-pay-meta-value">' + studentCount + '</span></div>'
    +   '<div class="sa-pay-meta-item"><span class="sa-pay-meta-label">Tarif</span><span class="sa-pay-meta-value">' + (matchedTarif ? matchedTarif.name : '—') + '</span></div>'
    +   '<div class="sa-pay-meta-item"><span class="sa-pay-meta-label">Zahlungsart</span><span class="sa-pay-meta-value">' + (cycleLabels[cycle] || cycle) + '</span></div>'
    +   '<div class="sa-pay-meta-item"><span class="sa-pay-meta-label">Preis (aktuell)</span><span class="sa-pay-meta-value">' + priceStr + '</span></div>'
    +   '<div class="sa-pay-meta-item"><span class="sa-pay-meta-label">Aktiv von</span><span class="sa-pay-meta-value">' + saFormatDate(club.aktiv_von) + '</span></div>'
    +   '<div class="sa-pay-meta-item"><span class="sa-pay-meta-label">Aktiv bis</span><span class="sa-pay-meta-value">' + saFormatDate(club.aktiv_bis) + '</span></div>'
    +   '<div class="sa-pay-meta-item"><span class="sa-pay-meta-label">Letzte Zahlung</span><span class="sa-pay-meta-value">' + lastPayStr + '</span></div>'
    + '</div>'
    + '<div class="sa-pay-actions">'
    +   '<button class="sa-pay-btn-add" onclick="showSAZahlungForm(\'' + club.club_id + '\')">+ Zahlung hinzufügen</button>'
    + '</div>'
    + '</div>';
}

// --- Форма Zahlung hinzufügen ---

async function showSAZahlungForm(clubId) {
  const item = _saZahlungenCache.find(i => i.club.club_id === clubId);
  if (!item) return;

  const { club, studentCount, tarifRows, lastPayment } = item;
  document.getElementById('saZahlungClubId').value = clubId;

  // Инфо-бокс
  const cycle = club.billing_cycle || 'trial';
  const matchedTarif = (tarifRows || []).find(t =>
    studentCount >= t.min_students &&
    (t.max_students == null || studentCount <= t.max_students)
  );
  const priceMap = { monthly: matchedTarif?.price_monthly, quarterly: matchedTarif?.price_quarterly, yearly: matchedTarif?.price_yearly };
  const suggestedPrice = priceMap[cycle] || 0;

  const infoBox = document.getElementById('saZahlungClubInfoBox');
  if (infoBox) {
    infoBox.innerHTML =
      '<div class="sa-pay-info-item"><span class="sa-pay-info-label">Club</span><span class="sa-pay-info-value">' + (club.club_name || clubId) + '</span></div>'
    + '<div class="sa-pay-info-item"><span class="sa-pay-info-label">Schüler aktiv</span><span class="sa-pay-info-value">' + studentCount + '</span></div>'
    + '<div class="sa-pay-info-item"><span class="sa-pay-info-label">Tarif</span><span class="sa-pay-info-value">' + (matchedTarif ? matchedTarif.name : '—') + '</span></div>'
    + '<div class="sa-pay-info-item"><span class="sa-pay-info-label">Aktiv bis (aktuell)</span><span class="sa-pay-info-value">' + saFormatDate(club.aktiv_bis) + '</span></div>';
  }

  // Дефолты формы
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('saZahlungDate').value     = today;
  document.getElementById('saZahlungAmount').value   = suggestedPrice > 0 ? suggestedPrice : '';
  document.getElementById('saZahlungCurrency').value = matchedTarif?.currency || 'EUR';
  document.getElementById('saZahlungNote').value     = '';

  // Установить billing_cycle клуба как дефолт (не trial)
  const formCycle = (cycle === 'trial') ? 'monthly' : cycle;
  document.getElementById('saZahlungCycle').value = formCycle;

  // Заполнить поля контракта из данных клуба
  document.getElementById('saZahlungContractActive').value    = club.contract_active    || 'NEIN';
  document.getElementById('saZahlungContractAutoDebit').value = club.contract_auto_debit || 'NEIN';
  document.getElementById('saZahlungContractNumber').value    = club.contract_number    || '';
  document.getElementById('saZahlungContractStart').value     = club.contract_start     || '';
  document.getElementById('saZahlungContractEnd').value       = club.contract_end       || '';
  document.getElementById('saZahlungContractNote').value      = club.contract_note      || '';
  saToggleContractFields();

  // Вычислить период
  saZahlungUpdatePeriod();

  const err = document.getElementById('saZahlungFormError');
  if (err) err.textContent = '';

  document.getElementById('saZahlungFormScreen').classList.remove('hidden');
}

function hideSAZahlungForm() {
  document.getElementById('saZahlungFormScreen').classList.add('hidden');
}

function saToggleContractFields() {
  const active  = document.getElementById('saZahlungContractActive')?.value === 'JA';
  const details = document.getElementById('saVertragDetails');
  if (!details) return;
  if (active) { details.classList.add('open'); }
  else        { details.classList.remove('open'); }
}

function saCalcPeriod(aktiv_bis, cycle) {
  const today = new Date(); today.setHours(0,0,0,0);
  let start;

  if (!aktiv_bis) {
    start = new Date(today);
  } else {
    const bis = new Date(aktiv_bis); bis.setHours(0,0,0,0);
    if (bis < today) {
      start = new Date(today);
    } else {
      start = new Date(bis);
      start.setDate(start.getDate() + 1);
    }
  }

  const end = new Date(start);
  if      (cycle === 'monthly')   end.setMonth(end.getMonth() + 1);
  else if (cycle === 'quarterly') end.setMonth(end.getMonth() + 3);
  else if (cycle === 'yearly')    end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);   // включительный последний день

  const fmt = d => d.toISOString().split('T')[0];
  return { start: fmt(start), end: fmt(end) };
}

function saZahlungUpdatePeriod() {
  const clubId = document.getElementById('saZahlungClubId')?.value;
  const cycle  = document.getElementById('saZahlungCycle')?.value || 'monthly';
  const item   = _saZahlungenCache.find(i => i.club.club_id === clubId);
  const aktiv_bis = item?.club.aktiv_bis || null;

  const { start, end } = saCalcPeriod(aktiv_bis, cycle);
  document.getElementById('saZahlungPeriodStart').value = start;
  document.getElementById('saZahlungPeriodEnd').value   = end;

  // Обновить suggested price при смене cycle
  if (item) {
    const { studentCount, tarifRows } = item;
    const matchedTarif = (tarifRows || []).find(t =>
      studentCount >= t.min_students &&
      (t.max_students == null || studentCount <= t.max_students)
    );
    const priceMap = { monthly: matchedTarif?.price_monthly, quarterly: matchedTarif?.price_quarterly, yearly: matchedTarif?.price_yearly };
    const price = priceMap[cycle];
    if (price != null && price > 0) document.getElementById('saZahlungAmount').value = price;
  }
}

async function saveSAZahlung() {
  const clubId      = document.getElementById('saZahlungClubId')?.value || '';
  const cycle       = document.getElementById('saZahlungCycle')?.value  || 'monthly';
  const amount      = document.getElementById('saZahlungAmount')?.value;
  const currency    = document.getElementById('saZahlungCurrency')?.value.trim() || 'EUR';
  const payDate     = document.getElementById('saZahlungDate')?.value;
  const periodStart = document.getElementById('saZahlungPeriodStart')?.value;
  const periodEnd   = document.getElementById('saZahlungPeriodEnd')?.value;
  const note        = document.getElementById('saZahlungNote')?.value.trim() || null;

  const errEl    = document.getElementById('saZahlungFormError');
  const setError = msg => { if (errEl) errEl.textContent = msg; };
  if (errEl) errEl.textContent = '';

  if (!clubId)      return setError('Club fehlt.');
  if (!amount)      return setError('Betrag ist Pflichtfeld.');
  if (!payDate)     return setError('Zahlungsdatum ist Pflichtfeld.');
  if (!periodStart || !periodEnd) return setError('Periode ist Pflichtfeld.');

  const item = _saZahlungenCache.find(i => i.club.club_id === clubId);
  const matchedTarif = item ? (item.tarifRows || []).find(t =>
    item.studentCount >= t.min_students &&
    (t.max_students == null || item.studentCount <= t.max_students)
  ) : null;

  // 1. INSERT club_payments
  const { error: payErr } = await db.from('club_payments').insert([{
    club_id:                    clubId,
    tariff_package_id:          matchedTarif?.id        || null,
    tariff_name:                matchedTarif?.name      || null,
    billing_cycle:              cycle,
    amount:                     parseFloat(amount),
    currency,
    payment_date:               payDate,
    period_start:               periodStart,
    period_end:                 periodEnd,
    note,
    created_by:                 superAdminSession?.username || 'super_admin',
    paid_tariff_min_students:   matchedTarif?.min_students  || null,
    paid_tariff_max_students:   matchedTarif?.max_students  || null,
    student_count_at_payment:   item?.studentCount          || 0,
  }]);
  if (payErr) return setError('Fehler beim Speichern der Zahlung: ' + payErr.message);

  // 2. UPDATE clubs (включая поля контракта)
  const contractActive    = document.getElementById('saZahlungContractActive')?.value    || 'NEIN';
  const contractAutoDebit = document.getElementById('saZahlungContractAutoDebit')?.value || 'NEIN';
  const contractNumber    = document.getElementById('saZahlungContractNumber')?.value.trim()  || null;
  const contractStart     = document.getElementById('saZahlungContractStart')?.value          || null;
  const contractEnd       = document.getElementById('saZahlungContractEnd')?.value            || null;
  const contractNote      = document.getElementById('saZahlungContractNote')?.value.trim()    || null;

  const clubUpdate = {
    active:               true,
    billing_cycle:        cycle,
    aktiv_bis:            periodEnd,
    last_payment_date:    payDate,
    contract_active:      contractActive,
    contract_auto_debit:  contractAutoDebit,
    contract_number:      contractActive === 'JA' ? contractNumber    : null,
    contract_start:       contractActive === 'JA' ? contractStart     : null,
    contract_end:         contractActive === 'JA' ? contractEnd       : null,
    contract_note:        contractActive === 'JA' ? contractNote      : null,
  };
  if (!item?.club.aktiv_von) clubUpdate.aktiv_von = periodStart;

  const { error: clubErr } = await db.from('clubs').update(clubUpdate).eq('club_id', clubId);
  if (clubErr) return setError('Zahlung gespeichert ✓, aber Club-Update fehlgeschlagen: ' + clubErr.message);

  hideSAZahlungForm();
  await loadAndRenderSAZahlungen();
}
