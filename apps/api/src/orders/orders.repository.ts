import type { OrderStatus } from '@timeletter/shared';

export interface OrderRecord {
  id: string;
  userId: string;
  letterId: string;
  /** 单位：分。payment_enabled=false 时为 0（不收款托管） */
  amountCents: number;
  status: OrderStatus;
  createdAt: Date;
}

export interface OrderRepository {
  create(order: OrderRecord): Promise<OrderRecord>;
  findById(id: string): Promise<OrderRecord | null>;
  findByLetterId(letterId: string): Promise<OrderRecord | null>;
  listByUser(userId: string): Promise<OrderRecord[]>;
}

/** 开发期内存实现；PostgreSQL 适配器 Sprint 1.2 接入（接口保持不变） */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly store = new Map<string, OrderRecord>();

  async create(order: OrderRecord): Promise<OrderRecord> {
    this.store.set(order.id, structuredClone(order));
    return structuredClone(order);
  }

  async findById(id: string): Promise<OrderRecord | null> {
    const order = this.store.get(id);
    return order ? structuredClone(order) : null;
  }

  async findByLetterId(letterId: string): Promise<OrderRecord | null> {
    const order = [...this.store.values()].find((item) => item.letterId === letterId);
    return order ? structuredClone(order) : null;
  }

  async listByUser(userId: string): Promise<OrderRecord[]> {
    return [...this.store.values()]
      .filter((order) => order.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((order) => structuredClone(order));
  }
}
