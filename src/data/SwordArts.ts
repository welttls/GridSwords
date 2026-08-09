export interface SwordArt {
  id: string;
  name: string;
  description: string;
  /** 需要解锁的材料 id，undefined 表示默认拥有 */
  requireMaterial?: string;
}

/** 剑诀 (一次性战术指令，宗门大比战前选择) */
export const SWORD_ARTS: SwordArt[] = [
  { id: 'none', name: '中正平和', description: '不施剑诀，以本色迎战。' },
  { id: 'strike', name: '首轮抢攻', description: '开局前 50 回合攻击力 +20%。' },
  { id: 'counter', name: '后手反击', description: '受击后，下一次攻击伤害 +50%。' },
  { id: 'agile', name: '游斗', description: '身法灵动，能耗降低，但攻击力 -10%。' },
  { id: 'quick', name: '快剑', description: '剑势与身法同辉：攻击 +10%、能耗 -20%。', requireMaterial: 'fast_sword' },
  { id: 'thunder', name: '雷引', description: '引动雷劫之力，攻击附带雷威。', requireMaterial: 'thunder_potion' },
];
