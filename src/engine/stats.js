// StageCloset engine: dashboard stats.

import { openCheckouts, overdue } from './checkout.js';

export function dashboard(state, asOf) {
  const active = state.items.filter(i => !i.retired);
  const totalValueCents = active.reduce((s, i) => s + i.valueCents, 0);

  const open = openCheckouts(state);
  let outValueCents = 0;
  for (const c of open) {
    const item = state.items.find(i => i.id === c.itemId);
    if (item) outValueCents += item.valueCents;
  }

  const byCategory = {};
  for (const i of active) {
    byCategory[i.category] = (byCategory[i.category] || 0) + 1;
  }

  const byCondition = {};
  for (const i of active) {
    byCondition[i.condition] = (byCondition[i.condition] || 0) + 1;
  }

  const repairList = active.filter(i => i.condition === 'needs repair');

  return {
    itemCount: active.length,
    retiredCount: state.items.length - active.length,
    totalValueCents,
    outCount: open.length,
    outValueCents,
    overdueList: overdue(state, asOf),
    byCategory,
    byCondition,
    repairList,
    productionCount: state.productions.filter(p => p.status !== 'closed').length
  };
}
