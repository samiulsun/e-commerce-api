import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../users/user.select';

/**
 * Injects the user attached to the request by JwtStrategy. Only meaningful on
 * authenticated routes (the global JwtAuthGuard rejects the rest).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    return request.user;
  },
);
