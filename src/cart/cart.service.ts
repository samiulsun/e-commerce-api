import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

const cartInclude = {
  items: { include: { product: true } },
} satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export interface CartItemView {
  id: string;
  productId: string;
  quantity: number;
  product: CartWithItems['items'][number]['product'];
  lineTotalCents: number;
}

export interface CartResponse {
  id: string;
  items: CartItemView[];
  subtotalCents: number;
  itemCount: number;
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(userId: string): Promise<CartResponse> {
    const cart = await this.getOrCreateCartWithItems(userId);
    return this.toView(cart);
  }

  async addItem(userId: string, dto: AddCartItemDto): Promise<CartResponse> {
    const cart = await this.getOrCreateCart(userId);

    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, isActive: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // The increment happens inside the transaction; if the resulting quantity
    // exceeds stock the throw aborts the transaction and the increment is
    // rolled back — quantities are never silently clamped.
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.cartItem.upsert({
        where: {
          cartId_productId: { cartId: cart.id, productId: product.id },
        },
        create: {
          cartId: cart.id,
          productId: product.id,
          quantity: dto.quantity,
        },
        update: { quantity: { increment: dto.quantity } },
      });

      if (item.quantity > product.stock) {
        throw new BadRequestException(
          `Requested quantity ${item.quantity} exceeds available stock ${product.stock}`,
        );
      }
    });

    return this.getCart(userId);
  }

  async updateItem(
    userId: string,
    itemId: string,
    dto: UpdateCartItemDto,
  ): Promise<CartResponse> {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId } },
      include: { product: true },
    });
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    if (dto.quantity > item.product.stock) {
      throw new BadRequestException(
        `Requested quantity ${dto.quantity} exceeds available stock ${item.product.stock}`,
      );
    }

    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: dto.quantity },
    });

    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartResponse> {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId } },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    await this.prisma.cartItem.delete({ where: { id: item.id } });

    return this.getCart(userId);
  }

  async clearCart(userId: string): Promise<CartResponse> {
    await this.prisma.cartItem.deleteMany({
      where: { cart: { userId } },
    });

    return this.getCart(userId);
  }

  private getOrCreateCart(userId: string) {
    return this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  private getOrCreateCartWithItems(userId: string) {
    return this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: cartInclude,
    });
  }

  private toView(cart: CartWithItems): CartResponse {
    const items: CartItemView[] = cart.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      product: item.product,
      lineTotalCents: item.product.priceCents * item.quantity,
    }));

    return {
      id: cart.id,
      items,
      subtotalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }
}
