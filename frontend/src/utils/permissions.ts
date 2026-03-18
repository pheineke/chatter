export type PermState = 'inherit' | 'allow' | 'deny'

/**
 * Determines the current permission state for a given bit.
 * 
 * @param allow - The allow bits integer
 * @param deny - The deny bits integer
 * @param bit - The permission bit to check
 * @returns 'deny' if the bit is set in deny, 'allow' if set in allow, otherwise 'inherit'
 */
export function getPermState(allow: number, deny: number, bit: number): PermState {
  if (deny & bit) return 'deny'
  if (allow & bit) return 'allow'
  return 'inherit'
}

/**
 * Cycles through permission states: inherit -> allow -> deny -> inherit
 */
export function cyclePermState(current: PermState): PermState {
  if (current === 'inherit') return 'allow'
  if (current === 'allow') return 'deny'
  return 'inherit'
}

/**
 * Updates allow/deny bits based on the new permission state.
 * 
 * @param allow - Current allow bits
 * @param deny - Current deny bits
 * @param bit - The permission bit being toggled
 * @param next - The desired next state
 * @returns Object containing new { allow_bits, deny_bits }
 */
export function applyPermState(allow: number, deny: number, bit: number, next: PermState) {
  let a = allow, d = deny
  // clear bit from both
  a &= ~bit
  d &= ~bit
  
  if (next === 'allow') a |= bit
  if (next === 'deny')  d |= bit
  
  return { allow_bits: a, deny_bits: d }
}
