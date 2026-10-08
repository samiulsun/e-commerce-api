import { ApiProperty } from '@nestjs/swagger';

export class OrderProductRefEntity {
  @ApiProperty({ example: 'cm0...' })
  id!: string;

  @ApiProperty({ example: 'Wireless Headphones' })
  name!: string;

  @ApiProperty({ example: 'ELE-001' })
  sku!: string;
}

export class OrderItemEntity {
  @ApiProperty({ example: 'cm0...' })
  id!: string;

  @ApiProperty({ example: 'cm0...' })
  productId!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({
    example: 19999,
    description: 'Price snapshot at purchase time, in cents',
  })
  priceAtPurchaseCents!: number;

  @ApiProperty({ type: () => OrderProductRefEntity })
  product!: OrderProductRefEntity;
}

export class PaymentEntity {
  @ApiProperty({ example: 'cm0...' })
  id!: string;

  @ApiProperty({ example: 'cm0...' })
  orderId!: string;

  @ApiProperty({ example: 'pi_3...' })
  stripePaymentIntentId!: string;

  @ApiProperty({ enum: ['PENDING', 'SUCCEEDED', 'FAILED'] })
  status!: string;

  @ApiProperty({ example: 39998 })
  amountCents!: number;

  @ApiProperty({ example: 'usd' })
  currency!: string;
}

export class OrderEntity {
  @ApiProperty({ example: 'cm0...' })
  id!: string;

  @ApiProperty({ example: 'cm0...' })
  userId!: string;

  @ApiProperty({ enum: ['PENDING', 'PAID', 'FAILED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({ example: 39998 })
  totalCents!: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: Date;

  @ApiProperty({ type: () => [OrderItemEntity] })
  items!: OrderItemEntity[];

  @ApiProperty({ type: () => PaymentEntity, nullable: true })
  payment!: PaymentEntity | null;
}

export class OrderListEntity {
  @ApiProperty({ type: () => [OrderEntity] })
  data!: OrderEntity[];

  @ApiProperty({ example: 7 })
  total!: number;

  @ApiProperty({ example: 0 })
  skip!: number;

  @ApiProperty({ example: 20 })
  take!: number;
}

export class CheckoutResponseEntity {
  @ApiProperty({ example: 'cm0...' })
  orderId!: string;

  @ApiProperty({
    example: 'pi_3..._secret_xyz',
    description: 'Used by the client to confirm the PaymentIntent',
  })
  clientSecret!: string;

  @ApiProperty({ example: 39998 })
  amountCents!: number;

  @ApiProperty({ example: 'usd' })
  currency!: string;
}
