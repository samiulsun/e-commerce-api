import { ApiProperty } from '@nestjs/swagger';

export class CategoryEntity {
  @ApiProperty({ example: 'cm0...' })
  id!: string;

  @ApiProperty({ example: 'Electronics' })
  name!: string;

  @ApiProperty({ example: 'electronics' })
  slug!: string;
}
