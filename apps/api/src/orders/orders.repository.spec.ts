import { describe, expect, it } from 'vitest';
import { InMemoryOrderRepository, type OrderRecord } from './orders.repository';

const NOW = new Date('2026-09-30T10:00:00.000Z');

function orderOf(id: string, userId: string, letterId: string, amountCents: number): OrderRecord {
  return {
    id,
    userId,
    letterId,
    amountCents,
    status: amountCents === 0 ? 'no_payment_required' : 'pending_payment',
    createdAt: NOW,
  };
}

describe('InMemoryOrderRepository', () => {
  it('create 后可按 id 与信笺 id 读回', async () => {
    const repository = new InMemoryOrderRepository();
    const created = await repository.create(orderOf('order_1', 'u1', 'letter_1', 0));
    expect(created.status).toBe('no_payment_required');
    expect(await repository.findById('order_1')).toEqual(created);
    expect(await repository.findByLetterId('letter_1')).toMatchObject({ id: 'order_1' });
    expect(await repository.findById('order_missing')).toBeNull();
    expect(await repository.findByLetterId('letter_missing')).toBeNull();
  });

  it('listByUser 只返回本人订单，并按创建时间倒序', async () => {
    const repository = new InMemoryOrderRepository();
    const older = orderOf('order_old', 'u1', 'letter_old', 990);
    await repository.create({ ...older, createdAt: new Date('2026-09-01T00:00:00.000Z') });
    await repository.create(orderOf('order_new', 'u1', 'letter_new', 0));
    await repository.create(orderOf('order_other', 'u2', 'letter_other', 0));

    const mine = await repository.listByUser('u1');
    expect(mine.map((order) => order.id)).toEqual(['order_new', 'order_old']);
    expect(await repository.listByUser('u_missing')).toEqual([]);
  });

  it('返回值为副本：外部改写不污染仓储内部状态', async () => {
    const repository = new InMemoryOrderRepository();
    await repository.create(orderOf('order_1', 'u1', 'letter_1', 0));
    const leaked = await repository.findById('order_1');
    expect(leaked).not.toBeNull();
    leaked!.amountCents = 99999;
    leaked!.status = 'pending_payment';
    expect(await repository.findById('order_1')).toMatchObject({
      amountCents: 0,
      status: 'no_payment_required',
    });
  });
});
