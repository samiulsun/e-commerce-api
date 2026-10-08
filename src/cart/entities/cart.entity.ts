import { ApiProperty } from '@nestjs/swagger';

export class CartProductRefEntity {
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

  @ApiProperty({ example: true })
  isActive!: boolean;
}

export class CartItemEntity {
  @ApiProperty({ example: 'cm0...' })
  id!: string;

  @ApiProperty({ example: 'cm0...' })
  productId!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: 39998, description: 'quantity * priceCents' })
  lineTotalCents!: number;

  @ApiProperty({ type: () => CartProductRefEntity })
  product!: CartProductRefEntity;
}

export class CartEntity {
  @ApiProperty({ example: 'cm0...' })
  id!: string;

  @ApiProperty({ type: () => [CartItemEntity] })
  items!: CartItemEntity[];

  @ApiProperty({ example: 39998 })
  subtotalCents!: number;

  @ApiProperty({ example: 3, description: 'Sum of quantities' })
  itemCount!: number;
}
