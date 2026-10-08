import { Role } from '@prisma/client';
import type { SafeUser } from '../users/user.select';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  jti: string;
}

export interface AuthTokensResponse {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
}
