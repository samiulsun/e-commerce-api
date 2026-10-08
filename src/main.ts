import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // rawBody: true preserves the exact webhook payload bytes for Stripe
  // signature verification.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('E-Commerce API')
    .setDescription(
      'NestJS + Prisma + PostgreSQL e-commerce API with Stripe (test mode) payments.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
