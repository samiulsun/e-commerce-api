import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { PaginatedProducts, ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'List products (paginated, searchable, filterable)',
  })
  @ApiOkResponse({
    description: 'Paginated result: `{ data, total, skip, take }`',
  })
  findAll(@Query() query: QueryProductsDto): Promise<PaginatedProducts> {
    return this.productsService.findAll(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a single product' })
  @ApiOkResponse({ description: 'The product with its category' })
  @ApiNotFoundResponse({ description: 'Product not found or inactive' })
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a product (ADMIN)' })
  @ApiCreatedResponse({ description: 'The created product' })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a product (ADMIN)' })
  @ApiOkResponse({ description: 'The updated product' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a product (ADMIN)' })
  @ApiOkResponse({
    description: 'The product with `isActive: false` — never hard-deleted',
  })
  @ApiNotFoundResponse({ description: 'Product not found' })
  remove(@Param('id') id: string) {
    return this.productsService.softDelete(id);
  }
}
