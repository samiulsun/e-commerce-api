import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

interface MockPrisma {
  category: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  product: {
    count: jest.Mock;
  };
}

function firstCallArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0][0] as T;
}

const category = { id: 'cat_1', name: 'Electronics', slug: 'electronics' };

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = {
      category: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      product: {
        count: jest.fn(),
      },
    };
    service = new CategoriesService(prisma as unknown as PrismaService);
  });

  it('lists categories ordered by name', async () => {
    prisma.category.findMany.mockResolvedValue([category]);

    const result = await service.findAll();

    const args = firstCallArg<{ orderBy: unknown }>(prisma.category.findMany);
    expect(args.orderBy).toEqual({ name: 'asc' });
    expect(result).toEqual([category]);
  });

  it('throws 404 when a category is missing', async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a category', async () => {
    prisma.category.create.mockResolvedValue(category);

    const result = await service.create({
      name: 'Electronics',
      slug: 'electronics',
    });

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { name: 'Electronics', slug: 'electronics' },
    });
    expect(result).toEqual(category);
  });

  it('throws 404 when updating a missing category', async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(
      service.update('missing', { name: 'New' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('updates an existing category', async () => {
    prisma.category.findUnique.mockResolvedValue(category);
    prisma.category.update.mockResolvedValue({ ...category, name: 'Gadgets' });

    const result = await service.update('cat_1', { name: 'Gadgets' });

    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: 'cat_1' },
      data: { name: 'Gadgets' },
    });
    expect(result.name).toBe('Gadgets');
  });

  it('refuses to delete a category that still has products', async () => {
    prisma.category.findUnique.mockResolvedValue(category);
    prisma.product.count.mockResolvedValue(2);

    await expect(service.remove('cat_1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.category.delete).not.toHaveBeenCalled();
  });

  it('deletes an empty category', async () => {
    prisma.category.findUnique.mockResolvedValue(category);
    prisma.product.count.mockResolvedValue(0);
    prisma.category.delete.mockResolvedValue(category);

    const result = await service.remove('cat_1');

    expect(prisma.category.delete).toHaveBeenCalledWith({
      where: { id: 'cat_1' },
    });
    expect(result).toEqual(category);
  });
});
