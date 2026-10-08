import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export interface CreatePaymentIntentInput {
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  idempotencyKey?: string;
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string | null;
  currency: string;
  status: string;
}

/**
 * Thin injectable wrapper around the Stripe SDK. Tests override this provider
 * so no network calls are made; production keys come from STRIPE_SECRET_KEY.
 */
@Injectable()
export class StripeService {
  private readonly client: Stripe;
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    const secretKey = config.get<string>('STRIPE_SECRET_KEY')?.trim() ?? '';
    this.configured = secretKey !== '';
    // The placeholder keeps the SDK constructible without a key (webhook
    // signature verification is local); real API calls are guarded below.
    this.client = new Stripe(
      this.configured ? secretKey : 'sk_test_placeholder',
    );
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<PaymentIntentResult> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Stripe is not configured (set STRIPE_SECRET_KEY)',
      );
    }

    const intent = await this.client.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency,
        metadata: input.metadata,
        automatic_payment_methods: { enabled: true },
      },
      input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : undefined,
    );

    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      currency: intent.currency,
      status: intent.status,
    };
  }

  /** Verifies a webhook payload signature (local HMAC, no network call). */
  constructEvent(
    payload: Buffer,
    signature: string,
    secret: string,
  ): Stripe.Event {
    return this.client.webhooks.constructEvent(payload, signature, secret);
  }
}
