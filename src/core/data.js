// Все игровые данные в одном месте. Сеттинг: фантастика, люди и чужие на одной планете.
// Названия здесь — черновики, их легко поменять: правила ссылаются только на id.

export const TERRAIN = {
  water:    { name: 'Море',     food: 1, prod: 0, gold: 1, move: Infinity, def: 0,    color: '#2a6f97' },
  grass:    { name: 'Луга',     food: 2, prod: 0, gold: 0, move: 1,        def: 0,    color: '#4f9a5a' },
  plains:   { name: 'Степь',    food: 1, prod: 1, gold: 0, move: 1,        def: 0,    color: '#a89f58' },
  desert:   { name: 'Пустошь',  food: 0, prod: 0, gold: 0, move: 1,        def: 0,    color: '#c49a68' },
  tundra:   { name: 'Мерзлота', food: 1, prod: 0, gold: 0, move: 1,        def: 0,    color: '#9fb3b6' },
  forest:   { name: 'Лес',      food: 1, prod: 1, gold: 0, move: 2,        def: 0.25, color: '#35624d' },
  hills:    { name: 'Скалы',    food: 0, prod: 2, gold: 0, move: 2,        def: 0.25, color: '#8e7a5c' },
  mountain: { name: 'Хребет',   food: 0, prod: 0, gold: 0, move: Infinity, def: 0,    color: '#6f6872' },
};

// Особые ресурсы на клетках: дают прибавку, когда клетку обрабатывает город.
export const RESOURCES = {
  crystals: { name: 'Кристаллы',      icon: '💎', on: ['hills'],                     food: 0, prod: 1, gold: 0, sci: 2 },
  geyser:   { name: 'Энергогейзер',   icon: '⚡', on: ['plains', 'desert', 'tundra'], food: 0, prod: 1, gold: 2, sci: 0 },
  fertile:  { name: 'Плодородная почва', icon: '🌱', on: ['grass', 'plains'],         food: 2, prod: 0, gold: 0, sci: 0 },
  metals:   { name: 'Редкие металлы', icon: '⚙️', on: ['hills', 'desert'],            food: 0, prod: 2, gold: 1, sci: 0 },
  plankton: { name: 'Планктон',       icon: '🦐', on: ['water'],                      food: 2, prod: 0, gold: 1, sci: 0 },
};

// Дорога: строят инженеры за 2 хода на своей или ничьей земле. По дороге ход стоит треть очка.
export const ROAD = { name: 'Дорога', turns: 2, cost: 1 / 3 };

export const IMPROVEMENTS = {
  farm:   { name: 'Ферма',     icon: '🌾', turns: 4, on: ['grass', 'plains', 'desert', 'tundra'], food: 1, prod: 0, tech: null },
  mine:   { name: 'Шахта',     icon: '⛏️', turns: 5, on: ['hills'],  food: 0, prod: 2, tech: 'mining' },
  lumber: { name: 'Лесопилка', icon: '🪓', turns: 5, on: ['forest'], food: 0, prod: 1, tech: 'woodwork' },
};

// kind: civil — мирный, support — поддержка (стоит вместе с бойцом), melee — ближний бой,
// ranged — стрелок, siege — осадный. up — во что улучшается. faction + replaces — особый юнит фракции.
export const UNITS = {
  settler:  { name: 'Колонисты', icon: '🚐', kind: 'civil', str: 0, rng: 0, range: 0, moves: 2, cost: 40, tech: null,
    desc: 'Основывают новый город. Забирают 1 жителя.' },
  worker:   { name: 'Инженеры', icon: '🔧', kind: 'civil', str: 0, rng: 0, range: 0, moves: 2, cost: 25, tech: null,
    desc: 'Строят фермы, шахты и лесопилки на своей земле.' },
  warrior:  { name: 'Ополчение', icon: '🪖', kind: 'melee', str: 8, rng: 0, range: 0, moves: 2, cost: 20, tech: null, up: 'swordsman',
    desc: 'Простой боец ближнего боя.' },
  archer:   { name: 'Стрелки', icon: '🔫', kind: 'ranged', str: 5, rng: 8, range: 2, moves: 2, cost: 30, tech: 'archery', up: 'crossbow',
    desc: 'Стреляют на 2 клетки, не получая ответного урона.' },
  spearman: { name: 'Заградотряд', icon: '🧱', kind: 'melee', str: 11, rng: 0, range: 0, moves: 2, cost: 40, tech: 'bronze', antiMounted: true, up: 'pikeman',
    desc: '+50% против техники.' },
  horseman: { name: 'Багги', icon: '🏎️', kind: 'melee', str: 12, rng: 0, range: 0, moves: 4, cost: 45, tech: 'horse', mounted: true, up: 'knight',
    desc: 'Быстрая техника: 4 очка движения.' },
  swordsman:{ name: 'Пехота', icon: '💂', kind: 'melee', str: 14, rng: 0, range: 0, moves: 2, cost: 55, tech: 'iron', up: 'musketeer',
    desc: 'Основной боец ближнего боя.' },
  catapult: { name: 'Миномёт', icon: '💥', kind: 'siege', str: 6, rng: 12, range: 2, moves: 2, cost: 60, tech: 'mathematics', up: 'cannon',
    desc: 'Стреляет на 2 клетки. +75% по городам.' },
  crossbow: { name: 'Снайперы', icon: '🎯', kind: 'ranged', str: 12, rng: 15, range: 2, moves: 2, cost: 70, tech: 'machinery',
    desc: 'Сильные стрелки.' },
  pikeman:  { name: 'Тяжёлая пехота', icon: '🦾', kind: 'melee', str: 16, rng: 0, range: 0, moves: 2, cost: 70, tech: 'feudalism', antiMounted: true, up: 'musketeer',
    desc: '+50% против техники.' },
  knight:   { name: 'Ховертанк', icon: '🛸', kind: 'melee', str: 20, rng: 0, range: 0, moves: 4, cost: 85, tech: 'chivalry', mounted: true,
    desc: 'Быстрый и сильный: 4 очка движения.' },
  musketeer:{ name: 'Экзобоец', icon: '🤖', kind: 'melee', str: 24, rng: 0, range: 0, moves: 2, cost: 100, tech: 'gunpowder',
    desc: 'Боец в силовой броне, самый сильный в ближнем бою.' },
  cannon:   { name: 'Рельсотрон', icon: '☄️', kind: 'siege', str: 10, rng: 22, range: 2, moves: 2, cost: 110, tech: 'metallurgy',
    desc: 'Мощная осада. +75% по городам.' },

  // Особые юниты фракций
  shuttle:   { name: 'Штурмовой челнок', icon: '🚁', kind: 'melee', str: 13, rng: 0, range: 0, moves: 4, cost: 45, tech: 'horse',
    mounted: true, flying: true, defMult: 0.7, up: 'knight', faction: 'empire', replaces: 'horseman',
    desc: 'Летает над горами и водой, быстро перебрасывается к фронту. Слаб в защите.' },
  shieldgen: { name: 'Генератор щита', icon: '🔰', kind: 'support', str: 0, rng: 0, range: 0, moves: 2, cost: 60, tech: 'mathematics',
    shield: 0.25, faction: 'scientists',
    desc: 'Сам не воюет. Свои юниты на соседних клетках получают на 25% меньше урона.' },
  volunteers:{ name: 'Добровольцы', icon: '🙋', kind: 'melee', str: 14, rng: 0, range: 0, moves: 2, cost: 55, tech: 'iron',
    buyMult: 0.5, up: 'musketeer', faction: 'believers', replaces: 'swordsman',
    desc: 'Как пехота, но выкупаются за деньги вдвое дешевле.' },

  // Местная фауна
  crawler:  { name: 'Скальник',  icon: '🦂', kind: 'melee', str: 9,  rng: 0, range: 0, moves: 2, cost: 0, fauna: true, desc: 'Местный хищник.' },
  stinger:  { name: 'Жалокрыл',  icon: '🦟', kind: 'melee', str: 6,  rng: 0, range: 0, moves: 3, cost: 0, fauna: true, desc: 'Быстрая летучая тварь.' },
  armadillo:{ name: 'Панцирник', icon: '🦏', kind: 'melee', str: 16, rng: 0, range: 0, moves: 2, cost: 0, fauna: true, desc: 'Бронированный зверь.' },
  colossus: { name: 'Колосс',    icon: '🦖', kind: 'melee', str: 26, rng: 0, range: 0, moves: 2, cost: 0, fauna: true, desc: 'Огромное древнее существо.' },
};

export const BUILDINGS = {
  granary:    { name: 'Гидропоника',  icon: '🌱', cost: 45,  tech: 'pottery',     desc: '+2 еды' },
  market:     { name: 'Рынок',        icon: '🏦', cost: 60,  tech: 'commerce',    desc: '+2 денег и +25% денег в городе' },
  workshop:   { name: 'Мастерская',   icon: '🛠️', cost: 55,  tech: 'bronze',      desc: '+2 производства' },
  barracks:   { name: 'Казарма',      icon: '⛺', cost: 50,  tech: 'bronze',      desc: 'Новые бойцы на 15% сильнее' },
  walls:      { name: 'Периметр',     icon: '🧱', cost: 60,  tech: 'masonry',     desc: 'Город крепче: +5 к силе, +100 прочности' },
  library:    { name: 'Банк данных',  icon: '💾', cost: 65,  tech: 'writing',     desc: '+50% науки' },
  forge:      { name: 'Завод',        icon: '🏭', cost: 90,  tech: 'iron',        desc: '+3 производства' },
  aqueduct:   { name: 'Климат-купол', icon: '⛲', cost: 90,  tech: 'engineering', desc: 'После роста сохраняется 40% еды' },
  university: { name: 'Институт',     icon: '🎓', cost: 120, tech: 'education',   desc: '+50% науки' },
  castle:     { name: 'Бастион',      icon: '🏰', cost: 120, tech: 'feudalism',   desc: 'Город ещё крепче: +7 к силе, +100 прочности' },

  // Особые здания фракций
  commandatura: { name: 'Комендатура', icon: '🎖️', cost: 50, tech: 'bronze', faction: 'empire', replaces: 'barracks',
    desc: 'Новые бойцы на 15% сильнее. Захваченные города в радиусе 6 сразу работают, без беспорядков.' },
  archive:      { name: 'Архив древних', icon: '📚', cost: 65, tech: 'writing', faction: 'scientists', replaces: 'library',
    desc: '+50% науки и +3 науки за каждые руины на земле города.' },
  beacon:       { name: 'Храм-маяк', icon: '🕯️', cost: 120, tech: 'philosophy', faction: 'believers', national: true,
    desc: 'Один, в столице. Все знакомые поселения каждый ход склоняются к вам, чужое влияние на них тает вдвое быстрее.' },
};

// Дерево технологий. tier задаёт цену.
const TIER_COST = [0, 35, 75, 135, 210, 310, 420, 560, 720];
const T = (name, tier, req, desc) => ({ name, tier, req, cost: TIER_COST[tier], desc });
export const TECHS = {
  pottery:     T('Гидропоника',         1, [],                          'Гидропоника'),
  archery:     T('Баллистика',          1, [],                          'Стрелки'),
  mining:      T('Глубокое бурение',    1, [],                          'Шахты на скалах'),
  horse:       T('Вездеходы',           2, ['archery'],                 'Багги'),
  masonry:     T('Фортификация',        2, ['mining'],                  'Периметр'),
  bronze:      T('Сплавы',              2, ['mining'],                  'Заградотряд, Мастерская, Казарма'),
  writing:     T('Сеть данных',         2, ['pottery'],                 'Банк данных'),
  commerce:    T('Торговые протоколы',  2, ['pottery'],                 'Рынок'),
  irrigation:  T('Генная агрономия',    3, ['pottery', 'bronze'],       'Фермы дают ещё +1 еды'),
  woodwork:    T('Биопереработка',      3, ['bronze'],                  'Лесопилки в лесу'),
  iron:        T('Композитная броня',   3, ['bronze'],                  'Пехота, Завод'),
  mathematics: T('Точная механика',     4, ['writing', 'masonry'],      'Миномёт'),
  philosophy:  T('Социология',          4, ['writing'],                 '+15% науки во всех городах'),
  engineering: T('Климат-инженерия',    5, ['mathematics', 'woodwork'], 'Климат-купол'),
  machinery:   T('Оптика',              5, ['mathematics', 'iron'],     'Снайперы'),
  education:   T('Высшая школа',        5, ['philosophy'],              'Институт'),
  feudalism:   T('Тяжёлые сплавы',      6, ['iron', 'philosophy'],      'Тяжёлая пехота, Бастион'),
  chivalry:    T('Антигравитация',      7, ['feudalism', 'horse'],      'Ховертанк'),
  gunpowder:   T('Экзоскелеты',         7, ['machinery', 'feudalism'],  'Экзобоец'),
  metallurgy:  T('Рельсовые орудия',    8, ['gunpowder', 'engineering'],'Рельсотрон'),
  tactics:     T('Военная доктрина',    8, ['gunpowder', 'education'],  'Все бойцы на 15% сильнее'),
};

// Фракции. Пока проработаны три человеческие, «Вольные колонисты» — временная заглушка без особенностей.
export const FACTIONS = {
  empire: {
    name: 'Империя', color: '#eef2f8', rim: '#1d4ed8', style: 'empire',
    tagline: 'Древняя держава, уверенная в своей вечности',
    bonus: 'Смена императоров', bonusDesc: 'Раз в 35 ходов на трон всходит новый правитель. Вы выбираете его черту: завоеватель, строитель или дипломат.',
  },
  scientists: {
    name: 'Учёные', color: '#2ec4b6', rim: '#0b3b37', style: 'scientists',
    tagline: 'Стеклянные купола и знания древних',
    bonus: 'Модернизация', bonusDesc: 'Как только изучен юнит получше, старые юниты в ваших границах сами улучшаются до него за полцены.',
  },
  believers: {
    name: 'Старообрядцы', color: '#8c1c3a', rim: '#f3e3c3', style: 'believers',
    tagline: 'Строгая община, сильная семьями и казной',
    bonus: 'Десятина', bonusDesc: 'Каждый город отдаёт долю в общую казну: +1 денег и ещё +1 за каждые 2 жителя. На деньги можно сразу выкупать юниты и здания.',
  },
  colonists: {
    name: 'Вольные колонисты', color: '#e8a33d', rim: '#3b2405', style: 'colonists', placeholder: true,
    tagline: 'Временная фракция, пока не придуманы чужие',
    bonus: 'Без особенностей', bonusDesc: 'Обычные колонисты без бонусов.',
  },
};
export const PLAYABLE_FACTIONS = ['empire', 'scientists', 'believers'];

export const EMPEROR_TRAITS = {
  conqueror: { name: 'Завоеватель', icon: '⚔️', desc: 'Все бойцы атакуют на 15% сильнее.' },
  builder:   { name: 'Строитель',   icon: '🏗️', desc: '+20% производства во всех городах.' },
  diplomat:  { name: 'Дипломат',    icon: '🤝', desc: 'Каждый ход +3 влияния на все знакомые поселения, подарки на 50% выгоднее.' },
};

// Нейтральные поселения и что они дают союзнику
export const MINOR_TYPES = {
  farmers: { name: 'Аграрии',    icon: '🌾', color: '#7ea35a', ally: '+3 еды в вашей столице' },
  traders: { name: 'Торговцы',   icon: '💰', color: '#c7a64a', ally: '+5 денег каждый ход' },
  hermits: { name: 'Отшельники', icon: '🔭', color: '#6c8fb0', ally: '+4 науки каждый ход' },
  mercs:   { name: 'Наёмники',   icon: '🗡️', color: '#9a6a5a', ally: 'Раз в 15 ходов присылают бойца' },
};

export const FAUNA_STYLE = { name: 'Фауна', color: '#9a4a2a' };

export const DIFFICULTY = {
  easy:   { name: 'Лёгкий',  aiMult: 0.8 },
  normal: { name: 'Обычный', aiMult: 1.0 },
  hard:   { name: 'Сложный', aiMult: 1.3 },
};

// Размер карты от числа соперников
export const MAP_SIZES = { 1: [24, 16], 2: [28, 19], 3: [32, 21] };

export const RULES = {
  minCityDistance: 3,
  cityBaseHp: 200,
  unitHp: 100,
  citySight: 2,
  unitSight: 2,
  cityRange: 2,
  freeUnits: 3,         // бесплатное содержание: столько бойцов + по одному на город
  giftGold: 50,
  giftInfluence: 15,
  allyInfluence: 60,
  reignTurns: 35,
  nestSpawnEvery: 10,
  unrestTurns: 3,
  mercEvery: 15,
};
