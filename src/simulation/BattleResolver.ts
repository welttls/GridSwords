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
 * 防守方死亡 → 进攻方获得其 50% 能量
 * 防守方存活 → 进攻方退回原位并损失少量生命 (反震)
 */
export function resolveBattle(attacker: SwordAgent, defender: SwordAgent): BattleResult {
  const atk = attacker.effectiveSharpness();
  const def = defender.effectiveToughness();
  const damage = Math.max(1, atk - def * 0.5);

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
