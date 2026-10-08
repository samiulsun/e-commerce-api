import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PaymentIntentResult, StripeService } from '../payments/stripe.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryOrdersDto } from './dto/query-orders.dto';

export const DEFAULT_CURRENCY = 'usd';
export const DEFAULT_ORDERS_PAGE_SIZE = 20;

export interface CheckoutResponse {
  orderId: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
}

const orderInclude = {
  items: {
    include: {
      product: { select: { id: true, name: true, sku: true } },
    },
  },
  payment: true,
} satisfies Prisma.OrderInclude;

export type OrderWithDetails = Prisma.OrderGetPayload<{
  include: typeof orderInclude;
}>;

export interface PaginatedOrders {
  data: OrderWithDetails[];
  total: number;
  skip: number;
  take: number;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  /**
   * Server-side checkout: the client sends no cart, total or prices — the
   * caller's stored cart is the single source of truth. OrderItems snapshot
   * `priceAtPurchaseCents` so later price changes never alter history.
   */
  async checkout(userId: string): Promise<CheckoutResponse> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const problems: string[] = [];
    for (const item of cart.items) {
      if (!item.product.isActive) {
        problems.push(`${item.product.name} is no longer available`);
      } else if (item.quantity > item.product.stock) {
        problems.push(
          `Requested quantity ${item.quantity} of ${item.product.name} exceeds available stock ${item.product.stock}`,
        );
      }
    }
    if (problems.length > 0) {
      throw new BadRequestException(problems);
    }

    const totalCents = cart.items.reduce(
      (sum, item) => sum + item.product.priceCents * item.quantity,
      0,
    );

    // Nested writes are transactional: order + items land atomically.
    const order = await this.prisma.order.create({
      data: {
        userId,
        status: OrderStatus.PENDING,
        totalCents,
        items: {
          create: cart.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            priceAtPurchaseCents: item.product.priceCents,
          })),
        },
      },
      include: orderInclude,
    });

    let paymentIntent: PaymentIntentResult;
    try {
      paymentIntent = await this.stripeService.createPaymentIntent({
        amountCents: totalCents,
        currency: DEFAULT_CURRENCY,
        metadata: { orderId: order.id, userId },
        idempotencyKey: `checkout-${order.id}`,
      });
    } catch {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.FAILED },
      });
      throw new BadGatewayException('Payment could not be initiated');
    }

    if (!paymentIntent.clientSecret) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.FAILED },
      });
      throw new BadGatewayException('Payment could not be initiated');
    }

    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        stripePaymentIntentId: paymentIntent.id,
        status: PaymentStatus.PENDING,
        amountCents: totalCents,
        currency: paymentIntent.currency,
      },
    });

    return {
      orderId: order.id,
      clientSecret: paymentIntent.clientSecret,
      amountCents: totalCents,
      currency: paymentIntent.currency,
    };
  }

  async findAllForUser(
    userId: string,
    query: QueryOrdersDto,
  ): Promise<PaginatedOrders> {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_ORDERS_PAGE_SIZE;
    const where: Prisma.OrderWhereInput = { userId };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: orderInclude,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data, total, skip, take };
  }

  async findOneForUser(
    userId: string,
    orderId: string,
  ): Promise<OrderWithDetails> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: orderInclude,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }
}
