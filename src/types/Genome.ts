/** 五行倾向 */
export type Element = 'metal' | 'wood' | 'water' | 'fire' | 'earth';

/**
 * 剑谱 (基因)：数值型性状，可遗传、可突变。
 */
export interface Genome {
  /** 锋锐 [0.1, 10] —— 决定攻击力 */
  sharpness: number;
  /** 坚韧 [0.1, 10] —— 决定防御力 */
  toughness: number;
  /** 速度 [0.1, 10] —— 影响能量消耗 */
  speed: number;
  /** 感知 [0.1, 10] —— 影响视野范围 (perception*2 格) */
  perception: number;
  /** 攻击欲望 [0, 1] —— 火行剑意初始偏高，影响本能决策 */
  aggression: number;
  /** 策略 [0, 1] —— 低为孤狼(独来独往)，高为合击(喜集群行动) */
  strategy: number;
  /** 五行属性 */
  element: Element;
  /** 词条 (悟得后固化，可遗传) */
  affixes: string[];
}
