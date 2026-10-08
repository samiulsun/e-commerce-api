import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const productInclude = { category: true } satisfies Prisma.ProductInclude;

export type ProductWithCategory = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

export interface PaginatedProducts {
  data: ProductWithCategory[];
  total: number;
  skip: number;
  take: number;
}

export const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryProductsDto): Promise<PaginatedProducts> {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_PAGE_SIZE;
    const where = this.buildWhere(query);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: productInclude,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  async findOne(id: string): Promise<ProductWithCategory> {
    const product = await this.prisma.product.findFirst({
      where: { id, isActive: true },
      include: productInclude,
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async create(dto: CreateProductDto): Promise<ProductWithCategory> {
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return this.prisma.product.create({
      data: {
        name: dto.name,
        description: dto.description,
        priceCents: dto.priceCents,
        sku: dto.sku,
        stock: dto.stock,
        categoryId: dto.categoryId,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: productInclude,
    });
  }

  async update(
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductWithCategory> {
    await this.ensureExists(id);

    return this.prisma.product.update({
      where: { id },
      data: { ...dto },
      include: productInclude,
    });
  }

  /**
   * Soft delete only: historically ordered products must never be hard-deleted
   * because OrderItem rows reference them.
   */
  async softDelete(id: string): Promise<ProductWithCategory> {
    await this.ensureExists(id);

    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
      include: productInclude,
    });
  }

  private async ensureExists(id: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
  }

  private buildWhere(query: QueryProductsDto): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { isActive: true };

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.priceCents = {
        ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
      };
    }

    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
        { sku: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
