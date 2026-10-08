import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module';

interface CartItemBody {
  id: string;
  productId: string;
  quantity: number;
  lineTotalCents: number;
  product: { id: string; priceCents: number; name: string };
}

interface CartBody {
  id: string;
  items: CartItemBody[];
  subtotalCents: number;
  itemCount: number;
}

describe('Cart (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;

  const stamp = Date.now();
  const password = 'Sup3rSecret!';
  const adminEmail = `e2e-cart-admin-${stamp}@test.dev`;
  const userAEmail = `e2e-cart-a-${stamp}@test.dev`;
  const userBEmail = `e2e-cart-b-${stamp}@test.dev`;

  let adminToken: string;
  let tokenA: string;
  let tokenB: string;
  let categoryId: string;
  let productId: string;
  let inactiveProductId: string;
  let itemId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;

    prisma = new PrismaClient();
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Cart Admin',
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
      .send({ name: 'Cart Category', slug: `cart-category-${stamp}` })
      .expect(201);
    categoryId = (category.body as { id: string }).id;

    const product = await request(server)
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Cart Product ${stamp}`,
        description: 'Stock-limited product for cart tests',
        priceCents: 1500,
        sku: `CART-${stamp}`,
        stock: 3,
        categoryId,
      })
      .expect(201);
    productId = (product.body as { id: string }).id;

    const inactive = await request(server)
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Inactive Product ${stamp}`,
        description: 'Will be soft-deleted',
        priceCents: 999,
        sku: `CART-OFF-${stamp}`,
        stock: 10,
        categoryId,
      })
      .expect(201);
    inactiveProductId = (inactive.body as { id: string }).id;
    await request(server)
      .delete(`/products/${inactiveProductId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const signupA = await request(server)
      .post('/auth/signup')
      .send({ email: userAEmail, password, name: 'Cart User A' })
      .expect(201);
    tokenA = (signupA.body as { accessToken: string }).accessToken;

    const signupB = await request(server)
      .post('/auth/signup')
      .send({ email: userBEmail, password, name: 'Cart User B' })
      .expect(201);
    tokenB = (signupB.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /cart -> 401 without a token', async () => {
    await request(server).get('/cart').expect(401);
  });

  it('GET /cart -> 200 creates the cart lazily and returns an empty envelope', async () => {
    const response = await request(server)
      .get('/cart')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const body = response.body as CartBody;
    expect(typeof body.id).toBe('string');
    expect(body.items).toEqual([]);
    expect(body.subtotalCents).toBe(0);
    expect(body.itemCount).toBe(0);
  });

  it('POST /cart/items -> 200 adds a line item with a computed line total', async () => {
    const response = await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ productId, quantity: 1 })
      .expect(200);

    const body = response.body as CartBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      productId,
      quantity: 1,
      lineTotalCents: 1500,
    });
    expect(body.subtotalCents).toBe(1500);
    expect(body.itemCount).toBe(1);
    itemId = body.items[0]?.id ?? '';
  });

  it('POST /cart/items -> increments the existing line item instead of duplicating', async () => {
    const response = await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ productId, quantity: 1 })
      .expect(200);

    const body = response.body as CartBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: itemId, quantity: 2 });
    expect(body.subtotalCents).toBe(3000);
  });

  it('POST /cart/items -> 400 when exceeding stock, leaving the cart untouched', async () => {
    const response = await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ productId, quantity: 2 })
      .expect(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      message: 'Requested quantity 4 exceeds available stock 3',
      error: 'Bad Request',
    });

    const cart = await request(server)
      .get('/cart')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect((cart.body as CartBody).items[0]?.quantity).toBe(2);
  });

  it('POST /cart/items -> 404 for an unknown or inactive product', async () => {
    await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ productId: 'does-not-exist', quantity: 1 })
      .expect(404);

    await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ productId: inactiveProductId, quantity: 1 })
      .expect(404);
  });

  it('PATCH /cart/items/:id -> updates the quantity within stock and 400s beyond it', async () => {
    const updated = await request(server)
      .patch(`/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ quantity: 3 })
      .expect(200);
    expect((updated.body as CartBody).items[0]?.quantity).toBe(3);

    await request(server)
      .patch(`/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ quantity: 4 })
      .expect(400);
  });

  it("does not let another user touch someone else's cart (404, not 403)", async () => {
    await request(server)
      .patch(`/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ quantity: 1 })
      .expect(404);

    await request(server)
      .delete(`/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    const cartB = await request(server)
      .get('/cart')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect((cartB.body as CartBody).items).toEqual([]);
  });

  it('DELETE /cart/items/:id -> removes the owned line item', async () => {
    const response = await request(server)
      .delete(`/cart/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const body = response.body as CartBody;
    expect(body.items).toEqual([]);
    expect(body.subtotalCents).toBe(0);
  });

  it('DELETE /cart -> clears the cart', async () => {
    await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ productId, quantity: 1 })
      .expect(200);

    const response = await request(server)
      .delete('/cart')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const body = response.body as CartBody;
    expect(body.items).toEqual([]);
    expect(body.itemCount).toBe(0);

    const stored = await prisma.cartItem.count({
      where: {
        cart: {
          userId: (
            await prisma.user.findUniqueOrThrow({
              where: { email: userAEmail },
            })
          ).id,
        },
      },
    });
    expect(stored).toBe(0);
  });
});
