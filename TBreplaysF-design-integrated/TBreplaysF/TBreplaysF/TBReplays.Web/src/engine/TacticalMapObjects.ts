/** Game collision proxies and distant scenery must not obscure tactical geometry. */
export function isTacticalDecoration(name: string): boolean {
  return /(^|[/_])(?:fog|sky|cloud|god_ray|rays|vista|vst|invis(?:ible)?(?:wall|collision)?)(?:[_./\d]|$)/i.test(name)
    || /^env_mars_(?:roof|main_dome_main_structure|dome_(?:\d+|glass|plate))(?:[_./\d]|$)/i.test(name);
}
