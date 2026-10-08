import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'Over-ear noise-cancelling headphones.' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description!: string;

  @ApiProperty({ example: 19999, description: 'Price in integer cents' })
  @IsInt()
  @Min(0)
  priceCents!: number;

  @ApiProperty({ example: 'ELE-001', maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sku!: string;

  @ApiProperty({ example: 25, minimum: 0 })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiProperty({ description: 'Category id' })
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
