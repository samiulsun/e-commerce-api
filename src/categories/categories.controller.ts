import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List categories' })
  @ApiOkResponse({ description: 'All categories ordered by name' })
  findAll() {
    return this.categoriesService.findAll();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a single category' })
  @ApiOkResponse({ description: 'The category' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Create a category (ADMIN)' })
  @ApiCreatedResponse({ description: 'The created category' })
  @ApiConflictResponse({ description: 'Slug already in use' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update a category (ADMIN)' })
  @ApiOkResponse({ description: 'The updated category' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an empty category (ADMIN)' })
  @ApiOkResponse({ description: 'The deleted category' })
  @ApiConflictResponse({ description: 'Category still has products' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}
