import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Server } from 'node:http';
import request from 'supertest';
import Stripe from 'stripe';
import { AppModule } from './../src/app.module';
import { StripeService } from './../src/payments/stripe.service';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

interface CheckoutBody {
  orderId: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
}

describe('Payments webhook (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;

  const stamp = Date.now();
  const password = 'Sup3rSecret!';
  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_secret';
  const stripeClient = new Stripe('sk_test_placeholder');

  let piCounter = 0;
  const stripeOverride = {
    isConfigured: () => true,
    createPaymentIntent: jest.fn(
      (input: { amountCents: number; currency: string }) => {
        piCounter += 1;
        return Promise.resolve({
          id: `pi_e2e_${stamp}_${piCounter}`,
          clientSecret: `pi_e2e_secret_${stamp}_${piCounter}`,
          currency: input.currency,
          status: 'requires_payment_method',
        });
      },
    ),
    constructEvent: (payload: Buffer, signature: string, secret: string) =>
      stripeClient.webhooks.constructEvent(payload, signature, secret),
  };

  let adminToken: string;
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let tokenD: string;
  let categoryId: string;
  let productAId: string;
  let productBId: string;
  let productCId: string;

  function sign(payload: string): string {
    return stripeClient.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
  }

  function eventOf(type: string, piId: string): Record<string, unknown> {
    return {
      id: `evt_${type}_${piId}`,
      object: 'event',
      api_version: '2020-08-27',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
      data: {
        object: {
          id: piId,
          object: 'payment_intent',
          amount: 12345,
          currency: 'usd',
          metadata: {},
          status:
            type === 'payment_intent.succeeded'
              ? 'succeeded'
              : 'requires_payment_method',
        },
      },
    };
  }

  function postWebhook(payload: string, signature: string | undefined) {
    const send = request(server)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json');
    if (signature !== undefined) {
      send.set('stripe-signature', signature);
    }
    return send.send(payload);
  }

  async function checkout(token: string): Promise<string> {
    const response = await request(server)
      .post('/checkout')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const body = response.body as CheckoutBody;
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { orderId: body.orderId },
    });
    return payment.stripePaymentIntentId;
  }

  async function signUpUser(email: string): Promise<string> {
    const response = await request(server)
      .post('/auth/signup')
      .send({ email, password, name: 'Webhook User' })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StripeService)
      .useValue(stripeOverride)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    server = app.getHttpServer() as Server;

    prisma = new PrismaClient();

    const adminEmail = `e2e-webhook-admin-${Date.now()}@test.dev`;
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Webhook Admin',
        role: Role.ADMIN,
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    const adminLogin = await request(server)
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as { accessToken: string }).accessToken;

    const category = await request(server)
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Webhook Category', slug: `webhook-category-${stamp}` })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    const createProduct = async (
      name: string,
      sku: string,
      stock: number,
      priceCents: number,
    ) => {
      const response = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name,
          description: 'Product for webhook tests',
          priceCents,
          sku,
          stock,
          categoryId,
        })
        .expect(201);
      return (response.body as { id: string }).id;
    };

    productAId = await createProduct(
      `Webhook A ${stamp}`,
      `WEB-A-${stamp}`,
      5,
      2000,
    );
    productBId = await createProduct(
      `Webhook B ${stamp}`,
      `WEB-B-${stamp}`,
      3,
      1000,
    );
    productCId = await createProduct(
      `Webhook C ${stamp}`,
      `WEB-C-${stamp}`,
      1,
      500,
    );

    tokenA = await signUpUser(`e2e-webhook-a-${stamp}@test.dev`);
    tokenB = await signUpUser(`e2e-webhook-b-${stamp}@test.dev`);
    tokenC = await signUpUser(`e2e-webhook-c-${stamp}@test.dev`);
    tokenD = await signUpUser(`e2e-webhook-d-${stamp}@test.dev`);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('handles a signed payment_intent.succeeded: PAID, stock decremented, cart cleared', async () => {
    await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ productId: productAId, quantity: 2 })
      .expect(200);

    const piId = await checkout(tokenA);
    const event = eventOf('payment_intent.succeeded', piId);
    const payload = JSON.stringify(event);

    const response = await postWebhook(payload, sign(payload)).expect(200);
    expect(response.body).toEqual({ received: true, handled: true });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { stripePaymentIntentId: piId },
      include: { order: true },
    });
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.order.status).toBe('PAID');

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productAId },
    });
    expect(product.stock).toBe(3);

    const cartItems = await prisma.cartItem.count({
      where: { cart: { userId: payment.order.userId } },
    });
    expect(cartItems).toBe(0);
  });

  it('re-delivering the same success event is idempotent: stock and cart stay untouched', async () => {
    const payment = await prisma.payment.findFirstOrThrow({
      where: { order: { user: { email: `e2e-webhook-a-${stamp}@test.dev` } } },
      include: { order: true },
    });
    const piId = payment.stripePaymentIntentId;
    const event = eventOf('payment_intent.succeeded', piId);
    const payload = JSON.stringify(event);

    await postWebhook(payload, sign(payload)).expect(200);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productAId },
    });
    expect(product.stock).toBe(3);

    const cartItems = await prisma.cartItem.count({
      where: { cart: { userId: payment.order.userId } },
    });
    expect(cartItems).toBe(0);
  });

  it('handles payment_intent.payment_failed: order FAILED, never touches stock or cart', async () => {
    const userB = await prisma.user.findUniqueOrThrow({
      where: { email: `e2e-webhook-b-${stamp}@test.dev` },
    });
    await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ productId: productBId, quantity: 1 })
      .expect(200);

    const piId = await checkout(tokenB);
    const event = eventOf('payment_intent.payment_failed', piId);
    const payload = JSON.stringify(event);

    const response = await postWebhook(payload, sign(payload)).expect(200);
    expect(response.body).toEqual({ received: true, handled: true });

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { stripePaymentIntentId: piId },
      include: { order: true },
    });
    expect(payment.status).toBe('FAILED');
    expect(payment.order.status).toBe('FAILED');

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productBId },
    });
    expect(product.stock).toBe(3);

    const cartItems = await prisma.cartItem.count({
      where: { cart: { userId: userB.id } },
    });
    expect(cartItems).toBe(1);
  });

  it('rejects a tampered signature with 400 before touching the database', async () => {
    const payment = await prisma.payment.findFirstOrThrow({
      where: { order: { user: { email: `e2e-webhook-b-${stamp}@test.dev` } } },
    });
    const event = eventOf(
      'payment_intent.succeeded',
      payment.stripePaymentIntentId,
    );
    const payload = JSON.stringify(event);
    const tamperedPayload = JSON.stringify({ ...event, id: 'evt_tampered' });

    const response = await postWebhook(payload, sign(tamperedPayload)).expect(
      400,
    );
    expect((response.body as ErrorBody).statusCode).toBe(400);
    expect((response.body as ErrorBody).message).toBe(
      'Invalid Stripe signature',
    );

    const reloaded = await prisma.payment.findUniqueOrThrow({
      where: { stripePaymentIntentId: payment.stripePaymentIntentId },
    });
    expect(reloaded.status).toBe('FAILED');
  });

  it('rejects a missing signature with 400', async () => {
    const payload = JSON.stringify(
      eventOf('payment_intent.succeeded', `pi_missing_${stamp}`),
    );

    const response = await postWebhook(payload, undefined).expect(400);
    expect((response.body as ErrorBody).statusCode).toBe(400);
  });

  it('concurrent last-unit webhooks: exactly one order is paid and stock never goes negative', async () => {
    for (const token of [tokenC, tokenD]) {
      await request(server)
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productCId, quantity: 1 })
        .expect(200);
    }

    const piC = await checkout(tokenC);
    const piD = await checkout(tokenD);

    const payloadC = JSON.stringify(eventOf('payment_intent.succeeded', piC));
    const payloadD = JSON.stringify(eventOf('payment_intent.succeeded', piD));

    const [resultC, resultD] = await Promise.all([
      postWebhook(payloadC, sign(payloadC)),
      postWebhook(payloadD, sign(payloadD)),
    ]);

    const statuses = [resultC.status, resultD.status].sort((a, b) => a - b);
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productCId },
    });
    expect(product.stock).toBe(0);

    const paidOrders = await prisma.order.count({
      where: {
        user: {
          email: {
            in: [
              `e2e-webhook-c-${stamp}@test.dev`,
              `e2e-webhook-d-${stamp}@test.dev`,
            ],
          },
        },
        status: 'PAID',
      },
    });
    expect(paidOrders).toBe(1);

    const pendingOrders = await prisma.order.count({
      where: {
        user: {
          email: {
            in: [
              `e2e-webhook-c-${stamp}@test.dev`,
              `e2e-webhook-d-${stamp}@test.dev`,
            ],
          },
        },
        status: 'PENDING',
      },
    });
    expect(pendingOrders).toBe(1);
  });
});
