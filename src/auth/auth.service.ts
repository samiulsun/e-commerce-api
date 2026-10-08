import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthenticatedUser,
  SafeUser,
  userSafeSelect,
} from '../users/user.select';
import {
  AccessTokenPayload,
  AuthTokensResponse,
  RefreshTokenPayload,
} from './auth.types';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { hashRefreshToken, refreshTokenMatches } from './token-hash';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtl: string;
  private readonly refreshTtl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshSecret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.accessTtl = config.get<string>('JWT_ACCESS_TTL', '15m');
    this.refreshTtl = config.get<string>('JWT_REFRESH_TTL', '7d');
  }

  async signup(dto: SignupDto): Promise<AuthTokensResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: Role.USER,
      },
      select: userSafeSelect,
    });

    const tokens = await this.issueTokens(user);
    return { user, ...tokens };
  }

  async login(dto: LoginDto): Promise<AuthTokensResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { ...userSafeSelect, passwordHash: true },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Strip the hash by construction; the response object never carries it.
    const safeUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    const tokens = await this.issueTokens(safeUser);
    return { user: safeUser, ...tokens };
  }

  async refresh(refreshToken: string): Promise<AuthTokensResponse> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        { secret: this.refreshSecret },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { ...userSafeSelect, refreshTokenHash: true },
    });
    if (!user?.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    if (!refreshTokenMatches(refreshToken, user.refreshTokenHash)) {
      // A token that does not match the stored digest is a rotated-away or
      // forged token: invalidate the session rather than trusting it.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshTokenHash: null },
      });
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const safeUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    const tokens = await this.issueTokens(safeUser);
    return { user: safeUser, ...tokens };
  }

  private async issueTokens(
    user: SafeUser,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        type: 'access',
      } satisfies AccessTokenPayload,
      {
        secret: this.accessSecret,
        expiresIn: this.accessTtl as JwtSignOptions['expiresIn'],
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        type: 'refresh',
        jti: randomUUID(),
      } satisfies RefreshTokenPayload,
      {
        secret: this.refreshSecret,
        expiresIn: this.refreshTtl as JwtSignOptions['expiresIn'],
      },
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: hashRefreshToken(refreshToken) },
    });

    return { accessToken, refreshToken };
  }
}
