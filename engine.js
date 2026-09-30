// 식단 생성 엔진
// 1) 칸마다 메뉴를 무작위로 채운다
// 2) 칸을 하나씩 돌며 "이 칸을 다른 메뉴로 바꾸면 점수가 오르나?"를 확인해 오르면 교체한다
// 3) 더 이상 오르지 않으면 멈춘다. 시작점을 몇 번 바꿔 해보고 가장 점수 높은 식단을 고른다.
// 점수 기준은 rules.js 에 있다. AI 호출 없음.
var Engine = (function () {
  'use strict';

  var CATS = ['one', 'special', 'soup', 'main', 'side']; // one = 일품 요리, special = 특식

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 한 끼 구성 → 칸 이름 목록. 예: {soup:1, main:1, side:3} → soup_1, main_1, side_1, side_2, side_3
  // 일품 요리 날(kind='one')은 밥+메인 대신 일품 1개, 국 1개, 반찬은 하나 적게
  // 특식 날(kind='special')은 첫 번째 메인 자리에 특식이 들어간다
  function slotKeys(layout, kind) {
    var counts;
    if (kind === 'one') counts = { one: 1, soup: Math.min(layout.soup || 0, 1), main: 0, side: Math.max(1, (layout.side || 0) - 1) };
    else if (kind === 'special') counts = { special: 1, soup: layout.soup, main: Math.max(0, (layout.main || 1) - 1), side: layout.side };
    else counts = { soup: layout.soup, main: layout.main, side: layout.side };
    var keys = [];
    ['soup', 'one', 'special', 'main', 'side'].forEach(function (cat) { // 화면에 보이는 순서: 국 → 일품/특식/메인 → 반찬
      for (var i = 1; i <= (counts[cat] || 0); i++) keys.push(cat + '_' + i);
    });
    return keys;
  }

  function slotCat(key) {
    return key.split('_')[0];
  }

  function dayNum(ymd) {
    var p = ymd.split('-').map(Number);
    return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
  }

  // 점수 계산에 필요한 것들을 한 번에 준비
  // o: { menus, excluded:Set, history:[{date, names:[]}], dials, rules, avoid:Set, fixedIng:[] }
  function makeContext(o) {
    var w = Object.assign({}, o.rules.weights);
    Object.keys(o.rules.dials).forEach(function (k) {
      var choice = (o.dials && o.dials[k]) || o.rules.dialDefaults[k];
      Object.assign(w, o.rules.dials[k][choice] || o.rules.dials[k][o.rules.dialDefaults[k]]);
    });

    var byName = new Map();
    var pool = { one: [], special: [], soup: [], main: [], side: [] };
    o.menus.forEach(function (m) {
      byName.set(m.name, m);
      if ((o.excluded && o.excluded.has(m.name)) || !inPeriod(m)) return;
      if (m.trendy && o.style === 'field') return; // 현장식당·백반 스타일이면 퓨전·양식은 자동 추천에서 뺀다
      if (pool[m.cat]) pool[m.cat].push(m);
      if (m.cat === 'main' && m.special) pool.special.push(m); // 특식으로도 쓰는 메인 (소갈비찜 등)
    });
    // 제철에만 내는 메뉴는 이번 식단 기간(months: 달 번호 목록)에 철이 아니면 후보에서 뺀다
    function inPeriod(m) {
      if (!m.only || !o.months) return true;
      return m.only.some(function (x) { return o.months.indexOf(x) >= 0; });
    }

    var hist = new Map();
    (o.history || []).forEach(function (h) {
      var dn = dayNum(h.date);
      h.names.forEach(function (n) {
        if (!hist.has(n)) hist.set(n, []);
        hist.get(n).push(dn);
      });
    });

    return {
      w: w,
      byName: byName,
      pool: pool,
      hist: hist,
      avoid: o.avoid || new Set(),
      fixedIng: o.fixedIng || [],
      pairStats: o.pairStats || {}
    };
  }

  // 이름이 빈 칸('')은 "없음" (국물 있는 일품 요리 날의 국 칸)
  function lookup(ctx, name, cat) {
    if (!name) return { name: '', cat: cat, ing: [], method: '', cost: 'mid', none: true };
    return ctx.byName.get(name) || { name: name, cat: cat, ing: [], method: '', cost: 'mid' };
  }

  // 국의 "맛 계열": 재료가 달라도 같은 계열이면 연달아 나올 때 질린다 (된장찌개 → 시금치된장국)
  var SOUP_BASES = [[/된장|청국장/, '된장'], [/김치|김칫/, '김치'], [/미역/, '미역'], [/개장/, '개장'], [/순두부/, '순두부'], [/곰탕|설렁탕|갈비탕|꼬리/, '곰탕']];
  function soupBase(m) {
    if (!m.base) {
      m.base = '-';
      for (var i = 0; i < SOUP_BASES.length; i++) if (SOUP_BASES[i][0].test(m.name)) { m.base = SOUP_BASES[i][1]; break; }
    }
    return m.base === '-' ? null : m.base;
  }

  // 국물 있는 일품 요리·특식(국수, 국밥, 삼계탕 등)이 있는 날인지
  function soupyDay(items, cats) {
    for (var s = 0; s < items.length; s++) if ((cats[s] === 'one' || cats[s] === 'special') && items[s].soupy) return true;
    return false;
  }

  function add(map, key, n) {
    map.set(key, (map.get(key) || 0) + (n || 1));
  }

  // 식단 전체 점수. grid[d] = 그날 메뉴 객체 배열 (휴무면 null)
  function scorePlan(grid, meta, ctx) {
    var w = ctx.w;
    var total = 0;
    var weekCount = new Map();
    var ingWeek = new Map();
    var days = [];
    var highMains = 0;
    var proteinCount = new Map();

    for (var d = 0; d < grid.length; d++) {
      var items = grid[d];
      if (!items) continue;
      var dn = meta.dayNums[d];
      var month = meta.months[d];
      var ingDay = new Map();
      var sideIng = new Set();
      var methods = new Map();
      var fried = 0, sides = 0, hasVeg = false;
      var main = null, soup = null;
      var cats = meta.cats[d];
      var skipSoup = soupyDay(items, cats);
      var pairOnlyItems = [];
      var live = [];
      var reuseIng = new Set(); // 재료 돌려쓰기 대상: 국·반찬 재료만 (메인 재료는 연달아 나오면 오히려 질린다)

      ctx.fixedIng.forEach(function (g) { add(ingDay, g); });

      for (var s = 0; s < items.length; s++) {
        var m = items[s];
        var cat = cats[s];
        if (m.none || (cat === 'soup' && skipSoup)) continue; // 안 나가는 칸은 계산에서 뺀다
        live.push(m);
        add(weekCount, m.name);
        for (var i = 0; i < m.ing.length; i++) {
          add(ingDay, m.ing[i]);
          add(ingWeek, m.ing[i]);
          if ((cat === 'side' || cat === 'soup') && ctx.fixedIng.indexOf(m.ing[i]) < 0) reuseIng.add(m.ing[i]);
          if (cat === 'side') {
            if (sideIng.has(m.ing[i])) total += w.sideSameIngredient; // 반찬끼리 같은 재료 (단무지+단무지무침)
            sideIng.add(m.ing[i]);
          }
        }
        if (cat !== 'soup') {
          if (m.method === '튀김' || m.method === '전') fried++;
          if (m.method && m.method !== '생') add(methods, m.method);
        }
        if (cat === 'side') {
          sides++;
          if (m.veg) hasVeg = true;
        }
        if (cat === 'main' || cat === 'one' || cat === 'special') {
          if (!main) main = m;
          if (m.cost === 'high' && cat !== 'special') highMains++; // 특식은 예산 제한에서 뺀다
        }
        if (cat === 'soup' && !soup) soup = m;
        if (m.cost === 'low') total += w.lowCostBonus;
        if (m.pairOnly) pairOnlyItems.push(m);
        if (m.only && m.only.indexOf(month) < 0) total += w.outOfSeason;
        if (m.peak && m.peak.indexOf(month) >= 0) total += w.inSeason;

        var h = ctx.hist.get(m.name);
        if (h) {
          for (var j = 0; j < h.length; j++) {
            var gap = Math.abs(dn - h[j]);
            if (gap === 0) continue;
            if (gap <= w.repeatDays) total += w.historyRepeat;
            else if (gap <= w.repeatDays + 14) total += w.historyNear;
          }
        }
        if (ctx.avoid.has(m.name)) total += w.avoidPrevious;
      }

      ingDay.forEach(function (c) { if (c >= 3) total += w.mealIngredient3 * (c - 2); });
      if (soup) {
        var shared = 0, mainShared = false;
        soup.ing.forEach(function (g) {
          if (sideIng.has(g)) shared++;
          if (main && main.ing.indexOf(g) >= 0) mainShared = true;
        });
        total += w.soupShare * Math.min(shared, 2);
        if (mainShared) total += w.mainSoupShare;
      }
      if (fried >= 2) total += w.friedPerMeal * (fried - 1);
      methods.forEach(function (c) { if (c >= 2) total += w.sameMethod * (c - 1); });
      if (sides >= 2 && !hasVeg) total += w.noVegSide;
      if (main && soup && main.spicy && soup.spicy) total += w.spicyMainSoup;
      // 학교 급식 통계에서 자주 같이 나온 조합
      for (var x1 = 0; x1 < live.length; x1++) {
        for (var x2 = x1 + 1; x2 < live.length; x2++) {
          var n1 = live[x1].name, n2 = live[x2].name;
          var st = ctx.pairStats[n1 < n2 ? n1 + '|' + n2 : n2 + '|' + n1];
          if (st) total += w.pairStat * st;
        }
      }
      if (main && main.pairs) {
        for (var p = 0; p < live.length; p++) {
          if (live[p] !== main && main.pairs.indexOf(live[p].name) >= 0) total += w.pair;
        }
      }
      // 곁들이는 음식은 짝이 되는 메인이 있을 때만 (피클은 스파게티 날에만)
      pairOnlyItems.forEach(function (m) {
        if (!(main && main.pairs && main.pairs.indexOf(m.name) >= 0)) total += w.pairOnlyAlone;
      });
      if (main && main.protein && main.protein !== 'etc') add(proteinCount, main.protein);
      days.push({ dn: dn, reuse: reuseIng, main: main, soup: soup && !skipSoup ? soup : null });
    }

    // 한 주 상한은 끼니 수에 맞춘다 (하루 한 끼 6일 = 기준. 세 끼면 3배)
    var scale = Math.max(1, days.length / 6);
    var maxIngredient = Math.round(w.weeklyIngredientMax * scale);
    var maxHigh = Math.round(w.maxHighMains * scale);
    var maxProtein = Math.round(w.maxSameProtein * scale);

    weekCount.forEach(function (c) { if (c > 1) total += w.duplicateInWeek * (c - 1); });
    total += w.distinctIngredient * ingWeek.size;
    ingWeek.forEach(function (c) {
      if (c > maxIngredient) total += w.weeklyOveruse * (c - maxIngredient);
    });
    if (highMains > maxHigh) total += w.highCostOver * (highMains - maxHigh);
    proteinCount.forEach(function (c) {
      if (c > maxProtein) total += w.proteinOver * (c - maxProtein);
    });

    // 끼니끼리 비교 (끼니 순서가 아니라 날짜로: 세 끼면 월 점심과 화 점심 사이에 다른 끼니가 끼어 있다)
    for (var a = 0; a < days.length; a++) {
      for (var b = a + 1; b < days.length && days[b].dn - days[a].dn <= 2; b++) {
        var gapDays = days[b].dn - days[a].dn;
        // 이틀 안에 국·반찬 재료 다시 쓰기 → 장보기 효율
        var reuse = 0;
        days[a].reuse.forEach(function (g) { if (days[b].reuse.has(g)) reuse++; });
        total += w.reuseNearby * Math.min(reuse, 3);
        // 같은 날·다음 날 메인이 겹치면 질린다
        if (gapDays <= 1) {
          var x = days[a].main, y = days[b].main;
          if (x && y) {
            if (x.ing[0] && x.ing[0] === y.ing[0]) total += w.sameMainIngredient;        // 고등어 → 고등어
            else if (x.protein && x.protein !== 'etc' && x.protein === y.protein) total += w.sameProteinNextDay; // 생선 → 생선
          }
          var u = days[a].soup, v = days[b].soup;
          if (u && v) {
            var soupShared = u.ing.some(function (g) { return ctx.fixedIng.indexOf(g) < 0 && v.ing.indexOf(g) >= 0; });
            var sameBase = soupBase(u) && soupBase(u) === soupBase(v);
            if (soupShared || sameBase) total += w.sameSoupNearby;                         // 콩나물국 → 황태콩나물국
          }
        }
      }
    }
    return total;
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  var SAMPLE = 60;
  function sample(arr, n, rng) {
    var copy = arr.slice();
    for (var i = 0; i < n; i++) {
      var j = i + Math.floor(rng() * (copy.length - i));
      var t = copy[i]; copy[i] = copy[j]; copy[j] = t;
    }
    return copy.slice(0, n);
  }

  // 칸을 하나씩 바꿔보며 점수가 오르면 교체 (지역 탐색)
  function optimize(grid, meta, ctx, rng, cells) {
    var best = scorePlan(grid, meta, ctx);
    for (var pass = 0; pass < 8; pass++) {
      var improved = false;
      shuffle(cells, rng);
      for (var c = 0; c < cells.length; c++) {
        var d = cells[c][0], s = cells[c][1];
        var pool = ctx.pool[meta.cats[d][s]];
        // 후보가 많으면 매번 무작위 60개만 대본다 (여러 번 돌며 결국 좋은 조합을 찾는다. 속도 3배)
        if (pool.length > SAMPLE) pool = sample(pool, SAMPLE, rng);
        var cur = grid[d][s];
        var bestM = cur, bestS = best;
        for (var i = 0; i < pool.length; i++) {
          var m = pool[i];
          if (m === cur) continue;
          grid[d][s] = m;
          var sc = scorePlan(grid, meta, ctx) + rng() * 0.5; // 약간의 무작위로 매번 다른 결과
          if (sc > bestS) { bestS = sc; bestM = m; }
        }
        grid[d][s] = bestM;
        if (bestM !== cur) {
          best = scorePlan(grid, meta, ctx);
          improved = true;
        }
      }
      if (!improved) break;
    }
    return best;
  }

  function toObjects(names, keys, ctx) {
    return names.map(function (row, d) {
      return row ? row.map(function (n, s) { return lookup(ctx, n, slotCat(keys[d][s])); }) : null;
    });
  }

  // keys 는 모든 날 같은 배열이거나, 날마다 다른 배열의 배열
  function keysPerDay(keys, count) {
    if (Array.isArray(keys[0])) return keys;
    var out = [];
    for (var i = 0; i < count; i++) out.push(keys);
    return out;
  }
  function makeMeta(o, keys) {
    return {
      cats: keys.map(function (k) { return k.map(slotCat); }),
      dayNums: o.dates.map(dayNum),
      months: o.dates.map(function (s) { return Number(s.slice(5, 7)); })
    };
  }

  // 식단 만들기
  // o: { dates:[], off:[], keys: 칸 목록 (날마다 다르면 배열의 배열), ctx, seed, current: 이름 grid (있으면), editDays: 다시 채울 날짜 번호 목록 (없으면 전부) }
  function generate(o) {
    var rng = mulberry32(o.seed);
    var keys = keysPerDay(o.keys, o.dates.length);
    var meta = makeMeta(o, keys);
    var labels = { one: '일품 요리', special: '특식', soup: '국', main: '메인', side: '반찬' };
    meta.cats.forEach(function (cats, d) {
      if (o.off[d]) return;
      cats.forEach(function (cat) {
        if (o.ctx.pool[cat].length === 0) throw new Error('쓸 수 있는 ' + labels[cat] + ' 메뉴가 없어요.');
      });
    });
    var editDays = o.editDays || o.dates.map(function (_, d) { return d; });
    var current = o.current ? toObjects(o.current, keys, o.ctx) : null;
    // 칸이 많으면(반찬 가짓수가 많거나 여러 날) 다시 시도 횟수를 줄여 속도를 맞춘다
    var cellCount = 0;
    meta.cats.forEach(function (c, d) { if (!o.off[d] && editDays.indexOf(d) >= 0) cellCount += c.length; });
    var restarts = o.restarts || (cellCount > 60 ? 1 : cellCount > 40 ? 2 : 4);
    var bestGrid = null, bestScore = -Infinity;

    for (var r = 0; r < restarts; r++) {
      var cells = [];
      var grid = o.dates.map(function (_, d) {
        if (o.off[d]) return null;
        if (editDays.indexOf(d) < 0 && current && current[d]) return current[d].slice();
        return meta.cats[d].map(function (cat, s) {
          cells.push([d, s]);
          var pool = o.ctx.pool[cat];
          return pool[Math.floor(rng() * pool.length)];
        });
      });
      var sc = optimize(grid, meta, o.ctx, rng, cells);
      if (sc > bestScore) { bestScore = sc; bestGrid = grid; }
    }

    return {
      score: bestScore,
      grid: bestGrid.map(function (row, d) {
        if (!row) return null;
        var skip = soupyDay(row, meta.cats[d]);
        return row.map(function (m, s) { return skip && meta.cats[d][s] === 'soup' ? '' : m.name; });
      })
    };
  }

  // 한 칸에 넣을 대체 후보. 넣었을 때 전체 점수가 높은 순.
  // o: { dates, off, keys, ctx, current: 이름 grid, d, s, limit }
  function suggest(o) {
    var keys = keysPerDay(o.keys, o.dates.length);
    var meta = makeMeta(o, keys);
    var grid = toObjects(o.current, keys, o.ctx);
    var row = grid[o.d];
    var cur = row[o.s];
    var taken = new Set(row.map(function (m) { return m.name; }));
    var results = [];
    o.ctx.pool[meta.cats[o.d][o.s]].forEach(function (m) {
      if (taken.has(m.name)) return;
      row[o.s] = m;
      var sc = scorePlan(grid, meta, o.ctx);
      var shared = [];
      row.forEach(function (other, i) {
        if (i === o.s || other.none) return;
        other.ing.forEach(function (g) { if (m.ing.indexOf(g) >= 0 && shared.indexOf(g) < 0) shared.push(g); });
      });
      results.push({ menu: m, score: sc, shared: shared });
    });
    row[o.s] = cur;
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, o.limit || 4);
  }

  return {
    slotKeys: slotKeys,
    slotCat: slotCat,
    dayNum: dayNum,
    makeContext: makeContext,
    generate: generate,
    suggest: suggest,
    scorePlan: scorePlan
  };
})();

if (typeof module !== 'undefined') module.exports = Engine;
