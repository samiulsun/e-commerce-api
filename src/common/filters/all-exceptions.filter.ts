import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error: string;
}

/**
 * Global exception filter. Every error leaves the API as
 * `{ statusCode, message, error }` (message may be an array of
 * validation messages).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.toErrorResponse(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private toErrorResponse(exception: unknown): {
    status: number;
    body: ErrorResponseBody;
  } {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        error: 'Internal Server Error',
      },
    };
  }

  private fromHttpException(exception: HttpException): {
    status: number;
    body: ErrorResponseBody;
  } {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return {
        status,
        body: { statusCode: status, message: payload, error: exception.name },
      };
    }

    const record = payload as Record<string, unknown>;
    const rawMessage = record.message ?? exception.message;
    let message: string | string[];
    if (Array.isArray(rawMessage)) {
      message = rawMessage.map((entry) => String(entry));
    } else if (typeof rawMessage === 'string') {
      message = rawMessage;
    } else {
      message = exception.message;
    }

    return {
      status,
      body: {
        statusCode: status,
        message,
        error: typeof record.error === 'string' ? record.error : exception.name,
      },
    };
  }

  private fromPrismaError(exception: Prisma.PrismaClientKnownRequestError): {
    status: number;
    body: ErrorResponseBody;
  } {
    switch (exception.code) {
      case 'P2002': {
        const target = exception.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : 'field';
        return {
          status: HttpStatus.CONFLICT,
          body: {
            statusCode: HttpStatus.CONFLICT,
            message: `Unique constraint failed on: ${fields}`,
            error: 'Conflict',
          },
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: {
            statusCode: HttpStatus.NOT_FOUND,
            message: 'Resource not found',
            error: 'Not Found',
          },
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            statusCode: HttpStatus.CONFLICT,
            message: 'Operation violates a relation constraint',
            error: 'Conflict',
          },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Internal server error',
            error: 'Internal Server Error',
          },
        };
    }
  }
}
