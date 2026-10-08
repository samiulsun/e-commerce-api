import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { CheckoutController } from './checkout.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PaymentsModule],
  controllers: [CheckoutController, OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
