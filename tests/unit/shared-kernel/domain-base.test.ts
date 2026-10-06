import { describe, expect, it } from 'vitest';
import { AggregateRoot, Entity, ValueObject, type DomainEvent } from '../../../src/modules/00-shared-kernel/public';

class Thing extends Entity<string> {
  static create(id: string) { return new Thing(id); }
}
class Other extends Entity<string> {
  static create(id: string) { return new Other(id); }
}
class Money extends ValueObject<{ amount: number; at: Date }> {
  static of(amount: number, at: Date) { return new Money({ amount, at }); }
}
class Order extends AggregateRoot<string> {
  static create(id: string) { return new Order(id); }
  place(): void {
    const event: DomainEvent = {
      eventId: 'e1', eventType: 'OrderPlaced', occurredAt: new Date(0),
      aggregateType: 'Order', aggregateId: this.id, payload: {},
    };
    this.addDomainEvent(event);
  }
}

describe('Entity', () => {
  it('equals by type and id', () => {
    expect(Thing.create('a').equals(Thing.create('a'))).toBe(true);
    expect(Thing.create('a').equals(Thing.create('b'))).toBe(false);
    expect(Thing.create('a').equals(Other.create('a'))).toBe(false);
  });
});

describe('ValueObject', () => {
  it('is structurally equal, including dates', () => {
    expect(Money.of(5, new Date(1000)).equals(Money.of(5, new Date(1000)))).toBe(true);
    expect(Money.of(5, new Date(1000)).equals(Money.of(6, new Date(1000)))).toBe(false);
  });
});

describe('AggregateRoot', () => {
  it('records events and clears them when pulled', () => {
    const o = Order.create('o1');
    o.place();
    expect(o.pullDomainEvents()).toHaveLength(1);
    expect(o.pullDomainEvents()).toHaveLength(0);
  });
});
