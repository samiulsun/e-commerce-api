import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module';

interface AuthResponseBody {
  user: { id: string; email: string; name: string; role: string };
  accessToken: string;
  refreshToken: string;
}

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  const email = `e2e-auth-${Date.now()}@test.dev`;
  const password = 'Sup3rSecret!';
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/signup -> 201 creates a USER and returns tokens without passwordHash', async () => {
    const response = await request(server)
      .post('/auth/signup')
      .send({ email, password, name: 'E2E Tester' })
      .expect(201);

    const body = response.body as AuthResponseBody;
    expect(body.user).toMatchObject({
      email,
      name: 'E2E Tester',
      role: 'USER',
    });
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');

    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
  });

  it('POST /auth/signup -> 409 for a duplicate email', async () => {
    const response = await request(server)
      .post('/auth/signup')
      .send({ email, password, name: 'E2E Tester' })
      .expect(409);

    const body = response.body as ErrorBody;
    expect(body).toMatchObject({
      statusCode: 409,
      message: 'Email is already registered',
      error: 'Conflict',
    });
  });

  it('POST /auth/signup -> 400 in the standard shape for invalid input', async () => {
    const response = await request(server)
      .post('/auth/signup')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);

    const body = response.body as ErrorBody;
    expect(body.statusCode).toBe(400);
    expect(Array.isArray(body.message)).toBe(true);
    expect(body.error).toBe('Bad Request');
  });

  it('GET /users/me -> 401 without a token', async () => {
    await request(server).get('/users/me').expect(401);
  });

  it('GET /users/me -> 200 with the access token', async () => {
    const response = await request(server)
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({ email, role: 'USER' });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('POST /auth/login -> 200 issues a fresh token pair', async () => {
    const response = await request(server)
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const body = response.body as AuthResponseBody;
    expect(body.user.email).toBe(email);
    expect(body.user).not.toHaveProperty('passwordHash');
    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
  });

  it('POST /auth/login -> 401 for a wrong password', async () => {
    const response = await request(server)
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);

    const body = response.body as ErrorBody;
    expect(body.statusCode).toBe(401);
    expect(body.message).toBe('Invalid email or password');
  });

  it('POST /auth/refresh -> 200 rotates the token; the old token then 401s', async () => {
    const rotatedAway = refreshToken;
    const rotated = await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: rotatedAway })
      .expect(200);

    const body = rotated.body as AuthResponseBody;
    expect(body.refreshToken).not.toBe(rotatedAway);
    expect(typeof body.accessToken).toBe('string');

    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: rotatedAway })
      .expect(401);
  });
});
