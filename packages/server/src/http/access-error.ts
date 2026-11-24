import type { BlockingState } from "@gestaloka/contracts";

export class AccessError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 503,
    readonly code: string,
    message: string,
    // プレイ操作の拒否に付ける、現在の手番で使った通常枠の数。
    readonly callsUsed?: number,
    readonly inventory?: Pick<
      import("../world/inventory.js").InventoryCapacityExceeded,
      "capacity" | "item"
    >,
    readonly blockingStates?: BlockingState[],
  ) {
    super(message);
  }
}
