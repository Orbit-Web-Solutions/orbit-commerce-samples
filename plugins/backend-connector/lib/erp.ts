/**
 * The system on the other side of the sync.
 *
 * This is the seam you replace. Everything else in this sample is Orbit's half
 * of the contract and should port more or less unchanged; this file is a stub
 * standing in for your ERP, WMS, accounting package or whatever you are
 * connecting.
 */

export interface ErpOrder {
  externalId: string;
  reference: string;
  status: string;
  total: number;
}

export interface ErpStockLevel {
  sku: string;
  quantity: number;
}

export interface ErpClient {
  upsertOrder(order: ErpOrder): Promise<void>;
  stockLevels(): Promise<ErpStockLevel[]>;
}

/**
 * An in-memory stand-in so the sample runs end to end with nothing installed.
 * Swap in a real client and the rest of the connector is unchanged.
 */
export class InMemoryErpClient implements ErpClient {
  readonly orders = new Map<string, ErpOrder>();

  constructor(private readonly stock: ErpStockLevel[] = []) {}

  async upsertOrder(order: ErpOrder): Promise<void> {
    // Keyed by the Orbit order id, so replaying a sync window updates rather
    // than duplicating. Idempotency on your side is what makes it safe to
    // re-run a failed pass.
    this.orders.set(order.externalId, order);
  }

  async stockLevels(): Promise<ErpStockLevel[]> {
    return this.stock;
  }
}
