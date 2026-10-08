import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

export interface WebhookHandlingResult {
  received: true;
  handled: boolean;
}

@Injectable()
export class PaymentsService {
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    config: ConfigService,
  ) {
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET', '');
  }

  /**
   * Verifies the raw payload against the Stripe signature before anything
   * else — invalid requests never reach the database.
   */
  verifyAndParse(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Stripe.Event {
    if (!rawBody || !signature) {
      throw new BadRequestException(
        'Missing Stripe signature or raw request body',
      );
    }

    try {
      return this.stripeService.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }
  }

  async handleEvent(event: Stripe.Event): Promise<WebhookHandlingResult> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return {
          received: true,
          handled: await this.handleSucceeded(event.data.object),
        };
      case 'payment_intent.payment_failed':
        return {
          received: true,
          handled: await this.handleFailed(event.data.object),
        };
      default:
        return { received: true, handled: false };
    }
  }

  /**
   * The only place stock is ever decremented. Runs in one transaction:
   * order -> PAID, stock down per OrderItem, cart cleared, payment recorded.
   * The `stock: { gte: quantity }` guard is atomic — concurrent webhooks for
   * the last unit cannot both succeed; the loser rolls back.
   */
  async handleSucceeded(intent: Stripe.PaymentIntent): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { stripePaymentIntentId: intent.id },
      });
      if (!payment) {
        return false;
      }

      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
        include: { items: true },
      });
      if (!order) {
        return false;
      }

      if (order.status === OrderStatus.PAID) {
        // Idempotent re-delivery of the same event: record the result again,
        // but never decrement stock or clear the cart a second time.
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.SUCCEEDED },
        });
        return true;
      }

      for (const item of order.items) {
        const result = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (result.count === 0) {
          throw new ConflictException('Insufficient stock to fulfil the order');
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PAID },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.SUCCEEDED },
      });
      await tx.cartItem.deleteMany({
        where: { cart: { userId: order.userId } },
      });

      return true;
    });
  }

  /** Failure path: no stock or cart side effects. */
  async handleFailed(intent: Stripe.PaymentIntent): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { stripePaymentIntentId: intent.id },
      });
      if (!payment) {
        return false;
      }

      const transitioned = await tx.order.updateMany({
        where: { id: payment.orderId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.FAILED },
      });
      if (transitioned.count === 0) {
        // The order is not awaiting payment (already PAID or FAILED):
        // a stale failure event must never downgrade a paid order.
        return false;
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });
      return true;
    });
  }
}
