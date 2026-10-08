import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from './cart.service';

interface MockPrisma {
  cart: {
    upsert: jest.Mock;
  };
  cartItem: {
    upsert: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    deleteMany: jest.Mock;
  };
  product: {
    findFirst: jest.Mock;
  };
  $transaction: jest.Mock;
}

function firstCallArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0][0] as T;
}

const product = {
  id: 'prod_1',
  name: 'Headphones',
  description: 'Noise cancelling',
  priceCents: 19999,
  sku: 'ELE-001',
  stock: 5,
  categoryId: 'cat_1',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function cartWith(
  items: Array<{
    id: string;
    cartId: string;
    productId: string;
    quantity: number;
    product: typeof product;
  }>,
) {
  return { id: 'cart_1', userId: 'user_1', items };
}

function cartItem(
  overrides: Partial<ReturnType<typeof cartWith>['items'][number]> = {},
) {
  return {
    id: 'item_1',
    cartId: 'cart_1',
    productId: 'prod_1',
    quantity: 1,
    product,
    ...overrides,
  };
}

describe('CartService', () => {
  let service: CartService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = {
      cart: { upsert: jest.fn() },
      cartItem: {
        upsert: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      product: { findFirst: jest.fn() },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: MockPrisma) => Promise<unknown>)(prisma)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };
    service = new CartService(prisma as unknown as PrismaService);
  });

  describe('getCart', () => {
    it('creates the cart lazily and returns a zeroed envelope', async () => {
      prisma.cart.upsert.mockResolvedValue(cartWith([]));

      const result = await service.getCart('user_1');

      const args = firstCallArg<Prisma.CartUpsertArgs>(prisma.cart.upsert);
      expect(args.where).toEqual({ userId: 'user_1' });
      expect(args.create).toEqual({ userId: 'user_1' });
      expect(result).toEqual({
        id: 'cart_1',
        items: [],
        subtotalCents: 0,
        itemCount: 0,
      });
    });

    it('computes line totals and the subtotal from live product prices', async () => {
      prisma.cart.upsert.mockResolvedValue(
        cartWith([
          cartItem({ quantity: 2 }),
          cartItem({
            id: 'item_2',
            productId: 'prod_2',
            quantity: 3,
            product: {
              ...product,
              id: 'prod_2',
              sku: 'ELE-002',
              priceCents: 500,
            },
          }),
        ]),
      );

      const result = await service.getCart('user_1');

      expect(result.items[0]).toMatchObject({
        id: 'item_1',
        quantity: 2,
        lineTotalCents: 2 * 19999,
      });
      expect(result.items[1]).toMatchObject({
        id: 'item_2',
        lineTotalCents: 3 * 500,
      });
      expect(result.subtotalCents).toBe(2 * 19999 + 3 * 500);
      expect(result.itemCount).toBe(5);
    });
  });

  describe('addItem', () => {
    it('404s for a missing or inactive product and never touches the cart items', async () => {
      prisma.cart.upsert.mockResolvedValue(cartWith([]));
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.addItem('user_1', { productId: 'nope', quantity: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const findArgs = firstCallArg<Prisma.ProductFindFirstArgs>(
        prisma.product.findFirst,
      );
      expect(findArgs.where).toEqual({ id: 'nope', isActive: true });
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('upserts with an atomic increment rather than duplicating the line item', async () => {
      prisma.cart.upsert.mockResolvedValue(cartWith([]));
      prisma.product.findFirst.mockResolvedValue(product);
      prisma.cartItem.upsert.mockResolvedValue(cartItem({ quantity: 2 }));

      await service.addItem('user_1', { productId: 'prod_1', quantity: 2 });

      const args = firstCallArg<Prisma.CartItemUpsertArgs>(
        prisma.cartItem.upsert,
      );
      expect(args.where).toEqual({
        cartId_productId: { cartId: 'cart_1', productId: 'prod_1' },
      });
      expect(args.create).toEqual({
        cartId: 'cart_1',
        productId: 'prod_1',
        quantity: 2,
      });
      expect(args.update).toEqual({ quantity: { increment: 2 } });
    });

    it('rejects with 400 when the resulting quantity exceeds stock (never clamps)', async () => {
      prisma.cart.upsert.mockResolvedValue(cartWith([]));
      prisma.product.findFirst.mockResolvedValue({ ...product, stock: 3 });
      prisma.cartItem.upsert.mockResolvedValue(cartItem({ quantity: 5 }));

      await expect(
        service.addItem('user_1', { productId: 'prod_1', quantity: 5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects with 400 including the available stock in the message', async () => {
      prisma.cart.upsert.mockResolvedValue(cartWith([]));
      prisma.product.findFirst.mockResolvedValue({ ...product, stock: 3 });
      prisma.cartItem.upsert.mockResolvedValue(cartItem({ quantity: 5 }));

      const promise = service.addItem('user_1', {
        productId: 'prod_1',
        quantity: 5,
      });
      await expect(promise).rejects.toThrow(
        'Requested quantity 5 exceeds available stock 3',
      );
    });
  });

  describe('updateItem', () => {
    it('404s when the item belongs to another user (ownership scoped query)', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItem('user_1', 'item_9', { quantity: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const args = firstCallArg<Prisma.CartItemFindFirstArgs>(
        prisma.cartItem.findFirst,
      );
      expect(args.where).toEqual({ id: 'item_9', cart: { userId: 'user_1' } });
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
    });

    it('rejects with 400 when the new quantity exceeds stock', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(
        cartItem({ product: { ...product, stock: 2 } }),
      );

      await expect(
        service.updateItem('user_1', 'item_1', { quantity: 3 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
    });

    it('updates the quantity and returns the refreshed cart view', async () => {
      prisma.cartItem.findFirst.mockResolvedValue(cartItem());
      prisma.cartItem.update.mockResolvedValue(cartItem({ quantity: 4 }));
      prisma.cart.upsert.mockResolvedValue(
        cartWith([cartItem({ quantity: 4 })]),
      );

      const result = await service.updateItem('user_1', 'item_1', {
        quantity: 4,
      });

      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'item_1' },
        data: { quantity: 4 },
      });
      expect(result.items[0]?.quantity).toBe(4);
    });
  });

  describe('removeItem', () => {
    it("404s when the item is not in the caller's cart and does not delete", async () => {
      prisma.cartItem.findFirst.mockResolvedValue(null);

      await expect(
        service.removeItem('user_1', 'item_9'),
      ).rejects.toBeInstanceOf(NotFoundException);

      const args = firstCallArg<Prisma.CartItemFindFirstArgs>(
        prisma.cartItem.findFirst,
      );
      expect(args.where).toEqual({ id: 'item_9', cart: { userId: 'user_1' } });
      expect(prisma.cartItem.delete).not.toHaveBeenCalled();
    });

    it('deletes an owned item and returns the cart view', async () => {
      prisma.cartItem.findFirst.mockResolvedValue({ id: 'item_1' });
      prisma.cartItem.delete.mockResolvedValue({ id: 'item_1' });
      prisma.cart.upsert.mockResolvedValue(cartWith([]));

      const result = await service.removeItem('user_1', 'item_1');

      expect(prisma.cartItem.delete).toHaveBeenCalledWith({
        where: { id: 'item_1' },
      });
      expect(result.items).toEqual([]);
    });
  });

  describe('clearCart', () => {
    it("clears only the caller's cart items", async () => {
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 2 });
      prisma.cart.upsert.mockResolvedValue(cartWith([]));

      const result = await service.clearCart('user_1');

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cart: { userId: 'user_1' } },
      });
      expect(result).toEqual({
        id: 'cart_1',
        items: [],
        subtotalCents: 0,
        itemCount: 0,
      });
    });
  });
});
