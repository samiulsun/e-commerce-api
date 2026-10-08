import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';

interface MockPrisma {
  product: {
    findMany: jest.Mock;
    count: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  category: {
    findUnique: jest.Mock;
  };
  $transaction: jest.Mock;
}

function firstCallArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0][0] as T;
}

const category = { id: 'cat_1', name: 'Electronics', slug: 'electronics' };

const product = {
  id: 'prod_1',
  name: 'Headphones',
  description: 'Noise cancelling over-ear headphones',
  priceCents: 19999,
  sku: 'ELE-001',
  stock: 5,
  categoryId: 'cat_1',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  category,
};

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = {
      product: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      category: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };
    service = new ProductsService(prisma as unknown as PrismaService);
  });

  describe('findAll', () => {
    it('returns a paginated envelope of active products with defaults', async () => {
      prisma.product.findMany.mockResolvedValue([product]);
      prisma.product.count.mockResolvedValue(1);

      const result = await service.findAll({});

      const findArgs = firstCallArg<Prisma.ProductFindManyArgs>(
        prisma.product.findMany,
      );
      expect(findArgs.where).toEqual({ isActive: true });
      expect(findArgs.skip).toBe(0);
      expect(findArgs.take).toBe(20);
      expect(result).toEqual({ data: [product], total: 1, skip: 0, take: 20 });
    });

    it('searches name, description and sku with case-insensitive contains', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);

      await service.findAll({ q: 'head' });

      const findArgs = firstCallArg<Prisma.ProductFindManyArgs>(
        prisma.product.findMany,
      );
      expect(findArgs.where?.OR).toEqual([
        { name: { contains: 'head', mode: 'insensitive' } },
        { description: { contains: 'head', mode: 'insensitive' } },
        { sku: { contains: 'head', mode: 'insensitive' } },
      ]);
    });

    it('filters by category and price range and honours skip/take', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);

      await service.findAll({
        categoryId: 'cat_1',
        minPrice: 1000,
        maxPrice: 5000,
        skip: 10,
        take: 5,
      });

      const findArgs = firstCallArg<Prisma.ProductFindManyArgs>(
        prisma.product.findMany,
      );
      expect(findArgs.where).toEqual({
        isActive: true,
        categoryId: 'cat_1',
        priceCents: { gte: 1000, lte: 5000 },
      });
      expect(findArgs.skip).toBe(10);
      expect(findArgs.take).toBe(5);
    });
  });

  describe('findOne', () => {
    it('returns an active product with its category', async () => {
      prisma.product.findFirst.mockResolvedValue(product);

      const result = await service.findOne('prod_1');

      const findArgs = firstCallArg<Prisma.ProductFindFirstArgs>(
        prisma.product.findFirst,
      );
      expect(findArgs.where).toEqual({ id: 'prod_1', isActive: true });
      expect(result).toEqual(product);
    });

    it('throws 404 for a missing or inactive product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('throws 404 when the category does not exist', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          name: 'Headphones',
          description: 'Noise cancelling',
          priceCents: 19999,
          sku: 'ELE-002',
          stock: 5,
          categoryId: 'missing_cat',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('creates the product with the exact integer cents payload', async () => {
      prisma.category.findUnique.mockResolvedValue(category);
      prisma.product.create.mockResolvedValue(product);

      const result = await service.create({
        name: 'Headphones',
        description: 'Noise cancelling',
        priceCents: 19999,
        sku: 'ELE-001',
        stock: 5,
        categoryId: 'cat_1',
      });

      const createArgs = firstCallArg<Prisma.ProductCreateArgs>(
        prisma.product.create,
      );
      expect(createArgs.data).toMatchObject({
        name: 'Headphones',
        priceCents: 19999,
        sku: 'ELE-001',
        stock: 5,
        categoryId: 'cat_1',
      });
      expect(result).toEqual(product);
    });
  });

  describe('update', () => {
    it('throws 404 when the product does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.update('missing', { priceCents: 123 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('applies a partial update to the existing product', async () => {
      prisma.product.findFirst.mockResolvedValue(product);
      prisma.product.update.mockResolvedValue({
        ...product,
        priceCents: 12344,
      });

      const result = await service.update('prod_1', { priceCents: 12344 });

      const updateArgs = firstCallArg<Prisma.ProductUpdateArgs>(
        prisma.product.update,
      );
      expect(updateArgs.where).toEqual({ id: 'prod_1' });
      expect(updateArgs.data).toEqual({ priceCents: 12344 });
      expect(result.priceCents).toBe(12344);
    });
  });

  describe('softDelete', () => {
    it('throws 404 when the product does not exist', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.softDelete('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('sets isActive=false and never hard-deletes the row', async () => {
      prisma.product.findFirst.mockResolvedValue(product);
      prisma.product.update.mockResolvedValue({ ...product, isActive: false });

      const result = await service.softDelete('prod_1');

      const updateArgs = firstCallArg<Prisma.ProductUpdateArgs>(
        prisma.product.update,
      );
      expect(updateArgs.where).toEqual({ id: 'prod_1' });
      expect(updateArgs.data).toEqual({ isActive: false });
      expect(result.isActive).toBe(false);
    });
  });
});
