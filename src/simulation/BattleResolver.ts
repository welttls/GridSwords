import type { SwordAgent } from './SwordAgent';
import { MAX_HP, KILL_HEAL_PCT, MIND_REALM_DMG_REDUCTION } from '../constants';

export interface BattleResult {
  damage: number;
  /** 防守方死亡 */
  defenderDied: boolean;
  /** 进攻方反震伤害 */
  recoil: number;
}

/**
 * 战斗判定 (瞬间结算)。
 * 伤害 = max(1, 攻击方攻伐 - 防守方坚韧*0.5)
 * 闪避：两边比感知，守方感知高于攻方则有几率避开来剑 (感知差 → 闪避率)
 * 防守方死亡 → 进攻方获得其 50% 能量
 * 防守方存活 → 进攻方退回原位并损失少量生命 (反震)
 */
export function resolveBattle(attacker: SwordAgent, defender: SwordAgent): BattleResult {
  // 感知闪避：守方感知高于攻方，差值决定避开来剑的几率
  const dodge = Math.max(0, Math.min(0.35, (defender.effectivePerception() - attacker.effectivePerception()) * 0.04 + 0.05));
  if (Math.random() < dodge) {
    // 闪避成功：来剑落空，攻方扑空受轻微反震，碰撞精元照耗，守方得后手反击之势
    attacker.state.energy -= 2;
    defender.state.energy -= 1;
    defender.behavior.fightsSurvived++;
    defender.counterReady = true;
    attacker.state.hp -= 0.5; // 扑空反震，不 clamp 回 1（残血不再“回血”）
    return { damage: 0, defenderDied: false, recoil: 0.5 };
  }

  const atk = attacker.effectiveSharpness();
  const def = defender.effectiveToughness();
  // v2.0.0：伤害公式——保底「攻伐×0.35」+ 减伤系数 0.4：低攻伐(木/土/水 攻5)对常态坚韧 5-6 也能打 3 点、可积累击杀；高攻伐(火8)仍爆发
  let damage = Math.max(1, Math.max(Math.ceil(atk * 0.35), atk - def * 0.4));
  // v2.0.0：追击压制——锁定目标时伤害 +30%（破绽压制，乘胜追击）
  if (attacker.huntTargetId === defender.state.id) damage = Math.max(1, Math.round(damage * 1.3));
  // 磐石护/百炼守 buff：受击减免
  if (defender.state.buffDefMult) damage = Math.max(1, Math.round(damage * (1 / (1 + defender.state.buffDefMult * 0.5))));
  // v2.1.0：剑心等级免伤——高境对低境攻击者，每境差免伤 12%（通明对凡心 -12%、洞玄对凡心 -24%、忘我对凡心 -36%）
  // 只影响伤害，不动反震（反震仍按原伤害计算）；水系柔克刚 15% 已于 v2.1.0 移除（食物效率已够立足）
  const realmGap = (defender.state.mindRealm ?? 0) - (attacker.state.mindRealm ?? 0);
  if (realmGap > 0) damage = Math.max(1, Math.round(damage * (1 - realmGap * MIND_REALM_DMG_REDUCTION)));

  // 碰撞亦耗精元：出招耗神，受击损元
  attacker.state.energy -= 2;
  defender.state.energy -= 1;

  defender.state.hp -= damage;
  defender.behavior.fightsSurvived++;

  if (defender.state.hp <= 0) {
    const gained = defender.state.energy * 0.5;
    attacker.state.energy += gained;
    // v2.1.0：以战养战——击杀回血 15% 上限（原 +5 固定），胜者不再轻易被捡漏
    attacker.state.hp = Math.min(MAX_HP, attacker.state.hp + Math.round(MAX_HP * KILL_HEAL_PCT));
    return { damage, defenderDied: true, recoil: 0 };
  }

  // v2.0.0：木系「毒木反噬」——淬毒木剑被攻击时，攻击者反中毒（木系温和不追杀，靠毒反噬磨敌，被动击杀路径）
  if (defender.state.genome.element === 'wood' && defender.state.genome.affixes.includes('poison') && !(attacker.state.poisonTicks ?? 0 > 0)) {
    attacker.state.poisonDmg = 2;
    attacker.state.poisonTicks = 36;
  }

  defender.counterReady = true; // 后手反击蓄势
  // v2.0.0：追击压制——锁定目标追击时反震减半（乘胜追击、压制敌势），让追击者能磨死目标而非先被反震磨死
  const hunting = attacker.huntTargetId === defender.state.id;
  // v2.0.0：土系「厚土反震」——厚土反弹来剑：反震按伤害 80% 且不受追击减半（近战克星）；反震磨死攻击者计入土系击破（被动击杀/晋升路径）
  const isEarth = defender.state.genome.element === 'earth';
  const recoil = isEarth
    ? Math.max(0.5, damage * 0.8)
    : Math.max(hunting ? 0.25 : 0.5, damage * 0.3 * (hunting ? 0.5 : 1));
  attacker.state.hp -= recoil;
  // 土系反震致死：反震磨死攻击者 → 土系计击破（与剑心晋升联动）
  if (isEarth && attacker.state.hp <= 0 && defender.state.hp > 0) {
    defender.behavior.killCount++;
  }
  attacker.state.energy -= damage * 0.2; // 出招亦耗神
  return { damage, defenderDied: false, recoil };
}
