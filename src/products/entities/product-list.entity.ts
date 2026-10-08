import { ApiProperty } from '@nestjs/swagger';
import { ProductEntity } from './product.entity';

export class ProductListEntity {
  @ApiProperty({ type: () => [ProductEntity] })
  data!: ProductEntity[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 0 })
  skip!: number;

  @ApiProperty({ example: 20 })
  take!: number;
}
