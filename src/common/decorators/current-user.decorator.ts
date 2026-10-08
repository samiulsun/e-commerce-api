import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../users/user.select';

/**
 * Injects the user attached to the request by JwtStrategy. Only meaningful on
 * authenticated routes (the global JwtAuthGuard rejects the rest).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    // The global JwtAuthGuard guarantees a user on every non-public route.
    return request.user as AuthenticatedUser;
  },
);
