import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StripeService } from '../payments/stripe.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';

interface MockPrisma {
  cart: { findUnique: jest.Mock };
  order: {
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
  };
  payment: { create: jest.Mock };
  $transaction: jest.Mock;
}

interface MockStripe {
  createPaymentIntent: jest.Mock;
}

function firstCallArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0][0] as T;
}

const product = {
  id: 'prod_1',
  name: 'Headphones',
  description: 'Noise cancelling',
  priceCents: 2500,
  sku: 'ELE-001',
  stock: 5,
  categoryId: 'cat_1',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function cartWith(quantity: number, overrides: Partial<typeof product> = {}) {
  return {
    id: 'cart_1',
    userId: 'user_1',
    items: [
      {
        id: 'item_1',
        cartId: 'cart_1',
        productId: 'prod_1',
        quantity,
        product: { ...product, ...overrides },
      },
    ],
  };
}

const createdOrder = {
  id: 'order_1',
  userId: 'user_1',
  status: 'PENDING',
  totalCents: 5000,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  items: [],
  payment: null,
};

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: MockPrisma;
  let stripe: MockStripe;

  beforeEach(() => {
    prisma = {
      cart: { findUnique: jest.fn() },
      order: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
      },
      payment: { create: jest.fn() },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: MockPrisma) => Promise<unknown>)(prisma)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };
    stripe = { createPaymentIntent: jest.fn() };
    service = new OrdersService(
      prisma as unknown as PrismaService,
      stripe as unknown as StripeService,
    );
    prisma.order.update.mockResolvedValue({});
    prisma.payment.create.mockResolvedValue({});
  });

  describe('checkout', () => {
    it('rejects an empty cart with 400 before touching Stripe', async () => {
      prisma.cart.findUnique.mockResolvedValue(null);

      await expect(service.checkout('user_1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();

      prisma.cart.findUnique.mockResolvedValue({
        ...cartWith(1),
        items: [],
      });
      await expect(service.checkout('user_1')).rejects.toThrow('Cart is empty');
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive product in the cart with 400', async () => {
      prisma.cart.findUnique.mockResolvedValue(
        cartWith(1, { isActive: false }),
      );

      const promise = service.checkout('user_1');
      await expect(promise).rejects.toMatchObject({
        response: {
          message: expect.arrayContaining([
            expect.stringContaining('no longer available'),
          ]) as unknown,
        },
      });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects insufficient stock with 400 and never creates an order', async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWith(6, { stock: 5 }));

      const promise = service.checkout('user_1');
      await expect(promise).rejects.toMatchObject({
        response: {
          message: expect.arrayContaining([
            expect.stringContaining(
              'Requested quantity 6 of Headphones exceeds available stock 5',
            ),
          ]) as unknown,
        },
      });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('creates a PENDING order with price snapshots, a PaymentIntent and a Payment row', async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWith(2));
      prisma.order.create.mockResolvedValue(createdOrder);
      stripe.createPaymentIntent.mockResolvedValue({
        id: 'pi_1',
        clientSecret: 'pi_secret_1',
        currency: 'usd',
        status: 'requires_payment_method',
      });

      const result = await service.checkout('user_1');

      const createArgs = firstCallArg<Prisma.OrderCreateArgs>(
        prisma.order.create,
      );
      expect(createArgs.data).toMatchObject({
        userId: 'user_1',
        status: 'PENDING',
        totalCents: 5000,
      });
      const nested = createArgs.data.items as {
        create: Array<{
          productId: string;
          quantity: number;
          priceAtPurchaseCents: number;
        }>;
      };
      expect(nested.create).toEqual([
        { productId: 'prod_1', quantity: 2, priceAtPurchaseCents: 2500 },
      ]);

      expect(stripe.createPaymentIntent).toHaveBeenCalledWith({
        amountCents: 5000,
        currency: 'usd',
        metadata: { orderId: 'order_1', userId: 'user_1' },
        idempotencyKey: 'checkout-order_1',
      });

      const paymentArgs = firstCallArg<Prisma.PaymentCreateArgs>(
        prisma.payment.create,
      );
      expect(paymentArgs.data).toMatchObject({
        orderId: 'order_1',
        stripePaymentIntentId: 'pi_1',
        status: 'PENDING',
        amountCents: 5000,
        currency: 'usd',
      });

      expect(result).toEqual({
        orderId: 'order_1',
        clientSecret: 'pi_secret_1',
        amountCents: 5000,
        currency: 'usd',
      });
    });

    it('marks the order FAILED and returns 502 when Stripe fails', async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWith(2));
      prisma.order.create.mockResolvedValue(createdOrder);
      stripe.createPaymentIntent.mockRejectedValue(new Error('stripe down'));

      await expect(service.checkout('user_1')).rejects.toBeInstanceOf(
        BadGatewayException,
      );

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order_1' },
        data: { status: 'FAILED' },
      });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('marks the order FAILED when Stripe returns no client secret', async () => {
      prisma.cart.findUnique.mockResolvedValue(cartWith(2));
      prisma.order.create.mockResolvedValue(createdOrder);
      stripe.createPaymentIntent.mockResolvedValue({
        id: 'pi_1',
        clientSecret: null,
        currency: 'usd',
        status: 'requires_payment_method',
      });

      await expect(service.checkout('user_1')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order_1' },
        data: { status: 'FAILED' },
      });
    });
  });

  describe('findAllForUser', () => {
    it('scopes the query to the caller and returns the pagination envelope', async () => {
      prisma.order.findMany.mockResolvedValue([createdOrder]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.findAllForUser('user_1', {});

      const args = firstCallArg<Prisma.OrderFindManyArgs>(
        prisma.order.findMany,
      );
      expect(args.where).toEqual({ userId: 'user_1' });
      expect(result).toEqual({
        data: [createdOrder],
        total: 1,
        skip: 0,
        take: 20,
      });
    });
  });

  describe('findOneForUser', () => {
    it('404s for an order the caller does not own', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.findOneForUser('user_1', 'order_9'),
      ).rejects.toBeInstanceOf(NotFoundException);

      const args = firstCallArg<Prisma.OrderFindFirstArgs>(
        prisma.order.findFirst,
      );
      expect(args.where).toEqual({ id: 'order_9', userId: 'user_1' });
    });

    it('returns the owned order with items and payment', async () => {
      prisma.order.findFirst.mockResolvedValue(createdOrder);

      const result = await service.findOneForUser('user_1', 'order_1');
      expect(result).toEqual(createdOrder);
    });
  });
});
