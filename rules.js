// 점수 규칙 설정 파일
// 식단의 좋고 나쁨은 전부 여기 숫자로 정해진다. + 는 좋음, - 는 나쁨.
// 규칙을 바꾸면 version 을 올려 둔다. (사용 기록에 어떤 규칙으로 만든 식단인지 남는다)
var RULES = {
  version: '2026-10-01.1',

  weights: {
    // ── 한 끼 안에서 ──
    mealIngredient3: -60,    // 같은 주재료가 3개 이상 메뉴에 사용 (콩나물 파티 방지)
    friedPerMeal: -30,       // 튀김·전이 2개 이상 (느끼함)
    sameMethod: -8,
    sideSameIngredient: -25, // 반찬끼리 같은 주재료 (단무지+단무지무침, 계란말이+계란찜)          // 같은 조리법이 몰림 (볶음 2개 등)
    noVegSide: -20,          // 채소 반찬이 하나도 없음 [추가 규칙, 검토 필요]
    spicyMainSoup: -6,       // 메인과 국이 둘 다 매움 [추가 규칙, 검토 필요]
    mainSoupShare: -8,       // 메인과 국이 같은 재료 (소불고기+소고기무국) [추가 규칙, 검토 필요]
    pairOnlyAlone: -60,      // 곁들이는 음식(피클·단무지 등)이 짝 없이 나옴
    pair: 6,                 // 자연스러운 조합 (제육볶음+쌈채소 등, menus.js 에 직접 적은 것)
    pairStat: 1,             // 학교 급식 통계상 자주 같이 나오는 조합 (pair-stats.js, 조합당 약 0.6~3점). 높이면 생일상(미역국+갈비찜+잡채) 조합이 매주 나옴

    // ── 한 주 안에서 ──
    duplicateInWeek: -1000,  // 같은 메뉴가 한 주에 두 번
    weeklyOveruse: -12,      // 같은 주재료가 주간 허용 횟수 초과 (1회 초과마다)
    highCostOver: -25,       // 비싼 메인이 주간 허용 횟수 초과 (1회 초과마다)
    // 메인과 국은 그 끼니의 얼굴: 같은 재료·같은 맛이 같은 날 다른 끼니나 다음 날 또 나오면 안 된다.
    // 재료 돌려쓰기(reuseNearby)는 국·반찬 재료로 하되, 국→국·메인→메인 연속은 아래 감점이 막는다.
    sameSoupNearby: -50,     // 같은 날·다음 날 국 재료나 맛 계열이 같음 (콩나물국 → 황태콩나물국, 된장찌개 → 시금치된장국)
    sameMainIngredient: -60, // 같은 날·다음 날 메인 주재료가 같음 (고등어김치조림 → 고등어무조림)
    sameProteinNextDay: -15, // 같은 날·다음 날 같은 종류 고기/생선 메인 (생선 → 생선) [추가 규칙]
    proteinOver: -12,        // 같은 종류 고기/생선 메인이 한 주에 너무 많음 [추가 규칙]
    maxSameProtein: 3,       // 하루 한 끼 기준. 끼니가 많으면 엔진이 비례해서 늘린다

    // ── 지난 식단과 비교 ──
    historyRepeat: -1000,    // 반복 간격 안에 지난 식단과 같은 메뉴
    historyNear: -8,         // 반복 간격 바로 뒤 2주 안에 같은 메뉴 (약하게)
    avoidPrevious: -40,      // '다시 만들기' 때 직전 메뉴는 피하기

    // ── 제철 (menus.js 의 SEASONS) ──
    outOfSeason: -1000,      // 제철에만 내는 메뉴가 철이 아닐 때
    inSeason: 5              // 1년 내내 되지만 제철인 메뉴가 제철에 나올 때
  },

  // 설정 다이얼: 고른 값에 따라 위 weights 에 덮어쓴다.
  dials: {
    efficiency: {
      strong: { soupShare: 8, reuseNearby: 3, distinctIngredient: -1.5, weeklyIngredientMax: 5 },
      normal: { soupShare: 4, reuseNearby: 2, distinctIngredient: -0.8, weeklyIngredientMax: 4 },
      weak: { soupShare: 1, reuseNearby: 0.5, distinctIngredient: -0.2, weeklyIngredientMax: 3 }
    },
    budget: {
      loose: { maxHighMains: 3, lowCostBonus: 0 },
      normal: { maxHighMains: 2, lowCostBonus: 0.5 },
      tight: { maxHighMains: 1, lowCostBonus: 2 }
    },
    repeat: {
      '1w': { repeatDays: 7 },   // 하루 세 끼를 낼 때처럼 메뉴가 많이 필요할 때
      '2w': { repeatDays: 14 },
      '3w': { repeatDays: 21 },
      '4w': { repeatDays: 28 }
    }
  },
  // soupShare: 국과 반찬이 주재료를 같이 씀 (콩나물국+콩나물무침)
  // reuseNearby: 이틀 안에 같은 재료를 다시 씀 (월 무생채 → 화 고등어무조림)
  // distinctIngredient: 한 주 재료 종류 1개마다 (적을수록 장보기 편함)

  dialDefaults: { efficiency: 'normal', budget: 'normal', repeat: '2w' }
};

if (typeof module !== 'undefined') module.exports = RULES;
