import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../users/user.select';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CartResponse, CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@ApiTags('cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: "Get the caller's cart (created lazily)" })
  @ApiOkResponse({ description: 'The cart with line totals and subtotal' })
  getCart(@CurrentUser() user: AuthenticatedUser): Promise<CartResponse> {
    return this.cartService.getCart(user.id);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a product (increments an existing line item)' })
  @ApiOkResponse({ description: 'The updated cart' })
  @ApiBadRequestResponse({ description: 'Quantity exceeds available stock' })
  @ApiNotFoundResponse({ description: 'Product not found or inactive' })
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddCartItemDto,
  ): Promise<CartResponse> {
    return this.cartService.addItem(user.id, dto);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Set the quantity of a cart line item' })
  @ApiOkResponse({ description: 'The updated cart' })
  @ApiBadRequestResponse({ description: 'Quantity exceeds available stock' })
  @ApiNotFoundResponse({ description: 'Cart item not found' })
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartResponse> {
    return this.cartService.updateItem(user.id, id, dto);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Remove a line item' })
  @ApiOkResponse({ description: 'The updated cart' })
  @ApiNotFoundResponse({ description: 'Cart item not found' })
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<CartResponse> {
    return this.cartService.removeItem(user.id, id);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear the cart' })
  @ApiOkResponse({ description: 'The emptied cart' })
  clearCart(@CurrentUser() user: AuthenticatedUser): Promise<CartResponse> {
    return this.cartService.clearCart(user.id);
  }
}
