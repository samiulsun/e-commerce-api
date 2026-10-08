import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Server } from 'node:http';
import request from 'supertest';
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

interface OrderItemBody {
  productId: string;
  quantity: number;
  priceAtPurchaseCents: number;
  product: { id: string; name: string; sku: string };
}

interface OrderBody {
  id: string;
  status: string;
  totalCents: number;
  items: OrderItemBody[];
  payment: {
    stripePaymentIntentId: string;
    status: string;
    amountCents: number;
  } | null;
}

interface OrderListBody {
  data: OrderBody[];
  total: number;
  skip: number;
  take: number;
}

describe('Checkout & Orders (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;

  const stamp = Date.now();
  const password = 'Sup3rSecret!';
  const adminEmail = `e2e-checkout-admin-${stamp}@test.dev`;
  const userAEmail = `e2e-checkout-a-${stamp}@test.dev`;
  const userBEmail = `e2e-checkout-b-${stamp}@test.dev`;
  const clientSecret = `pi_e2e_secret_${stamp}`;
  const paymentIntentId = `pi_e2e_${stamp}`;

  const stripeMock = {
    isConfigured: jest.fn().mockReturnValue(true),
    createPaymentIntent: jest.fn(
      (input: { amountCents: number; currency: string }) =>
        Promise.resolve({
          id: paymentIntentId,
          clientSecret,
          currency: input.currency,
          status: 'requires_payment_method',
        }),
    ),
    constructEvent: jest.fn(),
  };

  let adminToken: string;
  let tokenA: string;
  let tokenB: string;
  let categoryId: string;
  let productId: string;
  let orderId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StripeService)
      .useValue(stripeMock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    prisma = new PrismaClient();
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Checkout Admin',
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
      .send({ name: 'Checkout Category', slug: `checkout-category-${stamp}` })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    const product = await request(server)
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Checkout Product ${stamp}`,
        description: 'Product for checkout tests',
        priceCents: 2500,
        sku: `CHECKOUT-${stamp}`,
        stock: 5,
        categoryId,
      })
      .expect(201);
    productId = (product.body as { id: string }).id;

    const signupA = await request(server)
      .post('/auth/signup')
      .send({ email: userAEmail, password, name: 'Checkout User A' })
      .expect(201);
    tokenA = (signupA.body as { accessToken: string }).accessToken;

    const signupB = await request(server)
      .post('/auth/signup')
      .send({ email: userBEmail, password, name: 'Checkout User B' })
      .expect(201);
    tokenB = (signupB.body as { accessToken: string }).accessToken;

    await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ productId, quantity: 2 })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /checkout -> 401 without a token', async () => {
    await request(server).post('/checkout').expect(401);
  });

  it('POST /checkout -> 201 creates a PENDING order with snapshots and a PaymentIntent', async () => {
    const response = await request(server)
      .post('/checkout')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    const body = response.body as CheckoutBody;
    expect(body).toMatchObject({
      amountCents: 5000,
      currency: 'usd',
      clientSecret,
    });
    expect(typeof body.orderId).toBe('string');
    orderId = body.orderId;

    expect(stripeMock.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 5000,
        currency: 'usd',
        metadata: expect.objectContaining({ orderId }) as unknown,
      }),
    );

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, payment: true },
    });
    expect(order.status).toBe('PENDING');
    expect(order.totalCents).toBe(5000);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({
      productId,
      quantity: 2,
      priceAtPurchaseCents: 2500,
    });
    expect(order.payment).toMatchObject({
      stripePaymentIntentId: paymentIntentId,
      status: 'PENDING',
      amountCents: 5000,
      currency: 'usd',
    });

    // The cart is intentionally NOT cleared here — the payment webhook owns
    // that side effect once the charge succeeds.
    const cart = await prisma.cartItem.count({
      where: { cart: { userId: order.userId } },
    });
    expect(cart).toBe(1);
  });

  it('keeps the price snapshot even after the live price changes', async () => {
    await request(server)
      .patch(`/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ priceCents: 9999 })
      .expect(200);

    const response = await request(server)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const body = response.body as OrderBody;
    expect(body.items[0]?.priceAtPurchaseCents).toBe(2500);
    expect(body.payment?.status).toBe('PENDING');
  });

  it("GET /orders -> lists only the caller's orders; GET /orders/:id -> own only", async () => {
    const list = await request(server)
      .get('/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const listBody = list.body as OrderListBody;
    expect(listBody.total).toBeGreaterThanOrEqual(1);
    expect(listBody.data.some((o) => o.id === orderId)).toBe(true);

    const own = await request(server)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect((own.body as OrderBody).id).toBe(orderId);

    await request(server)
      .get(`/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    await request(server)
      .get('/orders/does-not-exist')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('POST /checkout -> 400 for an empty cart', async () => {
    const response = await request(server)
      .post('/checkout')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(400);
    expect((response.body as ErrorBody).message).toBe('Cart is empty');
  });

  it('POST /checkout -> 400 when stock is insufficient', async () => {
    await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ productId, quantity: 2 })
      .expect(200);

    await request(server)
      .patch(`/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ stock: 1 })
      .expect(200);

    const response = await request(server)
      .post('/checkout')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(400);
    const message = (response.body as ErrorBody).message;
    expect(
      Array.isArray(message) &&
        message.some((m) => m.includes('exceeds available stock 1')),
    ).toBe(true);

    expect(
      await prisma.order.count({ where: { user: { email: userBEmail } } }),
    ).toBe(0);
  });

  it('POST /checkout -> 400 when a cart product was deactivated', async () => {
    await request(server)
      .delete(`/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const response = await request(server)
      .post('/checkout')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(400);
    const message = (response.body as ErrorBody).message;
    expect(
      Array.isArray(message) &&
        message.some((m) => m.includes('no longer available')),
    ).toBe(true);
  });
});
