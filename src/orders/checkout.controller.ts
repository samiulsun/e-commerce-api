import { Controller, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../users/user.select';
import { CheckoutResponse, OrdersService } from './orders.service';

@ApiTags('checkout')
@ApiBearerAuth()
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({
    summary:
      "Check out the caller's cart: creates a PENDING order, snapshots prices and opens a Stripe PaymentIntent",
  })
  @ApiCreatedResponse({
    description:
      'Order created: `{ orderId, clientSecret, amountCents, currency }` — confirm the PaymentIntent with the client secret',
  })
  @ApiBadRequestResponse({
    description: 'Cart empty, inactive product or insufficient stock',
  })
  @ApiBadGatewayResponse({ description: 'Stripe could not be reached' })
  checkout(@CurrentUser() user: AuthenticatedUser): Promise<CheckoutResponse> {
    return this.ordersService.checkout(user.id);
  }
}
