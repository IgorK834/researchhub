/** Metadata is dropped first at the desktop breakpoint; selection/name/action columns remain. */
export function visibleTableColumns<
  Column extends { readonly priority?: 'essential' | 'metadata' },
>(columns: readonly Column[], narrow: boolean): readonly Column[] {
  return narrow ? columns.filter((column) => column.priority !== 'metadata') : columns;
}
