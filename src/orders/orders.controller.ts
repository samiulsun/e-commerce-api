import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../users/user.select';
import { QueryOrdersDto } from './dto/query-orders.dto';
import {
  OrderWithDetails,
  OrdersService,
  PaginatedOrders,
} from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's orders" })
  @ApiOkResponse({
    description: 'Paginated result: `{ data, total, skip, take }`',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryOrdersDto,
  ): Promise<PaginatedOrders> {
    return this.ordersService.findAllForUser(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: "Get one of the caller's orders" })
  @ApiOkResponse({
    description: 'The order with item snapshots and payment state',
  })
  @ApiNotFoundResponse({ description: 'Order not found for this user' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OrderWithDetails> {
    return this.ordersService.findOneForUser(user.id, id);
  }
}
