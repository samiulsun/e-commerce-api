import { Prisma } from '@prisma/client';

/**
 * The only user projection that ever leaves the API: `passwordHash` (and any
 * future secret column) can never leak because it is not selected.
 */
export const userSafeSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type SafeUser = Prisma.UserGetPayload<{ select: typeof userSafeSelect }>;

/** The user shape attached to requests by JwtStrategy. */
export type AuthenticatedUser = SafeUser;
