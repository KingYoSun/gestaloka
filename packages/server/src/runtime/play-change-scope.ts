import type { Change } from "@gestaloka/contracts";
import { changeScope, matchesChangeScope } from "../world/change-scope.js";
import { atTime } from "../world/model.js";
import {
  WorldConflict,
  type WorldContext,
  type WorldStore,
} from "../world/store.js";

export type DirectChangeScope = string;
export class PlayScopeConflict extends WorldConflict {}

export function directChangeScope(changes: Change): DirectChangeScope {
  // 受領後は成立時点だけを動かせる。状態の期間の長さは照合に含める。
  return changeScope(atTime(changes, 0, true));
}

export function assertDirectChanges(scope: DirectChangeScope, changes: Change) {
  assertPlayScope(scope, atTime(changes, 0, true));
}

export function assertPlayScope(scope: string, value: unknown) {
  if (!matchesChangeScope(scope, value))
    throw new PlayScopeConflict(
      "確定する変更が許可された申請の範囲と一致しません",
    );
}

export function commitPlayChange(
  store: WorldStore,
  lease: Parameters<WorldStore["commit"]>[0],
  context: WorldContext,
  input: Parameters<WorldStore["commit"]>[2] & { changes: Change },
  scope: DirectChangeScope,
  fromBelongingOperations?: boolean,
  reservations?: Parameters<WorldStore["commit"]>[4],
) {
  assertDirectChanges(scope, input.changes);
  return store.commit(
    lease,
    context,
    input,
    fromBelongingOperations,
    reservations,
  );
}
