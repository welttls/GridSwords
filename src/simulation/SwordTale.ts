/**
 * v2.5.0：剑谱（SwordTale）——把一局的「剑域纪事」写成可讲述的传奇。
 *
 * 纯函数、headless 安全；输入 Chronicle 事件 + 冠军剑意 + 血统，输出结构化的剑谱文本。
 * 措辞全部采用「seeded PRNG」选取（种子 = 剑 id 哈希 + 事件序号），
 * 同一局永远同一篇、不同局读感不同——保证名剑遗录回看稳定。
 *
 * 结构（用户定稿）：出身 → 重大纪事（逐条一行，按时间序）→ 总结评语 → 完整纪事（可折叠）。
 * 内容止于剑成——大比战绩不入剑谱。
 */

import type { Element, SwordState, SwordTaleData, TaleLine } from '../types';
import type { ChronicleEvent } from './Chronicle';
import type { World } from './World';
import { TICKS_PER_DAY, TICKS_PER_SHICHEN, SHICHEN_NAMES, MIND_REALMS, MAX_DAYS } from '../constants';
import { ELEMENT_LABEL } from './Genetics';
import { affixName } from '../data/AffixDB';
import { MIND_SKILL_BY_ID } from './Skills';

// ================= seeded PRNG =================
function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从文案池按种子确定性取一个 */
function pick<T>(pool: readonly T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

// ================= 时间换算 =================
function dayShichen(tick: number): { day: number; shichen: number } {
  const rawDay = Math.floor(tick / TICKS_PER_DAY) + 1;
  if (rawDay > MAX_DAYS) {
    // v2.6.0：天劫可越过第 10 日边界（超时兑底）——超界一律记作「第10日·亥时」，
    // 否则时辰回绕会出现「寅时排在卯时之后」的乱序、以及同一时辰重复的假象
    return { day: MAX_DAYS, shichen: SHICHEN_NAMES.length - 1 };
  }
  return {
    day: rawDay,
    shichen: Math.floor((tick % TICKS_PER_DAY) / TICKS_PER_SHICHEN),
  };
}

function timePrefix(tick: number): string {
  const t = dayShichen(tick);
  return `第${t.day}日·${SHICHEN_NAMES[Math.min(SHICHEN_NAMES.length - 1, t.shichen)]}时`;
}

// ================= 五行风味词库 =================
const ELEMENT_FLAVOR: Record<string, { attr: string; death: string; skill: string }> = {
  metal: { attr: '庚金之锐', death: '锋镝所指，金石俱裂', skill: '剑气纵横' },
  wood: { attr: '青木之灵', death: '藤蔓缠身，生机尽夺', skill: '万木生发' },
  water: { attr: '玄水之柔', death: '潮起潮落，吞没无声', skill: '流水无痕' },
  fire: { attr: '离火之烈', death: '烈焰焚身，灰飞烟灭', skill: '燎原之势' },
  earth: { attr: '厚土之坚', death: '山岳倾覆，碾为齑粉', skill: '不动如山' },
};

function elementLabel(e?: string): string {
  return (e && ELEMENT_LABEL[e as Element]) || '未知五行';
}

function realmName(realm?: number): string {
  return MIND_REALMS[Math.min(MIND_REALMS.length - 1, Math.max(0, realm ?? 0))].name;
}

// ================= 出身（prologue） =================
/** v2.6.0：纯剑生平——只述本剑的出生（时辰/第几代/五行/途径）+ 一生要览（击破/绝技/词条/剑心），与玩家操作无关 */
function buildPrologue(ctx: TaleCtx): string {
  const { champion, world } = ctx;
  const birth = world.chronicle.all().find((e) => e.kind === 'birth' && e.actorId === champion.id);
  const el = elementLabel(champion.genome.element);
  let head: string;
  if (birth) {
    const t = dayShichen(birth.tick);
    const gen = birth.data?.generation ?? champion.generation;
    const timeStr = `第${t.day}日·${SHICHEN_NAMES[t.shichen]}时`;
    const via = birth.data?.via ?? 'seed';
    const viaText: Record<string, string> = {
      seed: `一缕灵光自剑域中心升起——${el}行本命剑胚于此降世。`,
      reseed: `旧脉既断，新芽复生——${el}行本命剑胚重新种下。`,
      split: `母剑灵机充盈，分化得第${gen}代${el}行剑子。`,
      tide: `剑潮汹涌之际，${el}行游离剑意落于剑域。`,
      parasite: `以寄灵之术化敌为剑子，${el}行剑意归于本命血脉。`,
    };
    head = `${timeStr}，${viaText[via] ?? viaText.seed}`;
  } else {
    head = `第1日·子时，${el}行剑胚落入剑域，凡铁自此而始。`;
  }
  // 一生要览（纯剑事实摘要，不涉玩家操作）
  const facts: string[] = [];
  const kills = world.chronicle.countBy('kill', champion.id);
  const skillNames = (champion.mindSkillIds ?? []).map((id) => MIND_SKILL_BY_ID[id]?.name).filter((n): n is string => !!n);
  const affixNames = (champion.genome.affixes ?? []).map((a) => affixName(a)).filter(Boolean);
  const realm = champion.mindRealm ?? 0;
  if (kills > 0) facts.push(`击破${kills}敌`);
  if (skillNames.length > 0) facts.push(`悟剑心绝技「${skillNames.join('」「')}」`);
  if (affixNames.length > 0) facts.push(`得词条「${affixNames.join('」「')}」`);
  if (realm > 0) facts.push(`剑心自凡心臻至「${realmName(realm)}」`);
  if (facts.length > 0) head += `　此剑一生${facts.join('、')}。`;
  return head;
}

// ================= 重大纪事（episodes） =================
/** 各事件戏剧分（≥3 入「重大纪事」；低分事件仅进完整纪事） */
function dramaScore(e: ChronicleEvent): number {
  switch (e.kind) {
    case 'firstKill': return 3;
    case 'kill': return 1; // 每次击杀由 buildEpisodes 单独成行（见下）
    case 'split': return 3; // v2.5.1：分化/寄灵同为重大纪事
    case 'promotion': return 4;
    case 'affix': return e.data?.affix === 'poison' || e.data?.affix === 'parasite' ? 4 : 3;
    case 'mindSkill': return 3;
    case 'encounter': return 3;
    case 'nadir': return 4;
    case 'thunderSurvive': return 3;
    case 'emerge': return 3;
    case 'tribulation': return 2;
    case 'death': return 2; // 血亲陨落等（见下）
    default: return 0;
  }
}

/** v2.5.1：击杀描述——按击杀方式（近身/剑技/反震/天雷）区分 */
function killLineText(e: ChronicleEvent, rng: () => number): string {
  const el = elementLabel(e.data?.element);
  switch (e.data?.cause) {
    case 'skill':
      return pick([`剑技纵横，${el}行敌剑饮恨剑下。`, `一式绝技出手，${el}行敌剑灰飞烟灭。`], rng);
    case 'counter':
      return pick([`反震之力透体，${el}行敌剑自取灭亡。`, `不动如山，${el}行敌剑反受其害而陨。`], rng);
    case 'thunder':
      return pick([`天雷轰顶，${el}行敌剑灰飞烟灭。`, `雷光一闪，${el}行敌剑化为尘埃。`], rng);
    default:
      return pick([`近身搏杀，斩${el}行敌剑于剑下。`, `白刃相接，${el}行敌剑败亡。`], rng);
  }
}

function episodeText(e: ChronicleEvent, ctx: TaleCtx): string | null {
  const { champion, world, rng } = ctx;
  const el = elementLabel(champion.genome.element);
  switch (e.kind) {
    case 'firstKill': {
      const pool = [
        `初开杀戒，斩${elementLabel(e.data?.element)}行敌剑于剑下。`,
        `剑出见血，${el}剑意初尝杀伐滋味。`,
        `一战而胜，${el}剑自此开窍。`,
      ];
      return pick(pool, rng);
    }
    case 'promotion': {
      const r = realmName(e.data?.realm);
      const pool =
        e.data?.promoVia === 'fortune'
          ? [
              `偶得奇遇灵种灌顶，剑心晋入「${r}」。`,
              `机缘加身，${el}剑心豁然开朗，臻至「${r}」。`,
            ]
          : [
              `久历杀伐，一朝顿悟，剑心晋入「${r}」。`,
              `以战养战，${el}剑杀出「${r}」之境。`,
              `血火淬炼，${el}剑心通明，晋入「${r}」。`,
            ];
      return pick(pool, rng);
    }
    case 'affix': {
      const name = affixName(e.data?.affix ?? '');
      if (e.data?.affix === 'poison' || e.data?.affix === 'parasite') {
        const pool = [
          `悟得稀有词条「${name}」——${el}剑锋芒自此带三分邪气。`,
          `剑道异数，${el}剑悟得「${name}」，名动剑域。`,
        ];
        return pick(pool, rng);
      }
      const pool = [
        `悟得词条「${name}」，剑谱为之一新。`,
        `${el}剑参悟「${name}」，本领见长。`,
      ];
      return pick(pool, rng);
    }
    case 'mindSkill': {
      const skill = MIND_SKILL_BY_ID[e.data?.skillId ?? ''];
      const name = skill?.name ?? '剑心绝技';
      const pool = [
        `悟得剑心绝技「${name}」，剑意冲天。`,
        `${el}剑灵光乍现，习得「${name}」。`,
      ];
      return pick(pool, rng);
    }
    case 'encounter':
      return pick(
        [
          '偶得奇遇灵种，剑心再上一层。',
          '一缕奇遇灵光入体，剑境顿开。',
        ],
        rng,
      );
    case 'split':
      // v2.5.1：分化/寄灵入重大纪事
      if (e.data?.via === 'parasite') {
        return pick(['寄灵化敌为剑子，血脉再添一脉。', '以寄灵之术夺敌为子。'], rng);
      }
      return pick(
        [
          `分化出第${e.data?.generation ?? '?'}代${elementLabel(e.data?.element)}行剑子，血脉绵延。`,
          `灵机充盈，分化第${e.data?.generation ?? '?'}代${elementLabel(e.data?.element)}行剑子。`,
        ],
        rng,
      );
    case 'nadir':
      return pick(
        [
          '剑体濒崩之际，竟自刀光剑影中逆势而起，残血反杀。',
          '身陷绝境、九死一生——却愈战愈勇，绝境逢生。',
          `${el}剑于濒死边缘回天转命，剑心愈发凝练。`,
        ],
        rng,
      );
    case 'thunderSurvive':
      return pick(
        [
          '天雷加身而不灭——雷劫余生，天眷之剑。',
          '雷霆轰顶，剑体将溃，却硬生生撑了过去。',
        ],
        rng,
      );
    case 'emerge':
      return pick(
        [
          '万剑相杀之中，本命血脉自成气候，隐有万剑朝宗之象。',
          '此脉自采气、自分灵，剑意存续之道初显端倪。',
        ],
        rng,
      );
    case 'death': {
      // 血亲陨落（本命血脉相关者倒下；v2.7.1：区分祖辈/后裔——原用祖先链导致「祖辈被称剑子」语义倒置）
      const diedId = e.actorId ?? '';
      if (diedId === champion.id) return null;
      const info = world.lineage.get(diedId);
      const gen = info?.generation ?? 1;
      // 后裔陨落（字面「剑子」）
      if (ctx.descendants.has(diedId)) {
        const pool = [
          `血脉同源的第${gen}代剑子陨落——独余此剑，砥砺前行。`,
          `同源一脉折损一位第${gen}代剑子，${el}剑睹之默然。`,
        ];
        return pick(pool, rng);
      }
      // 祖辈陨落（血亲相残，多见于天劫）——不用「剑子」称谓
      if (ctx.lineage.has(diedId)) {
        const pool = [
          `同源祖辈于天劫中陨落，本命剑意竟是最后的赢家。`,
          `血脉源头轰然崩断，唯余此剑背负一脉而前行。`,
        ];
        return pick(pool, rng);
      }
      return null;
    }
    case 'tribulation':
      return pick(
        [
          '天劫收束，壁垒向内收缩，剑域愈窄。',
          '天雷滚滚，壁垒渐合，唯强者可留。',
        ],
        rng,
      );
    default:
      return null;
  }
}

/** 天劫决战（最后一杀/决胜时刻）的独立纪事行 */
function finaleText(ctx: TaleCtx): { tick: number; text: string } | null {
  const { world, champion } = ctx;
  // 冠军在天劫期（第10日始）的最后一杀
  const tribStart = TICKS_PER_DAY * (MAX_DAYS - 1);
  const lastKill = world.chronicle
    .all()
    .filter((e) => e.kind === 'kill' && e.actorId === champion.id && e.tick >= tribStart)
    .pop();
  if (!lastKill) return null;
  const pool = [
    '绝地 4×4 之中，一剑定乾坤——天劫之下，唯此剑独存。',
    '天劫收束至方寸之地，本命剑意绝境反杀，笑到最后。',
    '万剑尽没，唯此剑于天劫绝地中胜出，剑域为之震颤。',
  ];
  return { tick: lastKill.tick, text: pick(pool, ctx.rng) };
}

/** 汇总重大纪事：剑心升级/学技能/分化/每次杀敌/血亲陨落/天劫决胜——逐条成行、按时间序，上限 18 条 */
function buildEpisodes(ctx: TaleCtx): TaleLine[] {
  const { world, champion } = ctx;
  const lines: { tick: number; text: string; score: number }[] = [];

  // v2.6.0：天劫决胜行（最后一杀）——若存在，则该杀的普通击杀行不再重复叙述
  const fin = finaleText(ctx);
  const championKills = world.chronicle.all().filter((e) => e.kind === 'kill' && e.actorId === champion.id);
  for (const e of world.chronicle.all()) {
    if (e.kind === 'kill' && e.actorId === champion.id) {
      // v2.5.1：每次击杀都成一条重大纪事（首杀由 firstKill 事件表达，从第 2 杀起逐条）
      const n = championKills.indexOf(e) + 1;
      if (n === 1) continue;
      if (fin && e.tick === fin.tick) continue; // v2.6.0：决胜杀由「天劫决胜」行表述
      const text = killLineText(e, ctx.rng);
      if (text) lines.push({ tick: e.tick, text, score: 2 });
      continue;
    }
    if (e.kind === 'firstKill' && e.actorId === champion.id) {
      const text = episodeText(e, ctx);
      if (text) lines.push({ tick: e.tick, text, score: dramaScore(e) });
      continue;
    }
    const isMine = e.actorId === champion.id || (e.kind === 'death' && ctx.lineage.has(e.actorId ?? '') && e.actorId !== champion.id);
    // v2.6.0：重大纪事只留本剑/本脉自身事件——天劫收缩等环境事件不再单列（决胜由 finale 行表达）
    const isGlobal = e.kind === 'emerge';
    if (!isMine && !isGlobal) continue;
    // 血亲陨落（drama 3）升为重大事件
    const score = e.kind === 'death' && ctx.lineage.has(e.actorId ?? '') && e.actorId !== champion.id ? 3 : dramaScore(e);
    if (score < 3) continue;
    const text = episodeText(e, ctx);
    if (!text) continue;
    lines.push({ tick: e.tick, text, score });
  }

  // 天劫决胜（fin 已在顶部计算并用于决胜杀去重）
  if (fin) lines.push({ tick: fin.tick, text: fin.text, score: 5 });

  // 排序 + 去重（同 tick 合并保序）+ 截取
  lines.sort((a, b) => a.tick - b.tick || b.score - a.score);
  const seen = new Set<string>();
  const uniq: { tick: number; text: string }[] = [];
  for (const l of lines) {
    const key = `${l.tick}|${l.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push({ tick: l.tick, text: l.text });
  }
  // 高分优先：若超出上限，去掉低分项（但保留最后一条天劫决胜）
  let picked = uniq;
  if (uniq.length > 18) {
    picked = uniq
      .slice()
      .sort((a, b) => lines.find((l) => l.text === b.text)!.score - lines.find((l) => l.text === a.text)!.score)
      .slice(0, 18)
      .sort((a, b) => a.tick - b.tick);
  }
  return picked.map((l) => {
    const t = dayShichen(l.tick);
    return { day: t.day, shichen: t.shichen, text: l.text };
  });
}

// ================= 总结评语（summary） =================
const SCORE_TIERS: { min: number; name: string; pool: string[] }[] = [
  {
    min: 0,
    name: '凡铁之姿',
    pool: [
      '此剑出身凡铁，虽无惊天动地之能，却在剑域杀伐中挣得一线生机，已是难得。',
      '十日光景，此剑于夹缝中求生，资质平平，然剑心不屈。',
    ],
  },
  {
    min: 1500,
    name: '小有名气',
    pool: [
      '此剑于乱局中崭露头角，剑域之内小有名气，已非池中之物。',
      '剑道初成，名号初响——此剑将来可期。',
    ],
  },
  {
    min: 2200,
    name: '一代名剑',
    pool: [
      '万剑之中杀出一条血路，此剑已有名剑气象，足以青史留名。',
      '剑域诸剑，此其一也——一代名剑，当之无愧。',
    ],
  },
  {
    min: 3200,
    name: '惊世之作',
    pool: [
      '此剑横空出世，剑域上下为之侧目——惊世之作，万剑拜服。',
      '十日炼就如此神剑，堪称造化——惊世之作，实至名归。',
    ],
  },
];

function buildSummary(ctx: TaleCtx, score: number): string {
  const { champion, world, rng } = ctx;
  const tier = [...SCORE_TIERS].reverse().find((t) => score >= t.min) ?? SCORE_TIERS[0];
  const main = pick(tier.pool, rng);

  // 经历维度句（按显著性挑 2~3 句）
  const dims: string[] = [];
  const kills = world.chronicle.countBy('kill', champion.id);
  const age = champion.age;
  const total = Math.max(1, world.config.dayTickLimit * MAX_DAYS);
  const surviveRatio = age / total;
  const children = [...world.lineage.values()].filter((v) => v.parentId === champion.id).length;
  const affixes = champion.genome.affixes ?? [];
  const realm = champion.mindRealm ?? 0;
  const emerged = world.chronicle.count('emerge') > 0;

  const killPool =
    kills >= 8
      ? ['杀伐果决，剑下已收数道亡魂', '以战养战，愈战愈强']
      : kills >= 3
        ? ['历经杀伐，剑下不空']
        : ['杀性淡泊，剑下留情'];
  dims.push(pick(killPool, rng));
  if (surviveRatio >= 0.9) dims.push(pick(['历劫十日而不折', '十日剑域，几近全程见证'], rng));
  else if (surviveRatio < 0.5) {
    // v2.5.1：血脉后裔与外来半途剑区分表述——第五代剑子是「承先启后」而非「半途入局」
    dims.push(champion.generation >= 2
      ? pick(['承先启后，血脉薪传', '青出于蓝，后浪翻涌'], rng)
      : pick(['剑生于中道，虽晚犹成', '半途入局，终成大器'], rng));
  }
  if (children === 0) {
    // v2.5.1：孤剑文案按存续时长区分——中道入局者不说「走完十日」
    dims.push(surviveRatio >= 0.9
      ? pick(['一柄孤剑走完十日', '孤身一柄，见证十日风霜'], rng)
      : pick(['孑然一身，独步剑域', '孤身一柄，无枝可依'], rng));
  } else if (realm >= 2) dims.push(pick(['血脉绵延，剑潮有继', '膝下剑子成群，血脉昌盛'], rng));
  if (affixes.includes('poison')) dims.push(pick(['毒名在外，闻者辟易', '淬毒之剑，剑域皆惧'], rng));
  if (affixes.includes('parasite')) dims.push(pick(['噬魂之姿，化敌为子', '寄灵之剑，敌尽归麾下'], rng));
  if (realm === MIND_REALMS.length - 1) dims.push(pick(['已臻忘我，剑心通明', '忘我之境，剑域独一份'], rng));
  if (champion.survivedThunder) dims.push(pick(['雷劫余生，天眷之剑', '曾历天雷而不灭'], rng));
  if (emerged) dims.push(pick(['曾携血脉自成气候', '剑意成潮，蔚为大观'], rng));

  const pickedDims = dims.slice(0, 3);
  return `评曰：${main}${pickedDims.length > 0 ? '　' + pickedDims.join('，') + '。' : ''}`;
}

// ================= 完整纪事（chronicle 折叠区） =================
const CHRONICLE_TEXT: Record<string, (e: ChronicleEvent, ctx: TaleCtx) => string | null> = {
  birth: (e, ctx) => {
    const via = e.data?.via;
    const el = elementLabel(e.data?.element);
    switch (via) {
      case 'seed': return `本命剑胚诞生（${el}行第${e.data?.generation ?? 1}代）。`;
      case 'split': {
        // v2.5.1：说明分化来源（自第几代母剑）
        const parentGen = e.data?.parentId ? ctx.world.lineage.get(e.data.parentId)?.generation : undefined;
        const from = parentGen ? `自第${parentGen}代母剑` : '';
        return `${el}行第${e.data?.generation ?? 1}代剑子${from}分化而出。`;
      }
      case 'tide': return `剑潮降下${el}行游离剑意。`;
      case 'parasite': return `${el}行剑意被寄灵化为剑子。`;
      case 'reseed': return `${el}行本命剑胚重新种下。`;
      default: return `${el}行剑意诞生。`;
    }
  },
  split: (e) => {
    // v2.5.1：分化/寄灵（母剑视角）
    const el = elementLabel(e.data?.element);
    return e.data?.via === 'parasite'
      ? '寄灵化敌为剑子。'
      : `分化出第${e.data?.generation ?? '?'}代${el}行剑子。`;
  },
  kill: (e) => {
    // v2.5.1：按方式描述击败过程；不再提血亲
    const el = elementLabel(e.data?.element);
    switch (e.data?.cause) {
      case 'skill': return `以剑技击杀${el}行敌剑。`;
      case 'counter': return `以反震击杀${el}行敌剑。`;
      case 'thunder': return `借天雷轰杀${el}行敌剑。`;
      default: return `近身击杀${el}行敌剑。`;
    }
  },
  death: (e, ctx) => {
    const cause = e.data?.cause ?? 'wound';
    const el = elementLabel(e.data?.element ?? ctx.champion.genome.element);
    const text =
      cause === 'starve' ? '精元耗尽，饿毙于剑域' :
      cause === 'lava' ? '误入熔岩，剑体崩解' :
      cause === 'thunder' ? '被天雷轰杀' :
      cause === 'poison' ? '毒入剑体，溃烂而亡' :
      cause === 'burn' ? '烈火焚身，灰飞烟灭' :
      cause === 'counter' ? '反震之力透体，剑心崩碎' :
      cause === 'wound' ? '伤重不治，陨落尘埃' :
      '剑下陨落';
    return `${el}剑${text}。`;
  },
  promotion: (e) => `剑心晋入「${realmName(e.data?.realm)}」。`,
  affix: (e) => `悟得词条「${affixName(e.data?.affix ?? '')}」。`,
  mindSkill: (e) => {
    const skill = MIND_SKILL_BY_ID[e.data?.skillId ?? ''];
    return `悟得剑心绝技「${skill?.name ?? '？'}」。`;
  },
  encounter: () => '取得奇遇灵种，剑心境界提升。',
  thunderSurvive: () => '历天雷而存续（雷劫余生）。',
  nadir: () => '剑体濒崩，绝境逢生。',
  emerge: (e) => `剑意涌现，自成气候（${e.data?.population ?? '?'} 剑 · ${e.data?.gen ?? '?'} 代）。`,
  tribulation: (e) => `天劫收束，壁垒向内收缩（第 ${e.data?.ring ?? '?'} 圈）。`,
  feed: (e) => `你于剑域布霖 ${e.data?.count ?? 0} 团庚金之气。`,
  material: (e) => `炉府加入一件天材地宝。`,
  formation: (e) => {
    const brush = e.data?.brush ?? '';
    return brush === 'lava' ? '布下熔岩。' : brush === 'deepwater' ? '布下深水。' : brush === 'seed' ? '种下奇遇灵种。' : '清除地形。';
  },
  lightning: (e) => `你引下天雷，${e.data?.kills ?? 0} 道剑意灰飞烟灭。`,
  tide: (e) => {
    const kind = e.data?.id;
    const label = kind === 'mild' ? '温养之潮' : kind === 'tide' ? '剑潮汹涌' : kind === 'fierce' ? '天外凶潮' : kind === 'none' ? '静待天时' : '默许天意';
    return `剑潮择定：${label}。`;
  },
  reseed: () => '重种本命剑胚。',
};

function buildChronicle(ctx: TaleCtx): TaleLine[] {
  const out: TaleLine[] = [];
  const { champion } = ctx;
  for (const e of ctx.world.chronicle.all()) {
    // v2.6.0：完整纪事只收本命剑自身事件；玩家操作与其他剑、外界事件一律不写
    const mine = e.actorId === champion.id || e.targetId === champion.id;
    if (!mine) continue;
    // 同一击杀的「陨落」侧不再重复叙述（击破行已述）——消除「斩敌剑于剑下」与「敌剑剑下陨落」并存的双行与歧义
    if (e.kind === 'death' && e.targetId === champion.id) continue;
    // 本剑的出生不重复：birth 行已述，母剑视角的 split 行略去
    if (e.kind === 'split' && e.actorId !== champion.id) continue;
    const fn = CHRONICLE_TEXT[e.kind];
    const text = fn ? fn(e, ctx) : null;
    if (!text) continue;
    const t = dayShichen(e.tick);
    out.push({ day: t.day, shichen: t.shichen, text });
  }
  return out;
}

// ================= 主入口 =================
interface TaleCtx {
  champion: SwordState;
  world: World;
  lineage: Set<string>;
  /** v2.7.1：冠军血脉后裔集合（世界 lineage 中祖先链含冠军者） */
  descendants: Set<string>;
  rng: () => number;
}

/** 生成一篇剑谱（冠军 + 血统 + 全局戏剧）。name 为空则用「无名剑」占位。 */
export function writeSwordTale(
  world: World,
  champion: SwordState,
  runIndex: number,
  score: number,
  name?: string,
): SwordTaleData {
  // 冠军血统链（含自身，向上追溯祖辈）
  const lineage = new Set<string>();
  {
    let id = champion.id;
    let guard = 0;
    while (id && guard++ < 2000) {
      lineage.add(id);
      const info = world.lineage.get(id);
      if (!info || !info.parentId) break;
      id = info.parentId;
    }
  }
  // v2.7.1：冠军血脉后裔（向下追溯——祖先链含冠军的一切剑意）
  const descendants = new Set<string>();
  {
    for (const [id, node] of world.lineage) {
      if (id === champion.id) continue;
      let cur = node.parentId;
      let guard = 0;
      while (cur && guard++ < 2000) {
        if (cur === champion.id) {
          descendants.add(id);
          break;
        }
        const up = world.lineage.get(cur);
        if (!up || !up.parentId) break;
        cur = up.parentId;
      }
    }
  }
  const ctx: TaleCtx = {
    champion,
    world,
    lineage,
    descendants,
    rng: mulberry32(hashSeed(champion.id)),
  };
  const heroName = (name || '').trim() || '无名剑';
  return {
    title: `剑谱 · 第${runIndex}局`,
    heroName,
    element: champion.genome.element,
    prologue: buildPrologue(ctx),
    episodes: buildEpisodes(ctx),
    summary: buildSummary(ctx, score),
    chronicle: buildChronicle(ctx),
  };
}

/** 败局札记：天劫之下剑意尽灭时的短札（当场展示、不入档） */
export function writeDefeatNote(world: World): string {
  const ev = world.chronicle.all();
  const lastDeath = [...ev].reverse().find((e) => e.kind === 'death');
  // 本局杀神：kill 事件最多者
  const killerCounts = new Map<string, number>();
  for (const e of ev) {
    if (e.kind === 'kill' && e.actorId) killerCounts.set(e.actorId, (killerCounts.get(e.actorId) ?? 0) + 1);
  }
  let topKiller = '';
  let topKills = 0;
  for (const [id, n] of killerCounts) {
    if (n > topKills) {
      topKills = n;
      topKiller = id;
    }
  }
  const topInfo = topKiller ? world.lineage.get(topKiller) : null;
  const topLabel = topInfo
    ? `${elementLabel(topInfo.element)}行第${topInfo.generation}代剑意`
    : '某道剑意';
  const parts: string[] = [];
  if (lastDeath) {
    parts.push(
      `最后一道剑意于${timePrefix(lastDeath.tick)}陨落——${lastDeath.data?.cause === 'thunder' ? '为天雷所灭' : lastDeath.data?.cause === 'lava' ? '葬身熔岩' : lastDeath.data?.cause === 'starve' ? '精元耗尽' : '剑下陨落'}。`,
    );
  }
  if (topKiller) parts.push(`乱世之中，${topLabel}独领风骚，手刃 ${topKills} 敌，可惜未竟全功。`);
  parts.push('天意如此，非战之罪——且重整旗鼓，再炼一炉。');
  return parts.join('\n');
}
