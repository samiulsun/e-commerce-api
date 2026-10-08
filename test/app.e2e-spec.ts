import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

describe('App (e2e)', () => {
  let app: INestApplication;
  let server: Server;

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

  it('GET /health -> 200 with status ok', async () => {
    const response = await request(server).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /unknown -> 404 in the standard error shape', async () => {
    const response = await request(server)
      .get('/definitely-not-a-route')
      .expect(404);

    const body = response.body as ErrorBody;
    expect(body.statusCode).toBe(404);
    expect(typeof body.message).toBe('string');
    expect(typeof body.error).toBe('string');
  });
});
