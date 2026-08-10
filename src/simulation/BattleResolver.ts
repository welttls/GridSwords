import type { SwordAgent } from './SwordAgent';
import { MAX_HP } from '../constants';

export interface BattleResult {
  damage: number;
  /** 防守方死亡 */
  defenderDied: boolean;
  /** 进攻方反震伤害 */
  recoil: number;
}

/**
 * 战斗判定 (瞬间结算)。
 * 伤害 = max(1, 攻击方锋锐 - 防守方坚韧*0.5)
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
  let damage = Math.max(1, atk - def * 0.5);
  // 磐石护/百炼守 buff：受击减免
  if (defender.state.buffDefMult) damage = Math.max(1, Math.round(damage * (1 / (1 + defender.state.buffDefMult * 0.5))));

  // 碰撞亦耗精元：出招耗神，受击损元
  attacker.state.energy -= 2;
  defender.state.energy -= 1;

  defender.state.hp -= damage;
  defender.behavior.fightsSurvived++;

  if (defender.state.hp <= 0) {
    const gained = defender.state.energy * 0.5;
    attacker.state.energy += gained;
    attacker.state.hp = Math.min(MAX_HP, attacker.state.hp + 5); // 以战养战，胜者回气
    return { damage, defenderDied: true, recoil: 0 };
  }

  defender.counterReady = true; // 后手反击蓄势
  const recoil = Math.max(0.5, damage * 0.3);
  attacker.state.hp -= recoil;
  attacker.state.energy -= damage * 0.2; // 出招亦耗神
  return { damage, defenderDied: false, recoil };
}
