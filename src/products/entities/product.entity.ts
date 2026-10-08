import { ApiProperty } from '@nestjs/swagger';
import { CategoryEntity } from '../../categories/entities/category.entity';

export class ProductEntity {
  @ApiProperty({ example: 'cm0...' })
  id!: string;

  @ApiProperty({ example: 'Wireless Headphones' })
  name!: string;

  @ApiProperty({ example: 'Over-ear noise-cancelling headphones.' })
  description!: string;

  @ApiProperty({ example: 19999, description: 'Always integer cents' })
  priceCents!: number;

  @ApiProperty({ example: 'ELE-001' })
  sku!: string;

  @ApiProperty({ example: 25 })
  stock!: number;

  @ApiProperty({ example: false })
  isActive!: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: Date;

  @ApiProperty({ type: () => CategoryEntity })
  category!: CategoryEntity;
}
