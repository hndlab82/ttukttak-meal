// 화면 동작
// 데이터는 전부 이 브라우저(localStorage)에 저장된다. 서버 없음. 백업 파일로 옮길 수 있다.
(function () {
  'use strict';

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var MEALS = [
    { id: 'breakfast', label: '아침' },
    { id: 'lunch', label: '점심' },
    { id: 'dinner', label: '저녁' }
  ];
  var MEAL_LABEL = { breakfast: '아침', lunch: '점심', dinner: '저녁' };
  var CAT_LABEL = { soup: '국', main: '메인', side: '반찬', one: '일품', special: '특식' };
  var KIND_LABEL = { normal: '보통', one: '일품 요리', special: '특식' };
  var REASONS = ['재료 없음', '손이 많이 감', '비쌈', '별로임'];
  var KEY = {
    device: 'meal.device',
    outbox: 'meal.outbox',
    settings: 'meal.settings',
    plans: 'meal.plans',
    excluded: 'meal.excluded',
    custom: 'meal.custom',
    logs: 'meal.logs'
  };

  // ── 저장소 (실패해도 앱은 돌아가게) ──
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 못 해도 계속 */ }
  }

  // ── 날짜 ──
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function upcomingMonday() {
    var today = new Date();
    var dow = today.getDay();
    if (dow === 1) return ymd(today);
    var x = new Date(today);
    x.setDate(x.getDate() + ((8 - dow) % 7 || 7));
    return ymd(x);
  }
  function md(s) { var d = parse(s); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function dowOf(s) { return DOW[parse(s).getDay()]; }
  // 그 주 목요일이 속한 달 기준으로 "10월 2주"
  function weekTitle(monday) {
    var thu = parse(addDays(monday, 3));
    return (thu.getMonth() + 1) + '월 ' + Math.ceil(thu.getDate() / 7) + '주';
  }
  function now() { return new Date().toISOString(); }
  function fmtTime(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ── 상태 ──
  var defaults = {
    storeName: '우리 식당',
    style: 'field', // field = 현장식당·백반, cafeteria = 구내식당·한식뷔페
    meals: ['lunch'],
    weekdays: [1, 2, 3, 4, 5, 6],
    layout: { soup: 1, main: 1, side: 3 },
    rices: ['흰쌀밥'],
    kimchis: ['배추김치'],
    origin: '',
    oneDays: [],
    fontSize: 'large',
    shareLogs: true,
    welcomed: false,
    dials: { efficiency: 'normal', budget: 'normal', repeat: '2w' }
  };
  // ── 자동 보관본: 하루에 한 번, 앱이 데이터를 읽기 전에 원래 모습 그대로 한 부 복사해 둔다 (최근 3개) ──
  // 새 버전이 옛 데이터를 잘못 읽는 일이 생겨도 이걸로 되살릴 수 있다.
  var SAFETY_KEY = 'meal.safety';
  (function keepSafetyCopy() {
    try {
      var raw = { settings: localStorage.getItem(KEY.settings), plans: localStorage.getItem(KEY.plans), excluded: localStorage.getItem(KEY.excluded), custom: localStorage.getItem(KEY.custom) };
      if (!raw.plans || raw.plans === '{}') return;
      var list = JSON.parse(localStorage.getItem(SAFETY_KEY) || '[]');
      var today = new Date().toISOString().slice(0, 10);
      if (list.length && list[0].day === today) return;
      list.unshift({ day: today, at: new Date().toISOString(), raw: raw });
      localStorage.setItem(SAFETY_KEY, JSON.stringify(list.slice(0, 3)));
    } catch (e) { /* 저장 공간이 모자라면 건너뛴다 */ }
  })();

  var S = {
    settings: null,
    plans: load(KEY.plans, {}),
    excluded: new Set(load(KEY.excluded, [])),
    custom: load(KEY.custom, []),
    logs: load(KEY.logs, []),
    week: upcomingMonday(),
    sheet: null,
    undo: null
  };
  S.settings = normalizeSettings(load(KEY.settings, {}));
  (function rememberSource() {
    var m = /[?&]from=([A-Za-z0-9_-]{1,30})/.exec(location.search);
    if (m && !S.settings.source) { S.settings.source = m[1]; save(KEY.settings, S.settings); }
  })();
  Object.keys(S.plans).forEach(function (w) { normalizePlan(S.plans[w]); });

  // 예전 형식의 설정·식단도 읽을 수 있게 맞춘다
  function normalizeSettings(raw) {
    var st = Object.assign({}, defaults, raw || {});
    st.dials = Object.assign({}, defaults.dials, st.dials);
    st.layout = Object.assign({}, defaults.layout, st.layout);
    if (typeof st.rice === 'string') { st.rices = st.rice ? [st.rice] : []; delete st.rice; }
    if (typeof st.kimchi === 'string') { st.kimchis = st.kimchi ? [st.kimchi] : []; delete st.kimchi; }
    ['meals', 'weekdays', 'rices', 'kimchis', 'oneDays'].forEach(function (k) {
      st[k] = Array.isArray(st[k]) ? st[k].slice() : defaults[k].slice();
    });
    if (!st.meals.length) st.meals = ['lunch'];
    return st;
  }
  function normalizePlan(p) {
    delete p.keys;
    if (p.confirmedAt && !p.savedAt) p.savedAt = p.confirmedAt;
    delete p.confirmedAt;
    p.days.forEach(function (e) {
      if (!e.meal) e.meal = 'lunch';
      if (!e.kind) e.kind = 'normal';
      if (!e.labels) e.labels = {};
      if (!e.items) e.items = {};
      if (!e.off) ensureRows(p, e);
    });
    return p;
  }

  function persist() {
    save(KEY.settings, S.settings);
    save(KEY.plans, S.plans);
    save(KEY.excluded, Array.from(S.excluded));
    save(KEY.custom, S.custom);
    save(KEY.logs, S.logs);
  }

  function allMenus() { return MENUS.concat(S.custom); }
  function findMenu(name) {
    if (!name) return null;
    var list = allMenus();
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }
  function plan() { return S.plans[S.week] || null; }
  function mealOrder(id) { for (var i = 0; i < MEALS.length; i++) if (MEALS[i].id === id) return i; return 9; }

  // 저장했는지: 저장 뒤에 고친 게 있으면 다시 저장해야 한다
  function isSaved(p) {
    return !!(p && p.savedAt && (!p.updatedAt || p.savedAt >= p.updatedAt));
  }
  function touch(p) { p.updatedAt = now(); }

  // ── 사용 기록 ──
  function log(type, data) {
    data = data || {};
    var entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      week: S.week,
      event_type: type,
      target_date: data.date || null,
      meal: data.meal || null,
      slot: data.slot || null,
      before_value: data.before == null ? null : data.before,
      after_value: data.after == null ? null : data.after,
      reason: data.reason || null,
      detail: data.detail || null,
      created_at: now()
    };
    S.logs.push(entry);
    if (S.logs.length > 5000) S.logs = S.logs.slice(-5000);
    queueRemote(entry);
  }

  // ── 사용 기록 보내기 (서비스 개선용) ──
  // 이름·전화번호 같은 개인정보는 보내지 않는다. 가게 구분은 가게 이름과 이 브라우저의 무작위 번호로.
  var REMOTE = typeof MEAL_CONFIG !== 'undefined' && MEAL_CONFIG.supabaseUrl && MEAL_CONFIG.supabaseKey ? MEAL_CONFIG : null;
  function deviceId() {
    var id = load(KEY.device, null);
    if (!id) {
      id = 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      save(KEY.device, id);
    }
    return id;
  }
  var outbox = load(KEY.outbox, []);
  var sending = false;
  function queueRemote(entry) {
    if (!REMOTE || S.settings.shareLogs === false) return;
    outbox.push({
      device_id: deviceId(),
      store_name: S.settings.storeName || null,
      week: entry.week,
      event_type: entry.event_type,
      target_date: entry.target_date,
      meal: entry.meal,
      slot: entry.slot,
      before_value: entry.before_value,
      after_value: entry.after_value,
      reason: entry.reason,
      detail: S.settings.source ? Object.assign({ from: S.settings.source }, entry.detail || {}) : entry.detail,
      rules_version: RULES.version,
      client_created_at: entry.created_at
    });
    if (outbox.length > 2000) outbox = outbox.slice(-2000); // 오래 못 보내면 오래된 것부터 버린다
    save(KEY.outbox, outbox);
    clearTimeout(queueRemote.timer);
    queueRemote.timer = setTimeout(flushRemote, 3000);
  }
  // 새 방식 공개 열쇠(sb_publishable_…)는 apikey 머리말에만 넣는다. 예전 방식(eyJ…)은 Authorization 에도 넣는다.
  function remoteHeaders() {
    var h = { 'Content-Type': 'application/json', apikey: REMOTE.supabaseKey, Prefer: 'return=minimal' };
    if (/^eyJ/.test(REMOTE.supabaseKey)) h.Authorization = 'Bearer ' + REMOTE.supabaseKey;
    return h;
  }
  function flushRemote() {
    if (!REMOTE || sending || !outbox.length) return;
    sending = true;
    var batch = outbox.slice(0, 200);
    fetch(REMOTE.supabaseUrl.replace(/\/$/, '') + '/rest/v1/event_logs', {
      method: 'POST',
      headers: remoteHeaders(),
      body: JSON.stringify(batch),
      keepalive: true
    }).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      outbox = outbox.slice(batch.length);
      save(KEY.outbox, outbox);
    }).catch(function () { /* 인터넷이 끊기면 다음에 다시 보낸다 */ })
      .then(function () {
        sending = false;
        if (outbox.length) setTimeout(flushRemote, 10000);
      });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushRemote(); });

  // ── 엔진 연결 ──
  // 매일 나오는 김치의 재료도 그 끼니 재료로 친다 (예: 열무김치 + 열무 반찬 + 열무 국 몰림 방지)
  var KIMCHI_ING = [
    [/김치|소박이|깍두기|석박지|섞박지|동치미|겉절이/, '김치'],
    [/열무/, '열무'],
    [/총각|알타리|깍두기|석박지|섞박지|동치미|무김치|나박/, '무'],
    [/파김치/, '대파'],
    [/오이/, '오이'],
    [/갓김치/, '갓'],
    [/배추|포기김치|겉절이/, '배추']
  ];
  function fixedIngredients() {
    var out = [];
    S.settings.kimchis.forEach(function (k) {
      KIMCHI_ING.forEach(function (rule) {
        if (rule[0].test(k) && out.indexOf(rule[1]) < 0) out.push(rule[1]);
      });
    });
    return out;
  }
  // 이번 주를 뺀 다른 주 식단 = 겹침 방지용 기록
  function historyFor(week) {
    var out = [];
    Object.keys(S.plans).forEach(function (w) {
      if (w === week) return;
      S.plans[w].days.forEach(function (e) {
        if (e.off) return;
        out.push({ date: e.date, names: Object.keys(e.items).map(function (k) { return e.items[k]; }).filter(Boolean) });
      });
    });
    return out;
  }
  // 이번 주에 걸친 달 (제철 판단용). 예: 9/29~10/4 주 → [9, 10]
  function weekMonths() {
    var out = [];
    for (var i = 0; i < 7; i++) {
      var m = parse(addDays(S.week, i)).getMonth() + 1;
      if (out.indexOf(m) < 0) out.push(m);
    }
    return out;
  }
  // 그 날짜에 이 메뉴가 제철인지: 'peak' 제철 / 'off' 철 아님(제철에만 내는 메뉴) / '' 해당 없음
  function seasonOf(m, date) {
    if (!m) return '';
    var month = parse(date).getMonth() + 1;
    if (m.peak && m.peak.indexOf(month) >= 0) return 'peak';
    if (m.only && m.only.indexOf(month) < 0) return 'off';
    return '';
  }
  function monthsLabel(list) {
    return list && list.length ? list[0] + '~' + list[list.length - 1] + '월' : '';
  }
  function context(avoid) {
    return Engine.makeContext({
      menus: allMenus(),
      // 안 나오게 한 메뉴 + 매일 나오는 밥·김치와 같은 이름 (깍두기를 매일 내면 반찬 깍두기는 추천 안 함)
      excluded: new Set(Array.from(S.excluded).concat(S.settings.rices, S.settings.kimchis)),
      history: historyFor(S.week),
      dials: S.settings.dials,
      rules: RULES,
      avoid: avoid,
      fixedIng: fixedIngredients(),
      months: weekMonths(),
      style: S.settings.style,
      pairStats: typeof PAIR_STATS !== 'undefined' ? PAIR_STATS : {}
    });
  }
  // 그 끼니의 칸 목록 (일품 요리·특식 날은 구성이 다르다)
  // 끼니 칸 = 기본 구성 + 그 날만 추가한 메뉴 칸(e.extra, 예: 'side_x1'). 추가 칸도 겹침·재료 계산에 들어간다.
  // 그 날만 뺀 기본 칸(e.removed)은 빠진다.
  function entryKeys(p, e) {
    var removed = e.removed || [];
    return Engine.slotKeys(p.layout, e.kind).filter(function (k) { return removed.indexOf(k) < 0; }).concat(e.extra || []);
  }
  function gridOf(p) {
    return p.days.map(function (e) {
      return e.off ? null : entryKeys(p, e).map(function (k) { return e.items[k] || ''; });
    });
  }
  // 그 끼니의 일품 요리·특식 (없으면 null)
  function headDishOf(e) {
    if (e.kind === 'one') return findMenu(e.items.one_1);
    if (e.kind === 'special') return findMenu(e.items.special_1);
    return null;
  }
  // ── 끼니 안의 줄: 순서, 매일 나오는 밥·김치, 그 날만 추가한 것 ──
  // e.rows = [{ t: 'slot', key: 'main_1' }, { t: 'fixed', src: 'rice' | 'kimchi' | 'extra', label: '흰쌀밥' }, ...]
  // 설정의 밥·김치는 기본값이다. 식단표에서 그 끼니만 빼거나 바꾸면 e.fixedEdited[src] = true 가 되어
  // 나중에 설정을 바꿔도 그 끼니에는 퍼지지 않는다.
  function defaultRows(p, e) {
    var rows = [];
    S.settings.rices.forEach(function (l) { rows.push({ t: 'fixed', src: 'rice', label: l }); });
    entryKeys(p, e).forEach(function (k) { rows.push({ t: 'slot', key: k }); });
    S.settings.kimchis.forEach(function (l) { rows.push({ t: 'fixed', src: 'kimchi', label: l }); });
    return rows;
  }
  function ensureRows(p, e) {
    if (!e.rows) { e.rows = defaultRows(p, e); return; }
    var keys = entryKeys(p, e);
    var slotIdx = [];
    e.rows.forEach(function (r, idx) { if (r.t === 'slot') slotIdx.push(idx); });
    var have = slotIdx.map(function (idx) { return e.rows[idx].key; });
    if (have.length === keys.length && keys.every(function (k) { return have.indexOf(k) >= 0; })) return; // 같은 칸이면 순서 유지
    // 칸 구성이 바뀌었으면(보통 ↔ 일품·특식) 칸 자리에 새 구성을 순서대로 넣는다. 밥·김치 자리는 그대로.
    var rows = e.rows.filter(function (r) { return r.t !== 'slot'; });
    var firstSlot = slotIdx.length ? slotIdx[0] : e.rows.filter(function (r) { return r.src === 'rice'; }).length;
    var insertAt = e.rows.slice(0, firstSlot).filter(function (r) { return r.t !== 'slot'; }).length;
    var slots = keys.map(function (k) { return { t: 'slot', key: k }; });
    e.rows = rows.slice(0, insertAt).concat(slots, rows.slice(insertAt));
  }
  // 설정의 밥·김치가 바뀌면 이번 주부터 앞으로의 식단에 반영 (식단표에서 따로 고친 끼니는 빼고)
  function applyFixedDefaults() {
    Object.keys(S.plans).forEach(function (w) {
      if (w < S.week) return;
      var p = S.plans[w];
      var changed = false;
      p.days.forEach(function (e) {
        if (!e.rows) return;
        ['rice', 'kimchi'].forEach(function (src) {
          if (e.fixedEdited && e.fixedEdited[src]) return;
          var list = src === 'rice' ? S.settings.rices : S.settings.kimchis;
          var kept = [];
          var at = -1;
          e.rows.forEach(function (r) {
            if (r.t === 'fixed' && r.src === src) { if (at < 0) at = kept.length; }
            else kept.push(r);
          });
          if (at < 0) at = src === 'rice' ? 0 : kept.length;
          var next = kept.slice(0, at).concat(list.map(function (l) { return { t: 'fixed', src: src, label: l }; }), kept.slice(at));
          if (JSON.stringify(next) !== JSON.stringify(e.rows)) { e.rows = next; changed = true; }
        });
      });
      if (changed) touch(p);
    });
  }

  function runEngine(p, opts) {
    var res = Engine.generate({
      dates: p.days.map(function (e) { return e.date; }),
      off: p.days.map(function (e) { return e.off; }),
      keys: p.days.map(function (e) { return entryKeys(p, e); }),
      ctx: context(opts.avoid),
      seed: opts.seed,
      current: opts.current || null,
      editDays: opts.editDays || null
    });
    res.grid.forEach(function (row, i) {
      if (!row) return;
      if (opts.editDays && opts.editDays.indexOf(i) < 0) return;
      var items = {};
      entryKeys(p, p.days[i]).forEach(function (k, s) { items[k] = row[s]; });
      p.days[i].items = items;
      p.days[i].labels = {};
      ensureRows(p, p.days[i]);
    });
    return res;
  }
  function newSeed() { return Math.floor(Math.random() * 2147483647); }

  // 무거운 계산 전에 "만드는 중" 을 먼저 보여준다
  function busy(text, fn) {
    $('busy-text').textContent = text;
    $('busy').hidden = false;
    setTimeout(function () {
      try { fn(); } catch (e) { toast(e.message); console.error(e); } finally { $('busy').hidden = true; }
    }, 40);
  }

  // ── 동작 ──
  // 설정대로 이번 주 끼니 목록을 만든다. 휴무로 정한 날짜는 이전 식단에서 가져온다.
  function buildEntries(week, prev) {
    var st = S.settings;
    var offDates = {};
    if (prev) prev.days.forEach(function (e) { if (e.off) offDates[e.date] = true; });
    var meals = st.meals.slice().sort(function (a, b) { return mealOrder(a) - mealOrder(b); });
    var entries = [];
    for (var i = 0; i < 7; i++) {
      var date = addDays(week, i);
      var dow = parse(date).getDay();
      if (st.weekdays.indexOf(dow) < 0) continue;
      meals.forEach(function (meal) {
        // 일품 요리 요일: 점심이 있으면 점심만, 점심을 안 하면 모든 끼니
        var oneHere = st.oneDays.indexOf(dow) >= 0 && (meal === 'lunch' || meals.indexOf('lunch') < 0);
        entries.push({ date: date, meal: meal, off: !!offDates[date], kind: oneHere ? 'one' : 'normal', items: {}, labels: {} });
      });
    }
    return entries;
  }

  function generateWeek() {
    busy(plan() ? '식단을 새로 만드는 중…' : '식단 만드는 중…', doGenerateWeek);
  }
  function doGenerateWeek() {
    var prev = plan();
    var entries = buildEntries(S.week, prev);
    if (!entries.length) { toast('운영 요일과 끼니를 하나 이상 골라 주세요.'); return; }
    var seed = newSeed();
    var avoid = new Set();
    if (prev) {
      S.undo = { week: S.week, json: JSON.stringify(prev) };
      gridOf(prev).forEach(function (row) { if (row) row.forEach(function (n) { if (n) avoid.add(n); }); });
    }
    var p = {
      week: S.week,
      layout: Object.assign({}, S.settings.layout),
      days: entries,
      createdAt: prev ? prev.createdAt : now()
    };
    runEngine(p, { seed: seed, avoid: avoid });
    p.seed = seed;
    p.rulesVersion = RULES.version;
    p.dials = Object.assign({}, S.settings.dials);
    p.original = snapshot(p);
    p.savedAt = null;
    touch(p);
    S.plans[S.week] = p;
    log(prev ? 'reroll_all' : 'generate', {
      detail: {
        seed: seed, rules_version: RULES.version, dials: p.dials, layout: p.layout,
        meals: S.settings.meals, weekdays: S.settings.weekdays, original: p.original
      }
    });
    persist();
    S.reveal = true;
    render();
    if (prev) toast('새로 만들었어요.', '되돌리기', undo);
  }

  function entryKey(e) { return e.date + '|' + e.meal; }
  function snapshot(p) {
    var out = {};
    p.days.forEach(function (e) {
      if (!e.off) out[entryKey(e)] = {
        kind: e.kind,
        items: Object.assign({}, e.items),
        rows: (e.rows || []).map(function (r) { return r.t === 'slot' ? r.key : r.src + ':' + r.label; })
      };
    });
    return out;
  }
  function originalOf(p, e) {
    var o = p.original && (p.original[entryKey(e)] || p.original[e.date]);
    if (!o) return {};
    return o.items || o; // 예전 형식은 items 가 바로 들어 있다
  }

  function rerollEntry(i) {
    busy('새로 만드는 중…', function () {
      var p = plan();
      var e = p.days[i];
      S.undo = { week: S.week, json: JSON.stringify(p) };
      var avoid = new Set(Object.keys(e.items).map(function (k) { return e.items[k]; }).filter(Boolean));
      var before = Object.assign({}, e.items);
      runEngine(p, { seed: newSeed(), avoid: avoid, current: gridOf(p), editDays: [i] });
      touch(p);
      log('reroll_partial', { date: e.date, meal: e.meal, before: before, after: e.items });
      persist();
      closeSheet();
      render();
      toast(md(e.date) + ' ' + MEAL_LABEL[e.meal] + ' 식단을 새로 만들었어요.', '되돌리기', undo);
    });
  }

  // 날짜 전체 휴무 ↔ 영업
  function toggleOffDate(date) {
    busy('바꾸는 중…', function () {
      var p = plan();
      S.undo = { week: S.week, json: JSON.stringify(p) };
      var idx = [];
      var turnOff = p.days.some(function (e) { return e.date === date && !e.off; });
      p.days.forEach(function (e, i) {
        if (e.date !== date) return;
        e.off = turnOff;
        e.items = {};
        e.labels = {};
        idx.push(i);
      });
      if (!turnOff) runEngine(p, { seed: newSeed(), current: gridOf(p), editDays: idx });
      touch(p);
      log(turnOff ? 'day_off' : 'day_on', { date: date });
      persist();
      closeSheet();
      render();
      toast(md(date) + (turnOff ? '을 휴무로 했어요.' : '을 영업일로 했어요.'), '되돌리기', undo);
    });
  }

  // 끼니 종류 바꾸기: 보통 / 일품 요리 / 특식
  function setKind(i, kind) {
    var p = plan();
    var e = p.days[i];
    if (e.off || e.kind === kind) { closeSheet(); return; }
    busy('바꾸는 중…', function () {
      S.undo = { week: S.week, json: JSON.stringify(p) };
      var before = Object.assign({}, e.items);
      e.kind = kind;
      e.items = {};
      e.labels = {};
      runEngine(p, { seed: newSeed(), current: gridOf(p), editDays: [i] });
      touch(p);
      log('day_kind', { date: e.date, meal: e.meal, before: before, after: e.items, detail: { kind: kind } });
      persist();
      closeSheet();
      render();
      toast(md(e.date) + ' ' + MEAL_LABEL[e.meal] + '을 ' + KIND_LABEL[kind] + (kind === 'normal' ? ' 식단으로' : ' 날로') + ' 바꿨어요.', '되돌리기', undo);
    });
  }

  // 일품 요리·특식을 바꿨을 때 국 칸 맞추기: 국물 요리면 국을 빼고, 아니면 국을 채운다
  function fixSoupForHeadDish(i) {
    var p = plan();
    var e = p.days[i];
    if (!('soup_1' in e.items)) return;
    var dish = headDishOf(e);
    if (dish && dish.soupy) { e.items.soup_1 = ''; delete e.labels.soup_1; }
    else if (!e.items.soup_1) {
      var best = suggestions(i, 'soup_1', 1)[0];
      if (best) e.items.soup_1 = best.menu.name;
    }
  }

  function replace(i, k, name, reason) {
    var p = plan();
    var e = p.days[i];
    var before = e.items[k];
    S.undo = { week: S.week, json: JSON.stringify(p) };
    e.items[k] = name;
    delete e.labels[k];
    if (k === 'one_1' || k === 'special_1') fixSoupForHeadDish(i);
    touch(p);
    log('replace', { date: e.date, meal: e.meal, slot: k, before: before, after: name, reason: reason });
    persist();
    closeSheet();
    render();
    toast(before + ' → ' + name, '되돌리기', undo);
  }

  function rename(i, k, label) {
    var p = plan();
    var e = p.days[i];
    var before = e.labels[k] || e.items[k];
    label = label.trim();
    if (!label || label === before) { closeSheet(); return; }
    S.undo = { week: S.week, json: JSON.stringify(p) };
    if (label === e.items[k]) delete e.labels[k];
    else e.labels[k] = label;
    touch(p);
    log('rename', { date: e.date, meal: e.meal, slot: k, before: before, after: label });
    persist();
    closeSheet();
    render();
    // 같은 이름으로 두 번 이상 바꿨는데 메뉴 목록에 없으면 → 새 메뉴로 추가를 권한다
    var times = S.logs.filter(function (l) { return l.event_type === 'rename' && l.after_value === label; }).length;
    if (times >= 2 && !findMenu(label)) {
      toast(label + '을(를) ' + times + '번 쓰셨어요. 메뉴로 추가하면 추천에도 나와요.', '메뉴로 추가', function () {
        openAddForm(label, Engine.slotCat(k));
      });
    } else {
      toast('이름을 바꿨어요.', '되돌리기', undo);
    }
  }

  function rowLabel(e, r) {
    return r.t === 'slot' ? (e.labels[r.key] || e.items[r.key] || '') : r.label;
  }
  function moveRow(i, from, to) {
    var p = plan();
    var e = p.days[i];
    if (to < 0 || to >= e.rows.length || from === to) return false;
    S.undo = { week: S.week, json: JSON.stringify(p) };
    var row = e.rows.splice(from, 1)[0];
    e.rows.splice(to, 0, row);
    touch(p);
    log('reorder', { date: e.date, meal: e.meal, detail: { label: rowLabel(e, row), from: from, to: to } });
    persist();
    render();
    return true;
  }
  function removeFixedRow(i, r) {
    var p = plan();
    var e = p.days[i];
    S.undo = { week: S.week, json: JSON.stringify(p) };
    var row = e.rows.splice(r, 1)[0];
    if (row.src !== 'extra') { e.fixedEdited = e.fixedEdited || {}; e.fixedEdited[row.src] = true; }
    touch(p);
    log('fixed_remove', { date: e.date, meal: e.meal, before: row.label, detail: { src: row.src } });
    persist();
    closeSheet();
    render();
    toast(md(e.date) + ' ' + MEAL_LABEL[e.meal] + '에서 ' + row.label + '을(를) 뺐어요.', '되돌리기', undo);
  }
  function renameFixedRow(i, r, label) {
    var p = plan();
    var e = p.days[i];
    var row = e.rows[r];
    label = label.trim();
    if (!label || label === row.label) { closeSheet(); return; }
    S.undo = { week: S.week, json: JSON.stringify(p) };
    var before = row.label;
    row.label = label;
    if (row.src !== 'extra') { e.fixedEdited = e.fixedEdited || {}; e.fixedEdited[row.src] = true; }
    touch(p);
    log('fixed_rename', { date: e.date, meal: e.meal, before: before, after: label, detail: { src: row.src } });
    persist();
    closeSheet();
    render();
    toast(before + ' → ' + label, '되돌리기', undo);
  }
  function newExtraKey(e, cat) {
    var n = 1;
    var keys = e.extra || [];
    while (keys.indexOf(cat + '_x' + n) >= 0) n++;
    return cat + '_x' + n;
  }
  function insertBeforeKimchi(e, row) {
    var at = e.rows.length;
    for (var r = 0; r < e.rows.length; r++) if (e.rows[r].src === 'kimchi') { at = r; break; }
    e.rows.splice(at, 0, row);
  }
  // 추천 계산용: 잠깐 빈 칸을 만들어 후보를 받고 되돌린다
  function extraSuggestions(i, cat) {
    var e = plan().days[i];
    var key = newExtraKey(e, cat);
    e.extra = (e.extra || []).concat([key]);
    e.items[key] = '';
    var pool = suggestions(i, key, 25);
    e.extra = e.extra.slice(0, -1);
    delete e.items[key];
    if (!e.extra.length) delete e.extra;
    return pool;
  }
  function addExtraMenu(i, cat, name, reason) {
    var p = plan();
    var e = p.days[i];
    S.undo = { week: S.week, json: JSON.stringify(p) };
    var key = newExtraKey(e, cat);
    e.extra = (e.extra || []).concat([key]);
    e.items[key] = name;
    insertBeforeKimchi(e, { t: 'slot', key: key });
    touch(p);
    log('extra_menu_add', { date: e.date, meal: e.meal, slot: key, after: name, reason: reason });
    persist();
    closeSheet();
    render();
    toast(md(e.date) + ' ' + MEAL_LABEL[e.meal] + '에 ' + name + '을(를) 추가했어요.', '되돌리기', undo);
  }
  function removeSlot(i, k) {
    var p = plan();
    var e = p.days[i];
    if ((e.extra || []).indexOf(k) >= 0) { removeExtraMenu(i, k); return; }
    S.undo = { week: S.week, json: JSON.stringify(p) };
    var name = e.labels[k] || e.items[k];
    e.removed = (e.removed || []).concat([k]);
    delete e.items[k];
    delete e.labels[k];
    e.rows = e.rows.filter(function (r) { return !(r.t === 'slot' && r.key === k); });
    touch(p);
    log('slot_remove', { date: e.date, meal: e.meal, slot: k, before: name });
    persist();
    closeSheet();
    render();
    toast(md(e.date) + ' ' + MEAL_LABEL[e.meal] + '에서 ' + name + '을(를) 뺐어요.', '되돌리기', undo);
  }
  function removeRow(i, r) {
    var row = plan().days[i].rows[r];
    if (!row) return;
    if (row.t === 'slot') removeSlot(i, row.key);
    else removeFixedRow(i, r);
  }

  function removeExtraMenu(i, k) {
    var p = plan();
    var e = p.days[i];
    S.undo = { week: S.week, json: JSON.stringify(p) };
    var name = e.labels[k] || e.items[k];
    e.extra = (e.extra || []).filter(function (x) { return x !== k; });
    if (!e.extra.length) delete e.extra;
    delete e.items[k];
    delete e.labels[k];
    e.rows = e.rows.filter(function (r) { return !(r.t === 'slot' && r.key === k); });
    touch(p);
    log('extra_menu_remove', { date: e.date, meal: e.meal, slot: k, before: name });
    persist();
    closeSheet();
    render();
    toast(name + '을(를) 뺐어요.', '되돌리기', undo);
  }

  function addExtraRow(i, label) {
    var p = plan();
    var e = p.days[i];
    label = label.trim();
    if (!label) return;
    S.undo = { week: S.week, json: JSON.stringify(p) };
    insertBeforeKimchi(e, { t: 'fixed', src: 'extra', label: label }); // 김치 줄 앞에 (김치가 없으면 맨 끝)
    touch(p);
    log('extra_add', { date: e.date, meal: e.meal, after: label });
    persist();
    closeSheet();
    render();
    toast(md(e.date) + ' ' + MEAL_LABEL[e.meal] + '에 ' + label + '을(를) 넣었어요.', '되돌리기', undo);
  }

  function openAddForm(name, cat) {
    var panel = $('panel-menus');
    panel.open = true;
    $('add-name').value = name;
    $('add-cat').value = cat;
    $('add-form').dataset.fromRename = '1';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('add-ing').focus({ preventScroll: true });
    log('suggest_add_menu', { after: name });
    persist();
  }

  // 이름만 바꿔 쓰던 칸을 새로 추가한 진짜 메뉴로 연결 (재료 계산이 맞도록)
  function linkRenamed(name, cat) {
    var linked = 0;
    Object.keys(S.plans).forEach(function (w) {
      S.plans[w].days.forEach(function (e) {
        Object.keys(e.labels || {}).forEach(function (k) {
          if (e.labels[k] === name && Engine.slotCat(k) === cat) {
            e.items[k] = name;
            delete e.labels[k];
            linked++;
          }
        });
      });
    });
    return linked;
  }

  function excludeAndReplace(i, k) {
    var p = plan();
    var e = p.days[i];
    var name = e.items[k];
    S.excluded.add(name);
    log('exclude', { date: e.date, meal: e.meal, slot: k, before: name });
    var best = suggestions(i, k, 1)[0];
    if (best) replace(i, k, best.menu.name, 'excluded');
    else { persist(); closeSheet(); render(); }
    toast(name + '은(는) 이제 안 나와요. 메뉴 관리에서 되돌릴 수 있어요.');
  }

  // 처음 추천과 지금 식단의 차이 (식단 품질 개선에 쓰는 가장 중요한 기록)
  function diffOf(p) {
    var diff = [];
    p.days.forEach(function (e) {
      if (e.off) return;
      var orig = originalOf(p, e);
      entryKeys(p, e).forEach(function (k) {
        var cur = e.labels[k] || e.items[k] || '';
        var was = orig[k] || '';
        if (was !== cur) diff.push({ date: e.date, meal: e.meal, slot: k, from: was || null, to: cur || null });
      });
    });
    return diff;
  }

  function savePlan() {
    var p = plan();
    if (!p) return;
    var t = now();
    p.savedAt = p.updatedAt && p.updatedAt >= t ? p.updatedAt : t;
    var diff = diffOf(p);
    log('save', { detail: { diff: diff, final: snapshot(p), labels: p.days.map(function (e) { return e.labels; }) } });
    persist();
    render();
    toast(diff.length ? '저장했어요. 처음 추천에서 ' + diff.length + '개를 바꾸셨어요. 이제 인쇄할 수 있어요.' : '저장했어요. 추천 그대로 쓰셨어요. 이제 인쇄할 수 있어요.');
  }

  function undo() {
    if (!S.undo) return;
    S.plans[S.undo.week] = normalizePlan(JSON.parse(S.undo.json));
    S.week = S.undo.week;
    S.undo = null;
    log('undo');
    persist();
    render();
    toast('되돌렸어요.');
  }

  function needSaved() {
    var p = plan();
    if (!p) return false;
    if (!isSaved(p)) { toast('먼저 저장을 눌러 주세요. 저장해야 인쇄할 수 있어요.'); return false; }
    return true;
  }

  function printPlan() {
    if (!needSaved()) return;
    renderPrint();
    log('print', { detail: { diff: diffOf(plan()) } });
    persist();
    document.body.dataset.print = 'menu';
    window.print();
  }

  function printShop() {
    if (!plan()) return;
    renderShopSheet();
    log('print_shop');
    persist();
    document.body.dataset.print = 'shop';
    window.print();
  }
  window.addEventListener('afterprint', function () { delete document.body.dataset.print; });

  // 식단표를 사진(PNG)으로 저장 — 카톡·밴드에 올리기용
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function saveImage() {
    if (!needSaved()) return;
    $('busy-text').textContent = '사진 만드는 중…';
    $('busy').hidden = false;
    var ready = window.html2canvas ? Promise.resolve() : loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    ready.then(function () {
      renderPrint();
      var box = document.createElement('div');
      box.className = 'capture';
      var sheetCopy = $('print-sheet').cloneNode(true);
      sheetCopy.removeAttribute('id');
      box.appendChild(sheetCopy);
      document.body.appendChild(box);
      return (document.fonts ? document.fonts.ready : Promise.resolve())
        .then(function () { return window.html2canvas(box, { backgroundColor: '#ffffff', scale: 2 }); })
        .then(function (canvas) {
          box.remove();
          canvas.toBlob(function (blob) {
            download(blob, '식단표-' + S.week + '.png');
            log('export_image');
            persist();
            toast('사진으로 저장했어요. 다운로드 폴더를 확인하세요.');
          });
        }, function (err) { box.remove(); throw err; });
    }).catch(function () {
      toast('사진을 만들지 못했어요. 인터넷 연결을 확인하거나, 인쇄 창에서 "PDF로 저장"을 써 주세요.');
    }).then(function () { $('busy').hidden = true; });
  }

  function download(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function suggestions(i, k, limit) {
    var p = plan();
    return Engine.suggest({
      dates: p.days.map(function (e) { return e.date; }),
      off: p.days.map(function (e) { return e.off; }),
      keys: p.days.map(function (e) { return entryKeys(p, e); }),
      ctx: context(),
      current: gridOf(p),
      d: i,
      s: entryKeys(p, p.days[i]).indexOf(k),
      limit: limit
    });
  }

  // ── 백업 ──
  function exportBackup() {
    var data = {
      app: 'ttukttak-meal', version: 2, exported_at: now(), rules_version: RULES.version,
      settings: S.settings, plans: S.plans, excluded: Array.from(S.excluded), custom: S.custom, logs: S.logs
    };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), '식단표-백업-' + ymd(new Date()) + '.json');
    log('export_backup');
    persist();
  }
  function readBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { toast('백업 파일을 읽지 못했어요. 이 앱에서 받은 .json 파일인지 확인해 주세요.'); return; }
      if (!data || typeof data.plans !== 'object') { toast('백업 파일이 아니에요. 이 앱에서 받은 .json 파일을 골라 주세요.'); return; }
      openRestoreSheet(data, file.name);
    };
    reader.readAsText(file);
  }
  function safetyCopies() {
    try { return JSON.parse(localStorage.getItem(SAFETY_KEY) || '[]'); } catch (e) { return []; }
  }
  function renderSafety() {
    var list = safetyCopies();
    $('safety-list').innerHTML = list.length
      ? list.map(function (c, i) {
          var weeks = 0;
          try { weeks = Object.keys(JSON.parse(c.raw.plans || '{}')).length; } catch (e) { /* 무시 */ }
          return '<button type="button" class="chip" data-act="safety" data-idx="' + i + '">' + esc(fmtTime(c.at)) + ' 보관본 · 식단 ' + weeks + '주</button>';
        }).join('')
      : '<span class="note">아직 없어요. 내일부터 하루에 하나씩 생겨요.</span>';
  }
  function openSafety(i) {
    var c = safetyCopies()[i];
    if (!c) return;
    function parse(v, d) { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } }
    openRestoreSheet({
      app: 'ttukttak-meal', version: 2, exported_at: c.at,
      settings: parse(c.raw.settings, null), plans: parse(c.raw.plans, {}),
      excluded: parse(c.raw.excluded, []), custom: parse(c.raw.custom, []), logs: S.logs
    }, '자동 보관본 (' + fmtTime(c.at) + ')');
  }

  function restoreBackup(data) {
    S.plans = data.plans || {};
    Object.keys(S.plans).forEach(function (w) { normalizePlan(S.plans[w]); });
    if (data.settings) S.settings = normalizeSettings(data.settings);
    S.settings.welcomed = true;
    if (Array.isArray(data.excluded)) S.excluded = new Set(data.excluded);
    if (Array.isArray(data.custom)) S.custom = data.custom;
    if (Array.isArray(data.logs)) S.logs = data.logs;
    S.undo = null;
    log('import_backup', { detail: { weeks: Object.keys(S.plans).length, exported_at: data.exported_at || null } });
    persist();
    closeSheet();
    applyFontSize();
    render();
    toast('백업을 불러왔어요. 식단 ' + Object.keys(S.plans).length + '주치.');
  }

  // ── 지우기 ──
  var WIPE = {
    week: { title: '이번 주 식단 지우기', body: function () { return '<b>' + weekTitle(S.week) + ' (' + md(S.week) + '~)</b> 식단만 지워요. 다른 주 식단과 설정, 사용 기록은 그대로예요.'; } },
    plans: { title: '모든 식단 지우기', body: function () { return '저장된 식단 <b>' + Object.keys(S.plans).length + '주치</b>를 전부 지워요. 가게 설정, 추가한 메뉴, 사용 기록은 그대로예요. 다음 식단은 지난 식단 없이 처음부터 만들어요.'; } },
    all: { title: '처음 상태로 되돌리기', body: function () { return '<b>식단, 설정(가게 이름·밥·김치·끼니), 추가한 메뉴, 안 나오게 한 메뉴, 사용 기록</b>을 전부 지우고 처음 받았을 때로 돌아가요.'; } }
  };
  function openWipeSheet(scope) {
    if (scope === 'week' && !plan()) { toast(weekTitle(S.week) + '에는 지울 식단이 없어요.'); return; }
    if (scope === 'plans' && !Object.keys(S.plans).length) { toast('지울 식단이 없어요.'); return; }
    S.sheet = { type: 'wipe', scope: scope };
    $('sheet').innerHTML =
      '<div class="sheet-inner">' +
      sheetHead('지우기', WIPE[scope].title, '') +
      '<p class="help">' + WIPE[scope].body() + '</p>' +
      (scope === 'week' ? '' : '<p class="help warn">지우면 되돌릴 수 없어요. 혹시 모르니 백업을 받고 지우는 걸 권해요.</p>') +
      '<div class="inline wrap">' +
      (scope === 'week' ? '' : '<button type="button" class="btn primary" data-sheet="wipe-backup">백업 받고 지우기</button>') +
      '<button type="button" class="btn danger fill" data-sheet="wipe">' + (scope === 'week' ? '지우기' : '그냥 지우기') + '</button>' +
      '<button type="button" class="btn" data-sheet="close">취소</button></div>' +
      '</div>';
    showSheet();
  }
  function wipe(scope, withBackup) {
    if (withBackup) exportBackup();
    if (scope === 'week') {
      S.undo = { week: S.week, json: JSON.stringify(plan()) };
      delete S.plans[S.week];
      log('delete_week', { detail: { week: S.week } });
    } else if (scope === 'plans') {
      var n = Object.keys(S.plans).length;
      S.plans = {};
      S.undo = null;
      log('delete_plans', { detail: { weeks: n } });
    } else {
      S.plans = {};
      S.settings = normalizeSettings({});
      S.excluded = new Set();
      S.custom = [];
      S.logs = [];
      S.undo = null;
      applyFontSize();
    }
    persist();
    closeSheet();
    render();
    if (scope === 'week') toast('이번 주 식단을 지웠어요.', '되돌리기', function () {
      if (!S.undo) return;
      S.plans[S.undo.week] = normalizePlan(JSON.parse(S.undo.json));
      S.week = S.undo.week;
      S.undo = null;
      log('undo');
      persist();
      render();
      toast('되돌렸어요.');
    });
    else toast(scope === 'all' ? '처음 상태로 되돌렸어요.' : '모든 식단을 지웠어요.');
  }

  // ── 그리기 ──
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function applyFontSize() {
    document.documentElement.dataset.size = S.settings.fontSize || 'large';
    document.querySelectorAll('[data-act="font"]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.size === S.settings.fontSize));
    });
  }

  function render() {
    var p = plan();
    var saved = isSaved(p);
    $('store-display').textContent = S.settings.storeName || '';
    $('week-title').textContent = weekTitle(S.week);
    var dates = p ? p.days.map(function (e) { return e.date; }) : [S.week, addDays(S.week, 6)];
    $('week-range').textContent = md(dates[0]) + ' ~ ' + md(dates[dates.length - 1]);

    $('btn-generate').textContent = p ? '전체 다시 만들기' : '식단 만들기';
    $('btn-generate').classList.toggle('primary', !p);
    $('btn-save').disabled = !p;
    $('btn-save').classList.toggle('primary', !!p && !saved);
    $('btn-save').textContent = p && saved ? '저장됨 ✓' : '저장';
    $('btn-print').disabled = !saved;
    $('btn-image').disabled = !saved;
    $('btn-print').classList.toggle('primary', saved);
    $('step4-note').hidden = saved || !p;

    // 1→4 순서 표시
    var stage = !p ? 1 : !saved ? 3 : 4;
    [1, 2, 3, 4].forEach(function (n) {
      var el = $('step-' + n);
      el.classList.toggle('now', n === stage || (n === 2 && stage === 3));
      el.classList.toggle('done', n < stage && !(n === 2 && stage === 3));
    });

    if (!p) $('status').innerHTML = '';
    else if (saved) $('status').innerHTML = '<span class="pill done">저장됨</span>' + esc(fmtTime(p.savedAt)) + ' 저장 · 인쇄하거나 사진으로 저장할 수 있어요';
    else if (p.savedAt) $('status').innerHTML = '<span class="pill">고친 내용 있음</span>저장한 뒤에 바뀐 게 있어요. 다시 <b>저장</b>을 눌러야 인쇄할 수 있어요';
    else $('status').innerHTML = '<span class="pill">저장 안 됨</span>메뉴를 누르면 바꿀 수 있어요. 다 고치셨으면 <b>저장</b>을 눌러 주세요';

    renderWeek(p);
    renderIngredients(p);
    renderSettings();
    renderMenus();
    renderHistory();
    if (p) renderPrint(); else $('print-sheet').innerHTML = '';
    $('log-count').textContent = '사용 기록 ' + S.logs.length + '건 · 저장된 식단 ' + Object.keys(S.plans).length + '주치';
    if ($('set-share') !== document.activeElement) $('set-share').checked = S.settings.shareLogs !== false;
    renderSafety();
  }

  // 메뉴 이름 왼쪽에 붙는 작은 로고 (제철·일품·특식). 이름의 가운데 정렬을 해치지 않게 바깥에 걸린다.
  function marksHtml(e, k) {
    var marks = [];
    var cat = Engine.slotCat(k);
    if (cat === 'one') marks.push('<span class="mark one">일품</span>');
    if (cat === 'special') marks.push('<span class="mark special">특식</span>');
    var season = seasonOf(findMenu(e.items[k]), e.date);
    if (season === 'peak') marks.push('<span class="mark season">제철</span>');
    else if (season === 'off') marks.push('<span class="mark off">철 아님</span>');
    return marks.length ? '<span class="marks">' + marks.join('') + '</span>' : '';
  }
  function nameHtml(e, k, label) {
    var marks = marksHtml(e, k);
    var len = String(label).length;
    var cls = 'name' + (marks ? ' has-mark' : '') + (len >= 8 ? ' long2' : len >= 6 ? ' long' : '');
    return '<span class="' + cls + '">' + marks + esc(label) + '</span>';
  }

  function itemButton(p, e, i, k, r) {
    var cat = Engine.slotCat(k);
    var label = e.labels[k] || e.items[k];
    if (!label) return ''; // 국물 있는 일품 요리·특식 날의 국 칸
    var orig = originalOf(p, e);
    var changed = orig[k] !== undefined && orig[k] !== label;
    return '<li data-i="' + i + '" data-r="' + r + '">' + removeBtn(i, r, label) + '<button type="button" draggable="true" class="item cat-' + cat + (changed ? ' changed' : '') + '" data-act="edit" data-i="' + i + '" data-k="' + k + '" aria-label="' + CAT_LABEL[cat] + ' ' + esc(label) + ' 바꾸기">' +
      nameHtml(e, k, label) + '</button></li>';
  }
  // 마우스를 올리면 왼쪽에 나오는 빼기 버튼
  function removeBtn(i, r, label) {
    return '<button type="button" class="row-remove" data-act="remove-row" data-i="' + i + '" data-r="' + r + '" aria-label="' + esc(label) + ' 이 날만 빼기" title="이 날만 빼기">−</button>';
  }
  function fixedButton(e, i, r) {
    var row = e.rows[r];
    var what = row.src === 'rice' ? '매일 나오는 밥' : row.src === 'kimchi' ? '매일 나오는 김치' : '추가한 것';
    return '<li data-i="' + i + '" data-r="' + r + '">' + removeBtn(i, r, row.label) + '<button type="button" draggable="true" class="item fixed-item' + (row.src === 'extra' ? ' extra' : '') + '" data-act="fixed" data-i="' + i + '" data-r="' + r + '" aria-label="' + what + ' ' + esc(row.label) + ' 바꾸기">' +
      '<span class="name">' + esc(row.label) + '</span></button></li>';
  }
  // 한 끼니의 줄들 (일품 요리에 밥이 들어 있으면 밥 줄은 숨긴다)
  function visibleRows(e) {
    var dish = headDishOf(e);
    var hideRice = e.kind === 'one' && dish && dish.rice;
    var out = [];
    e.rows.forEach(function (row, r) {
      if (hideRice && row.src === 'rice') return;
      if (row.t === 'slot' && !(e.labels[row.key] || e.items[row.key])) return;
      out.push({ row: row, r: r });
    });
    return out;
  }

  function renderWeek(p) {
    var grid = $('week-grid');
    if (!p) {
      grid.innerHTML =
        '<div class="empty"><p><strong>' + esc(weekTitle(S.week)) + '</strong> 식단이 아직 없어요.</p>' +
        '<p>누르면 지난 식단과 겹치지 않게 한 주를 채워 드려요.</p>' +
        '<button type="button" class="btn primary" data-act="generate">식단 만들기</button></div>';
      return;
    }
    var multiMeal = S.settings.meals.length > 1 || p.days.some(function (e) { return e.meal !== 'lunch'; });
    var byDate = [];
    p.days.forEach(function (e, i) {
      var last = byDate[byDate.length - 1];
      if (!last || last.date !== e.date) byDate.push(last = { date: e.date, list: [] });
      last.list.push({ e: e, i: i });
    });
    grid.style.setProperty('--cols', byDate.length);
    // 식단을 새로 만들었을 때만: 요일 카드가 하나씩, 메뉴가 위에서부터 채워지는 효과
    grid.classList.remove('reveal');
    if (S.reveal) {
      S.reveal = false;
      void grid.offsetWidth;
      grid.classList.add('reveal');
      clearTimeout(renderWeek.revealTimer);
      renderWeek.revealTimer = setTimeout(function () { grid.classList.remove('reveal'); }, 2500);
    }
    var dayIdx = 0;
    grid.innerHTML = byDate.map(function (g) {
      var dow = parse(g.date).getDay();
      var off = g.list.every(function (x) { return x.e.off; });
      var head = '<header><div><span class="date">' + md(g.date) + '</span><span class="dow">' + DOW[dow] + '</span></div>' +
        '<button type="button" class="day-btn" data-act="day" data-date="' + g.date + '">바꾸기</button></header>';
      if (off) return '<article class="day off">' + head + '<p class="off-note">휴무</p></article>';
      var meals = g.list.map(function (x) {
        var e = x.e;
        ensureRows(p, e);
        var headLine = multiMeal ? '<p class="meal-head">' + MEAL_LABEL[e.meal] + '</p>' : '';
        var rows = visibleRows(e).map(function (v) {
          return v.row.t === 'slot' ? itemButton(p, e, x.i, v.row.key, v.r) : fixedButton(e, x.i, v.r);
        }).join('');
        var add = '<li class="add-row"><button type="button" class="add-btn" data-act="add-row" data-i="' + x.i + '">+ 추가</button></li>';
        return '<section class="meal">' + headLine + '<ul class="menu-list">' + rows + add + '</ul></section>';
      }).join('');
      var d = dayIdx++;
      var j = 0;
      meals = meals.replace(/<li /g, function () { return '<li style="--j:' + (j++) + '" '; });
      return '<article class="day' + (dow === 6 ? ' sat' : dow === 0 ? ' sun' : '') + '" style="--d:' + d + '">' + head + meals + '</article>';
    }).join('');
  }

  function ingredientUse(p) {
    var map = new Map();
    p.days.forEach(function (e) {
      if (e.off) return;
      Object.keys(e.items).forEach(function (k) {
        var m = findMenu(e.items[k]);
        if (!m) return;
        m.ing.forEach(function (g) {
          if (!map.has(g)) map.set(g, []);
          map.get(g).push(md(e.date) + '(' + dowOf(e.date) + ')' + (S.settings.meals.length > 1 ? ' ' + MEAL_LABEL[e.meal] : '') + ' ' + (e.labels[k] || m.name));
        });
      });
    });
    return Array.from(map.entries()).sort(function (a, b) { return b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko'); });
  }

  function renderIngredients(p) {
    var box = $('shop');
    if (!p) { box.hidden = true; return; }
    var list = ingredientUse(p);
    box.hidden = list.length === 0;
    $('ing-list').innerHTML = list.map(function (e) {
      return '<span class="chip">' + esc(e[0]) + (e[1].length > 1 ? ' <b>×' + e[1].length + '</b>' : '') + '</span>';
    }).join('');
  }

  function renderSettings() {
    var st = S.settings;
    var active = document.activeElement;
    function set(id, v) { var el = $(id); if (el !== active) el.value = v; }
    function options(id, from, to) {
      var el = $(id);
      if (el.options.length) return;
      for (var n = from; n <= to; n++) el.add(new Option(String(n), String(n)));
    }
    options('set-soup', 0, 3);
    options('set-main', 1, 4);
    options('set-side', 1, 8);
    set('set-store', st.storeName);
    set('set-soup', st.layout.soup);
    set('set-main', st.layout.main);
    set('set-side', st.layout.side);
    set('set-origin', st.origin);
    set('dial-efficiency', st.dials.efficiency);
    set('dial-budget', st.dials.budget);
    set('dial-repeat', st.dials.repeat);
    function chipList(kind) {
      return st[kind].length
        ? st[kind].map(function (x, i) { return '<button type="button" class="chip" data-act="remove-fixed" data-kind="' + kind + '" data-idx="' + i + '">' + esc(x) + ' ✕</button>'; }).join('')
        : '<span class="note">없음</span>';
    }
    $('rice-list').innerHTML = chipList('rices');
    $('kimchi-list').innerHTML = chipList('kimchis');
    function checks(list, prefix, values, labelOf) {
      return list.map(function (v) {
        return '<label><input type="checkbox" id="' + prefix + v + '" value="' + v + '"' + (values.indexOf(v) >= 0 ? ' checked' : '') + '> ' + labelOf(v) + '</label>';
      }).join('');
    }
    $('set-style').innerHTML = [['field', '현장식당·백반', '한식 위주. 스파게티·마라탕 같은 퓨전·양식은 추천 안 해요'], ['cafeteria', '구내식당·한식뷔페', '퓨전·양식도 가끔 섞어서 추천해요']].map(function (o) {
      return '<label class="style-opt"><input type="radio" name="set-style" id="st-' + o[0] + '" value="' + o[0] + '"' + (st.style === o[0] ? ' checked' : '') + '> <span><b>' + o[1] + '</b><small>' + o[2] + '</small></span></label>';
    }).join('');
    $('set-meals').innerHTML = checks(MEALS.map(function (m) { return m.id; }), 'ml-', st.meals, function (v) { return MEAL_LABEL[v]; });
    var order = [1, 2, 3, 4, 5, 6, 0];
    $('set-days').innerHTML = checks(order, 'wd-', st.weekdays, function (v) { return DOW[v]; });
    $('set-one-days').innerHTML = checks(order.filter(function (n) { return st.weekdays.indexOf(n) >= 0; }), 'od-', st.oneDays, function (v) { return DOW[v]; });
  }

  function renderMenus() {
    var ex = Array.from(S.excluded);
    $('excluded-list').innerHTML = ex.length
      ? ex.map(function (n) { return '<button type="button" class="chip" data-act="unexclude" data-name="' + esc(n) + '">' + esc(n) + ' ✕</button>'; }).join('')
      : '<span class="note">없음</span>';
    $('custom-list').innerHTML = S.custom.map(function (m) {
      return '<button type="button" class="chip" data-act="remove-custom" data-name="' + esc(m.name) + '" title="눌러서 삭제">' +
        esc(m.name) + ' · ' + CAT_LABEL[m.cat] + ' ✕</button>';
    }).join('');
  }

  function renderHistory() {
    var weeks = Object.keys(S.plans).sort().reverse();
    $('history-list').innerHTML = weeks.length
      ? weeks.map(function (w) {
          return '<li><button type="button" data-act="goto" data-week="' + w + '"><span>' + weekTitle(w) + ' (' + md(w) + '~)</span>' +
            '<span class="h-meta">' + (isSaved(S.plans[w]) ? '저장됨' : '저장 안 됨') + '</span></button></li>';
        }).join('')
      : '<li class="h-empty">아직 없어요.</li>';
  }

  // ── 바꾸기 창 (메뉴 한 칸 / 날짜) ──
  function showSheet() {
    var dlg = $('sheet');
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
  }
  function closeSheet() {
    var dlg = $('sheet');
    var prev = S.sheet;
    if (dlg.open) dlg.close();
    S.sheet = null;
    releaseFocus();
    backToWelcome(prev);
  }
  // 처음 안내에서 백업 불러오기를 골랐다가 취소하면 다시 처음 안내로
  function backToWelcome(prev) {
    if (prev && prev.type === 'restore' && prev.fromWelcome && !Object.keys(S.plans).length) {
      S.settings.welcomed = false;
      setTimeout(openWelcome, 0);
    }
  }
  // 창을 닫으면 브라우저가 초점을 누른 메뉴로 돌려놓는데, 그러면 − 버튼이 계속 보인다. 마우스로 연 경우엔 초점을 푼다.
  var usingKeyboard = false; // 마지막 조작이 키보드(Tab 등)였는지
  document.addEventListener('keydown', function (e) { if (e.key === 'Tab') usingKeyboard = true; }, true);
  document.addEventListener('pointerdown', function () { usingKeyboard = false; }, true);
  function releaseFocus() {
    setTimeout(function () {
      var el = document.activeElement;
      if (!usingKeyboard && el && el.closest && el.closest('#week-grid')) el.blur();
    }, 0);
  }
  function sheetHead(eyebrow, title, meta) {
    return '<div class="sheet-head"><div><p class="eyebrow">' + eyebrow + '</p><h3 id="sheet-title">' + esc(title) + '</h3>' +
      (meta ? '<p class="meta">' + meta + '</p>' : '') + '</div>' +
      '<button type="button" class="icon-btn" data-sheet="close" aria-label="닫기">×</button></div>';
  }

  function openMenuSheet(i, k) {
    S.sheet = { type: 'menu', i: i, k: k, reason: null, page: 0, pool: null };
    renderMenuSheet();
    showSheet();
  }

  function candButton(r) {
    var m = r.menu;
    var hint = (r.showCat ? '<b>' + CAT_LABEL[m.cat] + '</b> · ' : '') + esc(m.ing.join(', ') + (m.method ? ' · ' + m.method : ''));
    if (r.akaHit) hint += ' · "' + esc(r.akaHit) + '"(으)로 찾음';
    if (r.shared && r.shared.length) hint += ' · <em>' + esc(r.shared.join(', ')) + ' 같이 씀</em>';
    var season = S.sheet ? seasonOf(m, plan().days[S.sheet.i].date) : '';
    if (season === 'peak') hint += ' · <em>제철</em>';
    else if (season === 'off') hint += ' · <span class="warn">철 아님 (' + monthsLabel(m.only) + ')</span>';
    return '<li><button type="button" class="cand" data-pick="' + esc(m.name) + '"><span class="c-name">' + esc(m.name) + '</span>' +
      '<span class="c-hint">' + hint + '</span></button></li>';
  }

  function renderMenuSheet() {
    var sh = S.sheet;
    var e = plan().days[sh.i];
    var name = e.items[sh.k];
    var label = e.labels[sh.k] || name;
    var m = findMenu(name);
    var cat = Engine.slotCat(sh.k);
    if (!sh.pool) sh.pool = suggestions(sh.i, sh.k, 25);
    $('sheet').innerHTML =
      '<div class="sheet-inner">' +
      sheetHead(md(e.date) + ' (' + dowOf(e.date) + ') ' + MEAL_LABEL[e.meal] + ' · ' + CAT_LABEL[cat], label,
        m ? esc(m.ing.join(', ')) + (m.method ? ' · ' + esc(m.method) : '') : '') +
      '<div><h4>바꾸는 이유 <span>(골라 주시면 식단 개선에 써요)</span></h4><div class="reasons">' +
      REASONS.map(function (r) {
        return '<button type="button" class="reason" data-reason="' + esc(r) + '" aria-pressed="' + (sh.reason === r) + '">' + esc(r) + '</button>';
      }).join('') + '</div></div>' +
      '<div><div class="cands-head"><h4>추천 메뉴 <span>(눌러서 바꾸기)</span></h4>' +
      (sh.pool.length > 5 ? '<button type="button" class="btn small" data-sheet="more">↻ 다른 추천 보기</button>' : '') + '</div>' +
      '<ul class="cands" id="sheet-cands">' + candPage(sh) + '</ul>' +
      (sh.pool.length > 5 ? '<p class="help cands-page" id="sheet-page">' + pageLabel(sh) + '</p>' : '') + '</div>' +
      '<div><h4>메뉴 찾기</h4><input type="text" id="sheet-search" placeholder="예: 고등어, 볶음" autocomplete="off">' +
      '<ul class="cands" id="sheet-results" style="margin-top:0.5rem"></ul></div>' +
      '<div><h4>이름만 바꾸기 <span>(예: 계란말이 → 치즈계란말이)</span></h4>' +
      '<div class="inline"><input type="text" id="sheet-rename" value="' + esc(label) + '" maxlength="30"><button type="button" class="btn" data-sheet="rename">바꾸기</button></div></div>' +
      orderButtons(sh.i, rowIndexOf(e, sh.k)) +
      '<button type="button" class="btn danger wide-btn" data-sheet="slot-remove">' + esc(label) + ' 이 날만 빼기</button>' +
      '<button type="button" class="link-danger" data-sheet="exclude">' + esc(name) + ' 다시 안 나오게 하기</button>' +
      '</div>';
  }
  function rowIndexOf(e, k) {
    for (var r = 0; r < e.rows.length; r++) if (e.rows[r].t === 'slot' && e.rows[r].key === k) return r;
    return -1;
  }
  // 위로·아래로: 끌기가 어려울 때 쓰는 버튼
  function orderButtons(i, r) {
    var e = plan().days[i];
    var vis = visibleRows(e).map(function (v) { return v.r; });
    var pos = vis.indexOf(r);
    return '<div><h4>순서 <span>(식단표에서 끌어서 옮겨도 돼요)</span></h4><div class="inline">' +
      '<button type="button" class="btn" data-sheet="up" data-r="' + r + '"' + (pos <= 0 ? ' disabled' : '') + '>▲ 위로</button>' +
      '<button type="button" class="btn" data-sheet="down" data-r="' + r + '"' + (pos < 0 || pos >= vis.length - 1 ? ' disabled' : '') + '>▼ 아래로</button></div></div>';
  }
  // 보이는 줄 기준으로 한 칸 위·아래로
  function stepRow(i, r, dir) {
    var e = plan().days[i];
    var vis = visibleRows(e).map(function (v) { return v.r; });
    var pos = vis.indexOf(r);
    var target = vis[pos + dir];
    if (target === undefined) return;
    if (moveRow(i, r, target)) {
      var newR = target;
      if (S.sheet && S.sheet.type === 'fixed') { S.sheet.r = newR; renderFixedSheet(); }
      else if (S.sheet && S.sheet.type === 'menu') renderMenuSheet();
    }
  }

  function openFixedSheet(i, r) {
    S.sheet = { type: 'fixed', i: i, r: r };
    renderFixedSheet();
    showSheet();
  }
  function renderFixedSheet() {
    var sh = S.sheet;
    var e = plan().days[sh.i];
    var row = e.rows[sh.r];
    var what = row.src === 'rice' ? '매일 나오는 밥' : row.src === 'kimchi' ? '매일 나오는 김치' : '이 날만 추가한 것';
    $('sheet').innerHTML =
      '<div class="sheet-inner">' +
      sheetHead(md(e.date) + ' (' + dowOf(e.date) + ') ' + MEAL_LABEL[e.meal] + ' · ' + what, row.label, '') +
      '<div><h4>이름 바꾸기 <span>(이 끼니에만)</span></h4>' +
      '<div class="inline"><input type="text" id="fixed-rename" value="' + esc(row.label) + '" maxlength="30"><button type="button" class="btn" data-sheet="fixed-rename">바꾸기</button></div></div>' +
      orderButtons(sh.i, sh.r) +
      '<button type="button" class="btn danger wide-btn" data-sheet="fixed-remove">' + (row.src === 'extra' ? '빼기' : '이 날만 빼기') + '</button>' +
      (row.src === 'extra' ? '' : '<p class="help">매일 나오는 밥·김치 목록 자체는 <b>식단 설정</b>에서 바꿔요. 여기서 바꾸면 이 끼니에만 적용돼요.</p>') +
      '</div>';
  }

  var EXTRA_SUGGEST = ['누룽지', '요구르트', '과일', '식혜', '숭늉', '두유'];
  var ADD_KINDS = [['side', '반찬'], ['soup', '국'], ['main', '메인']];
  function openAddRowSheet(i) {
    S.sheet = { type: 'add', i: i, cat: 'side', reason: null, page: 0, pool: null };
    renderAddSheet();
    showSheet();
  }
  function renderAddSheet() {
    var sh = S.sheet;
    var e = plan().days[sh.i];
    if (!sh.pool) sh.pool = extraSuggestions(sh.i, sh.cat);
    $('sheet').innerHTML =
      '<div class="sheet-inner">' +
      sheetHead(md(e.date) + ' (' + dowOf(e.date) + ') ' + MEAL_LABEL[e.meal], '이 끼니에 추가', '이 날만 들어가요. 다른 메뉴처럼 겹침·재료 계산에 들어가요.') +
      '<div><h4>무엇을 추가할까요?</h4><div class="seg">' +
      ADD_KINDS.map(function (k) { return '<button type="button" data-sheet="add-kind" data-cat="' + k[0] + '" aria-pressed="' + (sh.cat === k[0]) + '">' + k[1] + '</button>'; }).join('') +
      '</div></div>' +
      '<div><div class="cands-head"><h4>추천 ' + CAT_LABEL[sh.cat] + ' <span>(눌러서 추가)</span></h4>' +
      (sh.pool.length > 5 ? '<button type="button" class="btn small" data-sheet="more">↻ 다른 추천 보기</button>' : '') + '</div>' +
      '<ul class="cands" id="sheet-cands">' + candPage(sh) + '</ul>' +
      (sh.pool.length > 5 ? '<p class="help cands-page" id="sheet-page">' + pageLabel(sh) + '</p>' : '') + '</div>' +
      '<div><h4>메뉴 찾기</h4><input type="text" id="sheet-search" placeholder="예: 고등어, 전" autocomplete="off">' +
      '<ul class="cands" id="sheet-results" style="margin-top:0.5rem"></ul></div>' +
      '<div><h4>메뉴 말고 간단히 적기 <span>(요구르트, 과일 등)</span></h4>' +
      '<div class="inline"><input type="text" id="add-row-input" maxlength="30" placeholder="예: 요구르트"><button type="button" class="btn" data-sheet="add-row">적기</button></div>' +
      '<div class="reasons" style="margin-top:0.5rem">' +
      EXTRA_SUGGEST.map(function (x) { return '<button type="button" class="reason" data-sheet="add-quick" data-label="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') +
      '</div></div>' +
      '</div>';
  }


  function candPage(sh) {
    return sh.pool.slice(sh.page * 5, sh.page * 5 + 5).map(candButton).join('');
  }
  function pageLabel(sh) {
    var pages = Math.ceil(sh.pool.length / 5);
    return (sh.page + 1) + ' / ' + pages + (sh.page === 0 ? ' · 앞쪽일수록 잘 어울리는 메뉴예요' : '');
  }
  function moreSuggestions() {
    var sh = S.sheet;
    var pages = Math.ceil(sh.pool.length / 5);
    sh.page = (sh.page + 1) % pages;
    $('sheet-cands').innerHTML = candPage(sh);
    $('sheet-page').textContent = pageLabel(sh);
    log('suggest_more', { date: plan().days[sh.i].date, slot: sh.k || 'add:' + sh.cat, detail: { page: sh.page } });
  }

  function renderSearch(q) {
    var sh = S.sheet;
    var box = $('sheet-results');
    q = q.trim();
    if (!q) { box.innerHTML = ''; return; }
    // 종류(국·메인·반찬 등)와 상관없이 전부 찾는다. 이 칸과 같은 종류가 먼저 나온다.
    var cat = sh.k ? Engine.slotCat(sh.k) : sh.cat;
    function sameKind(m) { return m.cat === cat || (cat === 'special' && m.cat === 'main' && m.special); }
    // 띄어쓰기는 무시하고, 이름·다른 이름·주재료·조리법으로 찾는다 (올방개묵 = 검은깨묵 = 깻묵)
    q = q.replace(/\s+/g, '');
    var hits = allMenus().filter(function (m) {
      if (S.excluded.has(m.name)) return false;
      if (m.name.indexOf(q) >= 0 || m.ing.join(',').indexOf(q) >= 0 || m.method === q) return true;
      return (m.aka || []).some(function (a) { return a.indexOf(q) >= 0; });
    }).sort(function (a, b) {
      return (sameKind(b) ? 1 : 0) - (sameKind(a) ? 1 : 0) || (a.name.indexOf(q) === 0 ? -1 : 0) - (b.name.indexOf(q) === 0 ? -1 : 0);
    });
    var total = hits.length;
    hits = hits.slice(0, 12);
    box.innerHTML = total
      ? '<li class="found">찾은 메뉴 ' + total + '개' + (total > 12 ? ' (12개까지 보여요. 더 자세히 쳐 보세요)' : '') + ' ↓</li>' +
        hits.map(function (m) {
          var akaHit = m.name.indexOf(q) < 0 ? (m.aka || []).filter(function (x) { return x.indexOf(q) >= 0; })[0] : null;
          return candButton({ menu: m, showCat: true, akaHit: akaHit });
        }).join('')
      : '<li class="note">찾는 메뉴가 없어요. ' + (sh.type === 'add' ? '아래 "간단히 적기"로 넣을 수 있어요.' : '이름만 바꾸기로 직접 적거나, 메뉴 관리에서 추가해 주세요.') + '</li>';
  }
  // 찾기 칸을 처음 누를 때 한 번만 창을 내린다. 찾기 칸 위로 앞 내용이 조금 보이게 멈춰서
  // "위아래로 움직이는 창"인 걸 알 수 있게. 타이핑하는 동안에는 창을 움직이지 않는다.
  function scrollToSearchOnce() {
    var sh = S.sheet;
    var dlg = $('sheet');
    var input = $('sheet-search');
    if (!sh || sh.searchScrolled || !dlg || !input) return;
    sh.searchScrolled = true;
    // 결과 자리를 미리 잡아 둔다: 결과가 줄어도 창 길이가 줄지 않아 화면이 당겨지지 않는다
    $('sheet-results').classList.add('reserve');
    var top = input.getBoundingClientRect().top - dlg.getBoundingClientRect().top + dlg.scrollTop - 110;
    top = Math.max(0, Math.min(top, dlg.scrollHeight - dlg.clientHeight));
    if (top > dlg.scrollTop + 4) smoothScroll(dlg, top);
  }
  // 브라우저의 scrollTo({ behavior: 'smooth' }) 가 창(dialog) 안에서 안 먹는 경우가 있어 직접 움직인다
  var scrollAnim = null;
  function smoothScroll(el, to) {
    if (scrollAnim && scrollAnim.to === to) return; // 이미 같은 곳으로 가는 중
    var from = el.scrollTop;
    var start = null;
    var dur = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350;
    var anim = scrollAnim = { to: to };
    function step(ts) {
      if (scrollAnim !== anim) return;
      if (start === null) start = ts;
      var t = dur ? Math.min(1, (ts - start) / dur) : 1;
      var ease = 1 - Math.pow(1 - t, 3);
      el.scrollTop = from + (to - from) * ease;
      if (t < 1) requestAnimationFrame(step); else scrollAnim = null;
    }
    requestAnimationFrame(step);
    // 화면이 멈춰 있어도(탭이 뒤에 있는 등) 결국 그 자리로 가게
    setTimeout(function () { if (scrollAnim === anim) { el.scrollTop = to; scrollAnim = null; } }, dur + 150);
  }

  // 날짜 바꾸기 창: 끼니별 다시 만들기·보통/일품/특식, 날짜 휴무
  function openDaySheet(date) {
    S.sheet = { type: 'day', date: date };
    var p = plan();
    var list = [];
    p.days.forEach(function (e, i) { if (e.date === date) list.push({ e: e, i: i }); });
    var off = list.every(function (x) { return x.e.off; });
    var body = off ? '<p class="help">이 날은 휴무예요.</p>' : list.map(function (x) {
      var e = x.e;
      function seg(kind, title, small) {
        return '<button type="button" data-sheet="kind" data-i="' + x.i + '" data-kind="' + kind + '" aria-pressed="' + (e.kind === kind) + '">' +
          title + '<small>' + small + '</small></button>';
      }
      return '<div class="day-sheet-meal"><h4>' + MEAL_LABEL[e.meal] + '</h4>' +
        '<div class="seg">' + seg('normal', '보통', '밥·국·메인·반찬') + seg('one', '일품 요리', '카레·국수·덮밥') + seg('special', '특식', '삼계탕·갈비찜') + '</div>' +
        '<button type="button" class="btn wide-btn" data-sheet="reroll" data-i="' + x.i + '">' + MEAL_LABEL[e.meal] + ' 메뉴 새로 만들기</button></div>';
    }).join('');
    $('sheet').innerHTML =
      '<div class="sheet-inner">' +
      sheetHead('날짜 바꾸기', md(date) + ' (' + dowOf(date) + ')', '') +
      body +
      '<button type="button" class="btn wide-btn" data-sheet="off">' + (off ? '영업일로 되돌리기' : '이 날 휴무로 하기') + '</button>' +
      '<p class="help"><b>일품 요리</b>: 밥·메인 대신 한 그릇 요리. <b>특식</b>: 복날·명절처럼 평소보다 좋은 메뉴 (예산 제한 없음).</p>' +
      '</div>';
    showSheet();
  }

  function openRestoreSheet(data, filename) {
    S.sheet = { type: 'restore', data: data, fromWelcome: !Object.keys(S.plans).length };
    var weeks = Object.keys(data.plans || {}).length;
    $('sheet').innerHTML =
      '<div class="sheet-inner">' +
      sheetHead('백업 불러오기', filename, '식단 ' + weeks + '주치' + (data.exported_at ? ' · ' + esc(fmtTime(data.exported_at)) + ' 백업' : '')) +
      '<p class="help">불러오면 지금 이 컴퓨터의 식단·설정·사용 기록이 <b>백업 파일 내용으로 바뀌어요</b>. 지금 내용을 남기고 싶으면 먼저 <b>백업 파일 받기</b>를 눌러 두세요.</p>' +
      '<div class="inline wrap"><button type="button" class="btn primary" data-sheet="restore">불러오기</button>' +
      '<button type="button" class="btn" data-sheet="close">취소</button></div>' +
      '</div>';
    showSheet();
  }

  // ── 인쇄용 식단표 (화면과 같은 카드 모양. 사진 저장도 이걸 찍는다) ──
  function renderPrint() {
    var p = plan();
    var st = S.settings;
    var byDate = [];
    p.days.forEach(function (e) {
      var last = byDate[byDate.length - 1];
      if (!last || last.date !== e.date) byDate.push(last = { date: e.date, list: [] });
      last.list.push(e);
    });
    var multiMeal = byDate.some(function (g) { return g.list.length > 1; }) || p.days.some(function (e) { return e.meal !== 'lunch'; });
    function longDate(s) { var d = parse(s); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + DOW[d.getDay()] + ')'; }
    function li(text, cls) { return '<li' + (cls ? ' class="' + cls + '"' : '') + '>' + text + '</li>'; }
    var lines = 0;

    var cards = byDate.map(function (g) {
      var d = parse(g.date);
      var dow = d.getDay();
      var head = '<h2 class="ps-date' + (dow === 6 ? ' sat' : dow === 0 ? ' sun' : '') + '">' + d.getDate() + '일 <small>' + DOW[dow] + '</small></h2>';
      if (g.list.every(function (e) { return e.off; })) return '<section class="ps-day off">' + head + '<p class="ps-off">휴무</p></section>';
      var meals = g.list.map(function (e) {
        ensureRows(p, e);
        var items = visibleRows(e).map(function (v) {
          if (v.row.t !== 'slot') return li(esc(v.row.label), 'fixed');
          var k = v.row.key;
          var cat = Engine.slotCat(k);
          return li(nameHtml(e, k, e.labels[k] || e.items[k]), cat === 'side' || cat === 'soup' ? '' : 'main');
        });
        lines = Math.max(lines, items.length * g.list.length);
        return '<div class="ps-meal">' + (multiMeal ? '<p class="ps-meal-head">' + MEAL_LABEL[e.meal] + '</p>' : '') + '<ul>' + items.join('') + '</ul></div>';
      }).join('');
      return '<section class="ps-day">' + head + meals + '</section>';
    }).join('');

    // 줄이 많으면(세 끼 등) 한 장에 들어가게 글씨를 줄인다
    var density = lines > 24 ? ' dense2' : lines > 14 ? ' dense' : lines <= 10 ? ' roomy' : '';
    $('print-sheet').innerHTML =
      '<div class="ps-head"><h1>' + esc(st.storeName || '') + ' 주간 식단표</h1><p>' + weekTitle(S.week) + ' · ' + longDate(byDate[0].date) + ' ~ ' + longDate(byDate[byDate.length - 1].date) + '</p></div>' +
      '<div class="ps-grid' + density + '" style="--cols:' + byDate.length + '">' + cards + '</div>' +
      '<div class="ps-foot">' + (st.origin ? '<p>원산지: ' + esc(st.origin) + '</p>' : '') +
      '<p>※ 식단은 식자재 사정에 따라 변경될 수 있습니다.</p></div>';
  }

  // ── 장보기 목록 ──
  function renderShopSheet() {
    var p = plan();
    var list = ingredientUse(p);
    var dates = p.days.map(function (e) { return e.date; });
    $('shop-sheet').innerHTML =
      '<div class="ps-head"><h1>장보기 목록</h1><p>' + esc(S.settings.storeName || '') + ' · ' + weekTitle(S.week) + ' · ' + md(dates[0]) + ' ~ ' + md(dates[dates.length - 1]) + '</p></div>' +
      '<table class="shop-table"><thead><tr><th>✓</th><th>주재료</th><th>메뉴 수</th><th>쓰는 날·메뉴</th></tr></thead><tbody>' +
      list.map(function (e) {
        return '<tr><td class="check"></td><td><b>' + esc(e[0]) + '</b></td><td class="num">' + e[1].length + '</td><td>' + esc(e[1].join(', ')) + '</td></tr>';
      }).join('') +
      '</tbody></table>' +
      '<div class="ps-foot"><p>※ 매일 나오는 밥·김치와 양념(파·마늘·양파 등)은 빠져 있어요. 양은 인원에 맞춰 정해 주세요.</p></div>';
  }

  // ── 알림 ──
  var toastTimer = null;
  function toast(msg, actionLabel, action) {
    var el = $('toast');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button type="button">' + esc(actionLabel) + '</button>' : '');
    el.hidden = false;
    if (actionLabel) el.querySelector('button').onclick = function () { el.hidden = true; action(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, actionLabel ? 7000 : 4500);
  }

  // 매일 나오는 밥·김치 추가
  function addFixed(kind, inputId) {
    var input = $(inputId);
    var name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (S.settings[kind].indexOf(name) >= 0) { toast('이미 있어요: ' + name); return; }
    S.settings[kind].push(name);
    input.value = '';
    applyFixedDefaults();
    log('settings', { detail: { field: kind, added: name, value: S.settings[kind] } });
    persist();
    render();
    $(inputId).focus();
  }

  // 엔터로 입력 처리. 한글은 마지막 글자가 '조합 중'일 때 엔터가 먼저 오므로,
  // 조합이 끝난 뒤에 처리해야 "보리밥" + "밥" 처럼 두 번 들어가지 않는다.
  function enterHandler(e, fn) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var el = e.target;
    if (e.isComposing || e.keyCode === 229) {
      el.addEventListener('compositionend', function () { setTimeout(fn, 0); }, { once: true });
      return;
    }
    fn();
  }
  function onEnter(el, fn) {
    el.addEventListener('keydown', function (e) { enterHandler(e, fn); });
  }

  // ── 이벤트 연결 ──
  $('prev-week').onclick = function () { S.week = addDays(S.week, -7); render(); };
  $('next-week').onclick = function () { S.week = addDays(S.week, 7); render(); };
  $('btn-generate').onclick = generateWeek;
  $('btn-save').onclick = savePlan;
  $('btn-print').onclick = printPlan;
  $('btn-image').onclick = saveImage;
  $('btn-shop').onclick = printShop;
  $('btn-export').onclick = exportBackup;
  $('set-share').addEventListener('change', function (e) {
    S.settings.shareLogs = e.target.checked;
    if (!e.target.checked) { outbox = []; save(KEY.outbox, outbox); }
    persist();
    toast(e.target.checked ? '사용 기록을 보내요. 고마워요!' : '이제 사용 기록을 보내지 않아요.');
  });
  $('import-file').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) readBackup(file);
    e.target.value = '';
  });

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t || t.closest('#sheet')) return;
    var act = t.dataset.act;
    if (act === 'generate') generateWeek();
    else if (act === 'edit') openMenuSheet(Number(t.dataset.i), t.dataset.k);
    else if (act === 'day') openDaySheet(t.dataset.date);
    else if (act === 'wipe') openWipeSheet(t.dataset.scope);
    else if (act === 'safety') openSafety(Number(t.dataset.idx));
    else if (act === 'fixed') openFixedSheet(Number(t.dataset.i), Number(t.dataset.r));
    else if (act === 'add-row') openAddRowSheet(Number(t.dataset.i));
    else if (act === 'remove-row') removeRow(Number(t.dataset.i), Number(t.dataset.r));
    else if (act === 'font') {
      S.settings.fontSize = t.dataset.size;
      log('settings', { detail: { field: 'fontSize', value: t.dataset.size } });
      persist();
      applyFontSize();
    } else if (act === 'add-fixed') addFixed(t.dataset.kind, t.dataset.input);
    else if (act === 'remove-fixed') {
      var removed = S.settings[t.dataset.kind].splice(Number(t.dataset.idx), 1)[0];
      applyFixedDefaults();
      log('settings', { detail: { field: t.dataset.kind, removed: removed, value: S.settings[t.dataset.kind] } });
      persist(); render();
    } else if (act === 'goto') { S.week = t.dataset.week; render(); window.scrollTo({ top: 0 }); }
    else if (act === 'unexclude') {
      S.excluded.delete(t.dataset.name);
      log('unexclude', { before: t.dataset.name });
      persist(); render();
    } else if (act === 'remove-custom') {
      S.custom = S.custom.filter(function (m) { return m.name !== t.dataset.name; });
      log('remove_menu', { before: t.dataset.name });
      persist(); render();
    }
  });

  var drag = null;
  var weekGrid = $('week-grid');
  function clearDrop() {
    weekGrid.querySelectorAll('.drop-before, .drop-after, .dragging').forEach(function (el) { el.classList.remove('drop-before', 'drop-after', 'dragging'); });
  }
  weekGrid.addEventListener('dragstart', function (ev) {
    var li = ev.target.closest('li[data-r]');
    if (!li) return;
    drag = { i: Number(li.dataset.i), r: Number(li.dataset.r) };
    li.classList.add('dragging');
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', ''); } catch (err) { /* 일부 브라우저 */ }
  });
  weekGrid.addEventListener('dragover', function (ev) {
    if (!drag) return;
    var li = ev.target.closest('li[data-r]');
    if (!li || Number(li.dataset.i) !== drag.i) return; // 같은 끼니 안에서만
    ev.preventDefault();
    var box = li.getBoundingClientRect();
    var after = ev.clientY > box.top + box.height / 2;
    weekGrid.querySelectorAll('.drop-before, .drop-after').forEach(function (el) { el.classList.remove('drop-before', 'drop-after'); });
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  weekGrid.addEventListener('drop', function (ev) {
    if (!drag) return;
    var li = ev.target.closest('li[data-r]');
    if (!li || Number(li.dataset.i) !== drag.i) { clearDrop(); drag = null; return; }
    ev.preventDefault();
    var target = Number(li.dataset.r);
    var after = li.classList.contains('drop-after');
    var to = target + (after ? 1 : 0);
    if (to > drag.r) to -= 1; // 빼고 나면 한 칸 당겨진다
    var from = drag.r, i = drag.i;
    drag = null;
    clearDrop();
    if (moveRow(i, from, to)) toast('순서를 바꿨어요.', '되돌리기', undo);
  });
  weekGrid.addEventListener('dragend', function () { drag = null; clearDrop(); });

  var sheet = $('sheet');
  sheet.addEventListener('click', function (e) {
    if (e.target === sheet) { if (!S.sheet || S.sheet.type !== 'welcome') closeSheet(); return; } // 바깥 누르면 닫기 (처음 안내는 제외)
    var sh = S.sheet;
    if (!sh) return;
    var a = e.target.closest('[data-sheet]');
    if (a && a.dataset.sheet === 'close') { closeSheet(); return; }
    if (sh.type === 'menu') {
      var pick = e.target.closest('[data-pick]');
      if (pick) { replace(sh.i, sh.k, pick.dataset.pick, sh.reason); return; }
      var r = e.target.closest('[data-reason]');
      if (r) {
        sh.reason = sh.reason === r.dataset.reason ? null : r.dataset.reason;
        sheet.querySelectorAll('.reason').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.reason === sh.reason)); });
        return;
      }
      if (!a) return;
      if (a.dataset.sheet === 'more') moreSuggestions();
      else if (a.dataset.sheet === 'up') stepRow(sh.i, Number(a.dataset.r), -1);
      else if (a.dataset.sheet === 'down') stepRow(sh.i, Number(a.dataset.r), 1);
      else if (a.dataset.sheet === 'slot-remove') removeSlot(sh.i, sh.k);
      else if (a.dataset.sheet === 'rename') rename(sh.i, sh.k, $('sheet-rename').value);
      else if (a.dataset.sheet === 'exclude') excludeAndReplace(sh.i, sh.k);
    } else if (sh.type === 'day' && a) {
      if (a.dataset.sheet === 'kind') setKind(Number(a.dataset.i), a.dataset.kind);
      else if (a.dataset.sheet === 'reroll') rerollEntry(Number(a.dataset.i));
      else if (a.dataset.sheet === 'off') toggleOffDate(sh.date);
    } else if (sh.type === 'fixed' && a) {
      if (a.dataset.sheet === 'fixed-rename') renameFixedRow(sh.i, sh.r, $('fixed-rename').value);
      else if (a.dataset.sheet === 'fixed-remove') removeFixedRow(sh.i, sh.r);
      else if (a.dataset.sheet === 'up') stepRow(sh.i, sh.r, -1);
      else if (a.dataset.sheet === 'down') stepRow(sh.i, sh.r, 1);
    } else if (sh.type === 'add') {
      var pickAdd = e.target.closest('[data-pick]');
      if (pickAdd) { addExtraMenu(sh.i, sh.cat, pickAdd.dataset.pick); return; }
      if (!a) return;
      if (a.dataset.sheet === 'add-kind') { sh.cat = a.dataset.cat; sh.pool = null; sh.page = 0; sh.searchScrolled = false; renderAddSheet(); }
      else if (a.dataset.sheet === 'more') moreSuggestions();
      else if (a.dataset.sheet === 'add-row') addExtraRow(sh.i, $('add-row-input').value);
      else if (a.dataset.sheet === 'add-quick') addExtraRow(sh.i, a.dataset.label);
    } else if (sh.type === 'wipe' && a && (a.dataset.sheet === 'wipe' || a.dataset.sheet === 'wipe-backup')) {
      wipe(sh.scope, a.dataset.sheet === 'wipe-backup');
    } else if (sh.type === 'restore' && a && a.dataset.sheet === 'restore') {
      restoreBackup(sh.data);
    }
  });
  sheet.addEventListener('input', function (e) {
    if (e.target.id === 'sheet-search') renderSearch(e.target.value);
  });
  sheet.addEventListener('focusin', function (e) {
    if (e.target.id === 'sheet-search') scrollToSearchOnce();
  });
  sheet.addEventListener('keydown', function (e) {
    if (e.target.id === 'fixed-rename') { enterHandler(e, function () { if (S.sheet) renameFixedRow(S.sheet.i, S.sheet.r, $('fixed-rename').value); }); return; }
    if (e.target.id === 'add-row-input') { enterHandler(e, function () { if (S.sheet) addExtraRow(S.sheet.i, $('add-row-input').value); }); return; }
    if (e.target.id !== 'sheet-rename') return;
    enterHandler(e, function () { if (S.sheet && S.sheet.type === 'menu') rename(S.sheet.i, S.sheet.k, $('sheet-rename').value); });
  });
  sheet.addEventListener('cancel', function (e) { if (S.sheet && S.sheet.type === 'welcome') e.preventDefault(); }); // Esc로 처음 안내 닫기 막기
  sheet.addEventListener('close', function () { var prev = S.sheet; S.sheet = null; releaseFocus(); backToWelcome(prev); });

  $('settings-form').addEventListener('submit', function (e) { e.preventDefault(); });
  onEnter($('new-rice'), function () { addFixed('rices', 'new-rice'); });
  onEnter($('new-kimchi'), function () { addFixed('kimchis', 'new-kimchi'); });
  $('settings-form').addEventListener('change', function (e) {
    var st = S.settings;
    var id = e.target.id;
    function checked(boxId) {
      return Array.from(document.querySelectorAll('#' + boxId + ' input:checked')).map(function (x) { return x.value; });
    }
    if (id.indexOf('new-') === 0) return; // 밥·김치 추가 입력칸은 '추가' 버튼으로 처리
    if (id === 'set-store') st.storeName = e.target.value.trim();
    else if (id === 'set-origin') st.origin = e.target.value.trim();
    else if (id === 'set-soup') st.layout.soup = Number(e.target.value);
    else if (id === 'set-main') st.layout.main = Number(e.target.value);
    else if (id === 'set-side') st.layout.side = Number(e.target.value);
    else if (id.indexOf('dial-') === 0) st.dials[id.slice(5)] = e.target.value;
    else if (id.indexOf('st-') === 0) {
      st.style = e.target.value;
      toast('가게 스타일을 바꿨어요. 전체 다시 만들기를 누르면 이번 주 식단에 적용돼요.');
    }
    else if (id.indexOf('ml-') === 0) {
      var meals = checked('set-meals');
      if (!meals.length) { toast('끼니를 하나 이상 골라 주세요.'); e.target.checked = true; return; }
      st.meals = meals;
      // 끼니가 많으면 메뉴가 모자라니 간격을 줄인다 (세 끼: 1주, 두 끼: 최대 2주)
      var limit = meals.length >= 3 ? '1w' : meals.length === 2 ? '2w' : null;
      if (limit && st.dials.repeat > limit) {
        st.dials.repeat = limit;
        toast('끼니가 많아서 같은 메뉴 간격을 ' + limit.replace('w', '주') + '로 바꿨어요. 상세 설정에서 바꿀 수 있어요.');
      }
    } else if (id.indexOf('wd-') === 0) st.weekdays = checked('set-days').map(Number);
    else if (id.indexOf('od-') === 0) st.oneDays = checked('set-one-days').map(Number);
    log('settings', { detail: { field: id, value: e.target.type === 'checkbox' ? { meals: st.meals, weekdays: st.weekdays, oneDays: st.oneDays } : e.target.value } });
    persist();
    render();
  });

  $('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('add-name').value.trim();
    if (!name) return;
    if (findMenu(name)) { toast('이미 있는 메뉴예요: ' + name); return; }
    var cat = $('add-cat').value;
    var m = {
      name: name,
      cat: cat,
      ing: $('add-ing').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 3),
      method: $('add-method').value || (cat === 'one' ? '일품' : cat === 'soup' ? '끓임' : ''),
      cost: $('add-high').checked || cat === 'special' ? 'high' : 'mid',
      custom: true
    };
    if ($('add-spicy').checked) m.spicy = true;
    if ($('add-veg').checked) m.veg = true;
    if (cat === 'one' && $('add-rice').checked) m.rice = true;
    if ((cat === 'one' || cat === 'special') && $('add-soupy').checked) m.soupy = true;
    S.custom.push(m);
    var linked = linkRenamed(name, m.cat);
    log('add_menu', { after: name, detail: { menu: m, from_rename: e.target.dataset.fromRename === '1', linked_slots: linked } });
    delete e.target.dataset.fromRename;
    persist();
    e.target.reset();
    render();
    toast(name + ' 추가했어요. 다음 식단부터 섞여 나와요.');
  });

  // ── 처음 쓰는 분 안내: 가게 이름·스타일·끼니만 묻고 바로 식단을 만든다 ──
  function openWelcome() {
    S.sheet = { type: 'welcome' };
    var st = S.settings;
    $('sheet').innerHTML =
      '<div class="sheet-inner welcome">' +
      '<div class="sheet-head"><div><p class="eyebrow">처음 오셨어요</p><h3 id="sheet-title">뚝딱 식단표</h3>' +
      '<p class="meta">버튼 한 번에 지난 식단과 안 겹치는 한 주 식단을 만들어 드려요.</p></div></div>' +
      '<label class="field"><span>가게 이름 <small>식단표 제목에 들어가요</small></span><input type="text" id="wl-store" maxlength="30" placeholder="예: 대성식당"></label>' +
      '<div class="field"><span>가게 스타일</span><div class="seg two">' +
      '<button type="button" data-sheet="wl-style" data-v="field" aria-pressed="' + (st.style !== 'cafeteria') + '">현장식당·백반<small>한식 위주</small></button>' +
      '<button type="button" data-sheet="wl-style" data-v="cafeteria" aria-pressed="' + (st.style === 'cafeteria') + '">구내식당·한식뷔페<small>퓨전·양식도 가끔</small></button>' +
      '</div></div>' +
      '<div class="field"><span>식단을 짤 끼니 <small>여러 개 골라도 돼요</small></span><div class="seg">' +
      MEALS.map(function (m) { return '<button type="button" data-sheet="wl-meal" data-v="' + m.id + '" aria-pressed="' + (st.meals.indexOf(m.id) >= 0) + '">' + m.label + '</button>'; }).join('') +
      '</div></div>' +
      '<p class="help notice">더 좋은 식단 추천을 위해 <b>사용 기록</b>(어떤 메뉴를 무엇으로 바꿨는지 등)을 모아요. 이름·전화번호 같은 개인정보는 모으지 않아요. 원하지 않으면 나중에 <b>백업·지우기</b>에서 끌 수 있어요.</p>' +
      '<button type="button" class="btn primary wide-btn" data-sheet="wl-start">시작하기</button>' +
      '<p class="help">나머지(요일, 반찬 가짓수, 매일 나오는 밥·김치)는 나중에 <b>식단 설정</b>에서 바꿀 수 있어요.</p>' +
      '<label class="btn wide-btn file-btn wl-import">예전에 쓰던 백업 파일이 있어요<input type="file" id="wl-import" accept=".json,application/json" hidden></label>' +
      '</div>';
    showSheet();
  }
  function startFromWelcome() {
    var name = $('wl-store').value.trim();
    if (name) S.settings.storeName = name;
    S.settings.welcomed = true;
    log('welcome', { detail: { style: S.settings.style, meals: S.settings.meals, has_store_name: !!name } });
    persist();
    closeSheet();
    generateWeek();
  }
  sheet.addEventListener('change', function (e) {
    if (e.target.id !== 'wl-import') return;
    var file = e.target.files && e.target.files[0];
    if (file) { S.settings.welcomed = true; readBackup(file); }
  });
  sheet.addEventListener('click', function (e) {
    if (!S.sheet || S.sheet.type !== 'welcome') return;
    var a = e.target.closest('[data-sheet]');
    if (!a) return;
    if (a.dataset.sheet === 'wl-style') {
      S.settings.style = a.dataset.v;
      sheet.querySelectorAll('[data-sheet="wl-style"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === S.settings.style)); });
    } else if (a.dataset.sheet === 'wl-meal') {
      var meals = S.settings.meals.slice();
      var idx = meals.indexOf(a.dataset.v);
      if (idx >= 0 && meals.length > 1) meals.splice(idx, 1); else if (idx < 0) meals.push(a.dataset.v);
      S.settings.meals = meals;
      if (meals.length >= 3) S.settings.dials.repeat = '1w';
      sheet.querySelectorAll('[data-sheet="wl-meal"]').forEach(function (b) { b.setAttribute('aria-pressed', String(meals.indexOf(b.dataset.v) >= 0)); });
    } else if (a.dataset.sheet === 'wl-start') startFromWelcome();
  });

  // 시작: 글씨 크기 적용. 처음 오신 분은 안내 화면, 식단이 있으면 바로 보여준다.
  applyFontSize();
  if (Object.keys(S.plans).length === 0 && !S.settings.welcomed) { render(); openWelcome(); }
  else if (Object.keys(S.plans).length === 0) generateWeek();
  else render();
  flushRemote();
})();
