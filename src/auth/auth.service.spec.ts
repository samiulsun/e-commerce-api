import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { hashRefreshToken } from './token-hash';

const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';

interface MockPrisma {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
}

function firstCallArg<T>(mock: jest.Mock): T {
  return (mock.mock.calls as unknown[][])[0][0] as T;
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrisma;

  const jwtService = new JwtService();
  const config = new ConfigService({
    JWT_ACCESS_SECRET: ACCESS_SECRET,
    JWT_REFRESH_SECRET: REFRESH_SECRET,
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
  });

  const storedUser = {
    id: 'user_1',
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    role: Role.USER,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma.user.update.mockResolvedValue({});
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      config,
    );
  });

  describe('signup', () => {
    it('hashes the password, creates a USER and returns tokens without the password hash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation((args: Prisma.UserCreateArgs) =>
        Promise.resolve({
          ...storedUser,
          email: args.data.email,
          name: args.data.name,
        }),
      );

      const result = await service.signup({
        email: 'ada@example.com',
        password: 'Sup3rSecret!',
        name: 'Ada Lovelace',
      });

      const createArgs = firstCallArg<Prisma.UserCreateArgs>(
        prisma.user.create,
      );
      expect(createArgs.data.role).toBe(Role.USER);
      const passwordHash =
        'passwordHash' in createArgs.data
          ? createArgs.data.passwordHash
          : undefined;
      expect(passwordHash).toBeDefined();
      expect(passwordHash).not.toBe('Sup3rSecret!');
      await expect(
        bcrypt.compare('Sup3rSecret!', passwordHash ?? ''),
      ).resolves.toBe(true);

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).toEqual(
        expect.objectContaining({ id: storedUser.id }),
      );

      const accessPayload = await jwtService.verifyAsync<{
        sub: string;
        email: string;
        role: Role;
        type: string;
      }>(result.accessToken, { secret: ACCESS_SECRET });
      expect(accessPayload).toMatchObject({
        sub: storedUser.id,
        email: 'ada@example.com',
        role: Role.USER,
        type: 'access',
      });

      const refreshPayload = await jwtService.verifyAsync<{
        sub: string;
        type: string;
      }>(result.refreshToken, { secret: REFRESH_SECRET });
      expect(refreshPayload).toMatchObject({
        sub: storedUser.id,
        type: 'refresh',
      });

      const updateArgs = firstCallArg<Prisma.UserUpdateArgs>(
        prisma.user.update,
      );
      const storedDigest =
        'refreshTokenHash' in (updateArgs.data as object)
          ? (updateArgs.data as { refreshTokenHash: string }).refreshTokenHash
          : undefined;
      expect(storedDigest).toBe(hashRefreshToken(result.refreshToken));
    });

    it('rejects a duplicate email with 409 without creating a user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: storedUser.id });

      await expect(
        service.signup({
          email: 'ada@example.com',
          password: 'Sup3rSecret!',
          name: 'Ada Lovelace',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns tokens for valid credentials and never exposes the hash', async () => {
      const passwordHash = await bcrypt.hash('Sup3rSecret!', 10);
      prisma.user.findUnique.mockResolvedValue({ ...storedUser, passwordHash });

      const result = await service.login({
        email: 'ada@example.com',
        password: 'Sup3rSecret!',
      });

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).toEqual(
        expect.objectContaining({ id: storedUser.id, email: storedUser.email }),
      );

      const accessPayload = await jwtService.verifyAsync<{
        sub: string;
        iat: number;
        exp: number;
      }>(result.accessToken, { secret: ACCESS_SECRET });
      expect(accessPayload.sub).toBe(storedUser.id);
      expect(accessPayload.exp - accessPayload.iat).toBe(15 * 60);

      await expect(
        jwtService.verifyAsync(result.refreshToken, { secret: REFRESH_SECRET }),
      ).resolves.toMatchObject({ sub: storedUser.id, type: 'refresh' });

      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const updateArgs = firstCallArg<Prisma.UserUpdateArgs>(
        prisma.user.update,
      );
      expect(updateArgs.where).toEqual({ id: storedUser.id });
    });

    it('rejects an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a wrong password without issuing tokens', async () => {
      const passwordHash = await bcrypt.hash('right-password', 10);
      prisma.user.findUnique.mockResolvedValue({ ...storedUser, passwordHash });

      await expect(
        service.login({ email: 'ada@example.com', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    async function makeRefreshToken(sub: string): Promise<string> {
      return jwtService.signAsync(
        { sub, type: 'refresh', jti: randomUUID() },
        { secret: REFRESH_SECRET, expiresIn: '7d' },
      );
    }

    it('rotates the refresh token when the stored digest matches', async () => {
      const token = await makeRefreshToken(storedUser.id);
      prisma.user.findUnique.mockResolvedValue({
        ...storedUser,
        refreshTokenHash: hashRefreshToken(token),
      });

      const result = await service.refresh(token);

      expect(result.refreshToken).not.toBe(token);
      const updateArgs = firstCallArg<Prisma.UserUpdateArgs>(
        prisma.user.update,
      );
      expect(
        (updateArgs.data as { refreshTokenHash: string }).refreshTokenHash,
      ).toBe(hashRefreshToken(result.refreshToken));

      const accessPayload = await jwtService.verifyAsync<{ sub: string }>(
        result.accessToken,
        { secret: ACCESS_SECRET },
      );
      expect(accessPayload.sub).toBe(storedUser.id);
    });

    it('rejects a token that no longer matches the stored digest and clears the session', async () => {
      const rotatedAway = await makeRefreshToken(storedUser.id);
      const newerToken = await makeRefreshToken(storedUser.id);
      prisma.user.findUnique.mockResolvedValue({
        ...storedUser,
        refreshTokenHash: hashRefreshToken(newerToken),
      });

      await expect(service.refresh(rotatedAway)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      const updateArgs = firstCallArg<Prisma.UserUpdateArgs>(
        prisma.user.update,
      );
      expect(updateArgs.data).toEqual({ refreshTokenHash: null });
    });

    it('rejects a malformed token before touching the database', async () => {
      await expect(service.refresh('not-a-jwt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an access token presented as a refresh token', async () => {
      const wrongType = await jwtService.signAsync(
        { sub: storedUser.id, type: 'access', jti: randomUUID() },
        { secret: REFRESH_SECRET },
      );

      await expect(service.refresh(wrongType)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a valid token when the user has no stored session', async () => {
      const token = await makeRefreshToken(storedUser.id);
      prisma.user.findUnique.mockResolvedValue({
        ...storedUser,
        refreshTokenHash: null,
      });

      await expect(service.refresh(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
