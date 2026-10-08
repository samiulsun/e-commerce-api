import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService, WebhookHandlingResult } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Stripe delivers events with a text/plain payload; `rawBody: true` on the
   * Nest application preserves the exact bytes for signature verification.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Stripe webhook endpoint (raw body + signature verified before any database work)',
  })
  @ApiOkResponse({ description: '{ received: true, handled: boolean }' })
  @ApiBadRequestResponse({
    description: 'Missing or invalid Stripe signature',
  })
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<WebhookHandlingResult> {
    const event = this.paymentsService.verifyAndParse(
      request.rawBody,
      signature,
    );
    return this.paymentsService.handleEvent(event);
  }
}
