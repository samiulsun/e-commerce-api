import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

interface CategoryBody {
  id: string;
  name: string;
  slug: string;
}

interface ProductBody {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  sku: string;
  stock: number;
  categoryId: string;
  isActive: boolean;
  category?: CategoryBody;
}

interface ProductListBody {
  data: ProductBody[];
  total: number;
  skip: number;
  take: number;
}

describe('Products & Categories (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;

  const stamp = Date.now();
  const password = 'Sup3rSecret!';
  const adminEmail = `e2e-admin-${stamp}@test.dev`;
  const userEmail = `e2e-user-${stamp}@test.dev`;
  const categorySlug = `e2e-electronics-${stamp}`;
  const productSku = `E2E-SKU-${stamp}`;
  const productName = `E2E Zebra Widget ${stamp}`;

  let adminToken: string;
  let userToken: string;
  let categoryId: string;
  let productId: string;

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
        name: 'E2E Admin',
        role: Role.ADMIN,
        passwordHash: await bcrypt.hash(password, 10),
      },
    });

    const signup = await request(server)
      .post('/auth/signup')
      .send({ email: userEmail, password, name: 'E2E User' })
      .expect(201);
    userToken = (signup.body as { accessToken: string }).accessToken;

    const login = await request(server)
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (login.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('categories', () => {
    it('rejects anonymous writes with 401 and non-admin writes with 403', async () => {
      const payload = { name: 'Denied', slug: `denied-${stamp}` };

      await request(server).post('/categories').send(payload).expect(401);
      await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${userToken}`)
        .send(payload)
        .expect(403);
    });

    it('lets an admin create a category', async () => {
      const response = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'E2E Electronics', slug: categorySlug })
        .expect(201);

      const body = response.body as CategoryBody;
      expect(body).toMatchObject({
        name: 'E2E Electronics',
        slug: categorySlug,
      });
      categoryId = body.id;
    });

    it('returns 409 for a duplicate slug', async () => {
      const response = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Duplicate', slug: categorySlug })
        .expect(409);

      expect((response.body as ErrorBody).statusCode).toBe(409);
    });

    it('lists and reads categories publicly', async () => {
      const list = await request(server).get('/categories').expect(200);
      const categories = list.body as CategoryBody[];
      expect(categories.some((c) => c.id === categoryId)).toBe(true);

      const one = await request(server)
        .get(`/categories/${categoryId}`)
        .expect(200);
      expect((one.body as CategoryBody).slug).toBe(categorySlug);
    });
  });

  describe('products', () => {
    it('rejects anonymous writes with 401 and non-admin writes with 403', async () => {
      const payload = {
        name: 'Denied Product',
        description: 'nope',
        priceCents: 1000,
        sku: `DENIED-${stamp}`,
        stock: 1,
        categoryId,
      };

      await request(server).post('/products').send(payload).expect(401);
      await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${userToken}`)
        .send(payload)
        .expect(403);
      expect(
        await prisma.product.count({ where: { sku: `DENIED-${stamp}` } }),
      ).toBe(0);
    });

    it('validates the payload: unknown category -> 404, bad fields -> 400', async () => {
      await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Ghost',
          description: 'x',
          priceCents: 100,
          sku: `GHOST-${stamp}`,
          stock: 1,
          categoryId: 'missing-category',
        })
        .expect(404);

      const invalid = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: '',
          description: 'x',
          priceCents: -5,
          sku: '',
          stock: -1,
          categoryId,
          notAllowed: true,
        })
        .expect(400);
      expect(Array.isArray((invalid.body as ErrorBody).message)).toBe(true);
    });

    it('lets an admin create a product', async () => {
      const response = await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: productName,
          description: 'A zebra-striped widget for e2e testing.',
          priceCents: 4321,
          sku: productSku,
          stock: 7,
          categoryId,
        })
        .expect(201);

      const body = response.body as ProductBody;
      expect(body).toMatchObject({
        name: productName,
        priceCents: 4321,
        sku: productSku,
        stock: 7,
        isActive: true,
        categoryId,
      });
      expect(body.category?.slug).toBe(categorySlug);
      productId = body.id;
    });

    it('returns 409 for a duplicate sku', async () => {
      await request(server)
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Duplicate sku product',
          description: 'x',
          priceCents: 100,
          sku: productSku,
          stock: 1,
          categoryId,
        })
        .expect(409);
    });

    it('lists products with a pagination envelope, publicly', async () => {
      const response = await request(server).get('/products').expect(200);
      const body = response.body as ProductListBody;

      expect(Array.isArray(body.data)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.skip).toBe(0);
      expect(body.take).toBe(20);

      const found = body.data.find((p) => p.id === productId);
      expect(found).toBeDefined();
      expect(found?.isActive).toBe(true);
    });

    it('searches case-insensitively across name/description/sku', async () => {
      const response = await request(server)
        .get('/products')
        .query({ q: 'ZEBRA' })
        .expect(200);
      const body = response.body as ProductListBody;

      expect(body.total).toBe(1);
      expect(body.data[0]?.id).toBe(productId);
    });

    it('filters by category and price range', async () => {
      const inRange = await request(server)
        .get('/products')
        .query({ categoryId, minPrice: 4000, maxPrice: 5000 })
        .expect(200);
      expect((inRange.body as ProductListBody).total).toBe(1);

      const outOfRange = await request(server)
        .get('/products')
        .query({ categoryId, minPrice: 5001 })
        .expect(200);
      expect((outOfRange.body as ProductListBody).total).toBe(0);
    });

    it('reads a product by id; 404 for unknown ids', async () => {
      const response = await request(server)
        .get(`/products/${productId}`)
        .expect(200);
      expect((response.body as ProductBody).sku).toBe(productSku);

      await request(server).get('/products/does-not-exist').expect(404);
    });

    it('updates a product (admin only)', async () => {
      await request(server)
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ priceCents: 99 })
        .expect(403);

      const response = await request(server)
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ priceCents: 5555, stock: 3 })
        .expect(200);

      expect(response.body).toMatchObject({ priceCents: 5555, stock: 3 });
    });

    it('soft-deletes a product (admin only): hidden from reads, row kept', async () => {
      await request(server)
        .delete(`/products/${productId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      const response = await request(server)
        .delete(`/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((response.body as ProductBody).isActive).toBe(false);

      await request(server).get(`/products/${productId}`).expect(404);

      const search = await request(server)
        .get('/products')
        .query({ q: 'ZEBRA' })
        .expect(200);
      expect((search.body as ProductListBody).total).toBe(0);

      const row = await prisma.product.findUnique({ where: { id: productId } });
      expect(row).not.toBeNull();
      expect(row?.isActive).toBe(false);
    });

    it('refuses to delete a category that still has products', async () => {
      const response = await request(server)
        .delete(`/categories/${categoryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
      expect((response.body as ErrorBody).statusCode).toBe(409);
    });

    it('deletes an empty category', async () => {
      const created = await request(server)
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Disposable', slug: `disposable-${stamp}` })
        .expect(201);
      const id = (created.body as CategoryBody).id;

      await request(server)
        .delete(`/categories/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(server).get(`/categories/${id}`).expect(404);
    });
  });
});
