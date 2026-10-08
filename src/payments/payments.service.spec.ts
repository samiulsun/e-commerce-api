import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

interface MockPrisma {
  payment: { findUnique: jest.Mock; update: jest.Mock };
  order: {
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  product: { updateMany: jest.Mock };
  cartItem: { deleteMany: jest.Mock };
  $transaction: jest.Mock;
}

interface MockStripe {
  constructEvent: jest.Mock;
}

interface PaymentState {
  id: string;
  orderId: string;
  stripePaymentIntentId: string;
  status: string;
}

interface OrderState {
  id: string;
  userId: string;
  status: string;
  items: Array<{ id: string; productId: string; quantity: number }>;
}

function makeState() {
  const payments = new Map<string, PaymentState>();
  const orders = new Map<string, OrderState>();
  const stock = new Map<string, number>();
  return { payments, orders, stock };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: MockPrisma;
  let stripe: MockStripe;
  let state: ReturnType<typeof makeState>;

  beforeEach(() => {
    state = makeState();

    prisma = {
      payment: {
        findUnique: jest.fn((args: Prisma.PaymentFindUniqueArgs) => {
          const piId = (args.where as { stripePaymentIntentId: string })
            .stripePaymentIntentId;
          return Promise.resolve(state.payments.get(piId) ?? null);
        }),
        update: jest.fn((args: Prisma.PaymentUpdateArgs) => {
          const payment = [...state.payments.values()].find(
            (entry) => entry.id === (args.where as { id: string }).id,
          );
          if (payment) {
            Object.assign(payment, args.data);
          }
          return Promise.resolve(payment);
        }),
      },
      order: {
        findUnique: jest.fn((args: Prisma.OrderFindUniqueArgs) => {
          const order = state.orders.get((args.where as { id: string }).id);
          return Promise.resolve(order ? { ...order } : null);
        }),
        update: jest.fn((args: Prisma.OrderUpdateArgs) => {
          const order = state.orders.get((args.where as { id: string }).id);
          if (order) {
            Object.assign(order, args.data);
          }
          return Promise.resolve(order);
        }),
        updateMany: jest.fn((args: Prisma.OrderUpdateManyArgs) => {
          const order = state.orders.get((args.where as { id: string }).id);
          const requiredStatus = (args.where as { status?: string }).status;
          if (!order || (requiredStatus && order.status !== requiredStatus)) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(order, args.data);
          return Promise.resolve({ count: 1 });
        }),
      },
      product: {
        updateMany: jest.fn((args: Prisma.ProductUpdateManyArgs) => {
          const where = args.where as {
            id: string;
            stock: { gte: number };
          };
          const data = args.data as { stock: { decrement: number } };
          const current = state.stock.get(where.id) ?? 0;
          if (current < where.stock.gte) {
            return Promise.resolve({ count: 0 });
          }
          state.stock.set(where.id, current - data.stock.decrement);
          return Promise.resolve({ count: 1 });
        }),
      },
      cartItem: {
        deleteMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: MockPrisma) => Promise<unknown>)(prisma)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };

    stripe = {
      constructEvent: jest.fn(),
    };

    service = new PaymentsService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
      new ConfigService({ STRIPE_WEBHOOK_SECRET: 'whsec_test' }),
    );
  });

  function seedPendingOrder(
    orderId: string,
    userId: string,
    piId: string,
    items: Array<{ productId: string; quantity: number }>,
  ): void {
    state.orders.set(orderId, {
      id: orderId,
      userId,
      status: 'PENDING',
      items: items.map((item, index) => ({ id: `oi_${index}`, ...item })),
    });
    state.payments.set(piId, {
      id: `pay_${piId}`,
      orderId,
      stripePaymentIntentId: piId,
      status: 'PENDING',
    });
  }

  const intent = (id: string) => ({ id }) as unknown as Stripe.PaymentIntent;

  describe('verifyAndParse', () => {
    it('rejects 400 when the raw body or signature is missing', () => {
      expect(() => service.verifyAndParse(undefined, 'sig')).toThrow(
        BadRequestException,
      );
      expect(() =>
        service.verifyAndParse(Buffer.from('{}'), undefined),
      ).toThrow(BadRequestException);
    });

    it('rejects 400 when the signature does not verify', () => {
      stripe.constructEvent.mockImplementation(() => {
        throw new Error('signature mismatch');
      });

      expect(() =>
        service.verifyAndParse(Buffer.from('{}'), 'bad-signature'),
      ).toThrow(BadRequestException);
      expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    });

    it('returns the parsed event when the signature verifies', () => {
      const event = { id: 'evt_1' } as unknown as Stripe.Event;
      stripe.constructEvent.mockReturnValue(event);

      const result = service.verifyAndParse(Buffer.from('{}'), 'good');

      expect(result).toBe(event);
      expect(stripe.constructEvent).toHaveBeenCalledWith(
        Buffer.from('{}'),
        'good',
        'whsec_test',
      );
    });
  });

  describe('handleSucceeded', () => {
    it('marks the order PAID, decrements stock, clears the cart and records the payment', async () => {
      seedPendingOrder('order_1', 'user_1', 'pi_1', [
        { productId: 'prod_1', quantity: 2 },
      ]);
      state.stock.set('prod_1', 5);

      const handled = await service.handleSucceeded(intent('pi_1'));

      expect(handled).toBe(true);
      expect(state.orders.get('order_1')?.status).toBe('PAID');
      expect(state.stock.get('prod_1')).toBe(3);
      expect(state.payments.get('pi_1')?.status).toBe('SUCCEEDED');
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cart: { userId: 'user_1' } },
      });
    });

    it('is idempotent: a re-delivered event never decrements stock twice', async () => {
      seedPendingOrder('order_1', 'user_1', 'pi_1', [
        { productId: 'prod_1', quantity: 2 },
      ]);
      state.stock.set('prod_1', 5);

      await service.handleSucceeded(intent('pi_1'));
      const handledAgain = await service.handleSucceeded(intent('pi_1'));

      expect(handledAgain).toBe(true);
      expect(state.stock.get('prod_1')).toBe(3);
      expect(state.orders.get('order_1')?.status).toBe('PAID');
      expect(prisma.product.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.cartItem.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('ignores payment intents that are not ours', async () => {
      const handled = await service.handleSucceeded(intent('pi_unknown'));

      expect(handled).toBe(false);
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it('cannot decrement below zero: the whole transaction rolls back', async () => {
      seedPendingOrder('order_1', 'user_1', 'pi_1', [
        { productId: 'prod_1', quantity: 2 },
      ]);
      state.stock.set('prod_1', 1);

      const promise = service.handleSucceeded(intent('pi_1'));
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      expect(state.orders.get('order_1')?.status).toBe('PENDING');
      expect(state.payments.get('pi_1')?.status).toBe('PENDING');
      expect(state.stock.get('prod_1')).toBe(1);
    });

    it('two simultaneous checkout webhooks for the last unit: exactly one succeeds', async () => {
      seedPendingOrder('order_1', 'user_1', 'pi_1', [
        { productId: 'prod_1', quantity: 1 },
      ]);
      seedPendingOrder('order_2', 'user_2', 'pi_2', [
        { productId: 'prod_1', quantity: 1 },
      ]);
      state.stock.set('prod_1', 1);

      const results = await Promise.allSettled([
        service.handleSucceeded(intent('pi_1')),
        service.handleSucceeded(intent('pi_2')),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(state.stock.get('prod_1')).toBe(0);
      const paid = [...state.orders.values()].filter(
        (order) => order.status === 'PAID',
      );
      const pending = [...state.orders.values()].filter(
        (order) => order.status === 'PENDING',
      );
      expect(paid).toHaveLength(1);
      expect(pending).toHaveLength(1);
    });
  });

  describe('handleFailed', () => {
    it('marks a pending order FAILED and the payment FAILED without touching stock or cart', async () => {
      seedPendingOrder('order_1', 'user_1', 'pi_1', [
        { productId: 'prod_1', quantity: 2 },
      ]);
      state.stock.set('prod_1', 5);

      const handled = await service.handleFailed(intent('pi_1'));

      expect(handled).toBe(true);
      expect(state.orders.get('order_1')?.status).toBe('FAILED');
      expect(state.payments.get('pi_1')?.status).toBe('FAILED');
      expect(state.stock.get('prod_1')).toBe(5);
      expect(prisma.cartItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.product.updateMany).not.toHaveBeenCalled();
    });

    it('never downgrades an already paid order', async () => {
      seedPendingOrder('order_1', 'user_1', 'pi_1', [
        { productId: 'prod_1', quantity: 1 },
      ]);
      state.orders.get('order_1')!.status = 'PAID';
      state.payments.get('pi_1')!.status = 'SUCCEEDED';

      const handled = await service.handleFailed(intent('pi_1'));

      expect(handled).toBe(false);
      expect(state.orders.get('order_1')?.status).toBe('PAID');
      expect(state.payments.get('pi_1')?.status).toBe('SUCCEEDED');
    });

    it('ignores unknown payment intents', async () => {
      const handled = await service.handleFailed(intent('pi_unknown'));

      expect(handled).toBe(false);
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('handleEvent', () => {
    it('routes succeeded and failed events; ignores other event types', async () => {
      seedPendingOrder('order_1', 'user_1', 'pi_1', [
        { productId: 'prod_1', quantity: 1 },
      ]);
      state.stock.set('prod_1', 3);

      const succeeded = await service.handleEvent({
        type: 'payment_intent.succeeded',
        data: { object: intent('pi_1') },
      } as unknown as Stripe.Event);
      expect(succeeded).toEqual({ received: true, handled: true });
      expect(state.orders.get('order_1')?.status).toBe('PAID');

      const failed = await service.handleEvent({
        type: 'payment_intent.payment_failed',
        data: { object: intent('pi_2') },
      } as unknown as Stripe.Event);
      expect(failed).toEqual({ received: true, handled: false });

      const ignored = await service.handleEvent({
        type: 'charge.refunded',
        data: { object: {} },
      } as unknown as Stripe.Event);
      expect(ignored).toEqual({ received: true, handled: false });
    });
  });
});
