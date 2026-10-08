import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

const USERS = [
  {
    email: 'admin@example.com',
    password: 'Admin123!',
    name: 'Store Admin',
    role: Role.ADMIN,
  },
  {
    email: 'user@example.com',
    password: 'User123!',
    name: 'Sam Shopper',
    role: Role.USER,
  },
];

const CATEGORIES = [
  { name: 'Electronics', slug: 'electronics' },
  { name: 'Books', slug: 'books' },
  { name: 'Apparel', slug: 'apparel' },
];

const PRODUCTS = [
  {
    sku: 'ELE-001',
    name: 'Wireless Headphones',
    description: 'Over-ear noise-cancelling headphones with 30h battery.',
    priceCents: 19999,
    stock: 25,
    categorySlug: 'electronics',
  },
  {
    sku: 'ELE-002',
    name: 'Mechanical Keyboard',
    description: '75% hot-swappable keyboard with tactile switches.',
    priceCents: 12999,
    stock: 40,
    categorySlug: 'electronics',
  },
  {
    sku: 'ELE-003',
    name: '4K Monitor',
    description: '27-inch IPS 4K monitor with USB-C power delivery.',
    priceCents: 34999,
    stock: 15,
    categorySlug: 'electronics',
  },
  {
    sku: 'ELE-004',
    name: 'USB-C Hub',
    description: '7-in-1 USB-C hub with HDMI, ethernet and card readers.',
    priceCents: 4999,
    stock: 60,
    categorySlug: 'electronics',
  },
  {
    sku: 'BOO-001',
    name: 'Clean Code',
    description: 'A handbook of agile software craftsmanship.',
    priceCents: 3499,
    stock: 30,
    categorySlug: 'books',
  },
  {
    sku: 'BOO-002',
    name: 'The Pragmatic Programmer',
    description: 'Your journey to mastery, 20th anniversary edition.',
    priceCents: 4299,
    stock: 22,
    categorySlug: 'books',
  },
  {
    sku: 'BOO-003',
    name: 'Designing Data-Intensive Applications',
    description: 'The big ideas behind reliable, scalable systems.',
    priceCents: 4999,
    stock: 18,
    categorySlug: 'books',
  },
  {
    sku: 'APP-001',
    name: 'Cotton T-Shirt',
    description: 'Heavyweight organic cotton t-shirt, unisex fit.',
    priceCents: 1999,
    stock: 100,
    categorySlug: 'apparel',
  },
  {
    sku: 'APP-002',
    name: 'Denim Jacket',
    description: 'Classic selvedge denim jacket with corduroy collar.',
    priceCents: 7999,
    stock: 20,
    categorySlug: 'apparel',
  },
  {
    sku: 'APP-003',
    name: 'Running Shoes',
    description: 'Lightweight daily trainers with responsive foam.',
    priceCents: 11999,
    stock: 35,
    categorySlug: 'apparel',
  },
];

async function seedUsers(): Promise<void> {
  for (const user of USERS) {
    const passwordHash = await bcrypt.hash(user.password, BCRYPT_ROUNDS);
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, passwordHash },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash,
      },
    });
  }
}

async function seedCategories(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const category of CATEGORIES) {
    const record = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category,
    });
    ids.set(category.slug, record.id);
  }
  return ids;
}

async function seedProducts(categoryIds: Map<string, string>): Promise<void> {
  for (const product of PRODUCTS) {
    const categoryId = categoryIds.get(product.categorySlug);
    if (!categoryId) {
      throw new Error(`Unknown category slug: ${product.categorySlug}`);
    }
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {
        name: product.name,
        description: product.description,
        priceCents: product.priceCents,
        stock: product.stock,
        categoryId,
        isActive: true,
      },
      create: {
        sku: product.sku,
        name: product.name,
        description: product.description,
        priceCents: product.priceCents,
        stock: product.stock,
        categoryId,
      },
    });
  }
}

async function main(): Promise<void> {
  await seedUsers();
  const categoryIds = await seedCategories();
  await seedProducts(categoryIds);

  console.log('Seed complete:');
  console.log(
    `  Users:      ${USERS.length} (${USERS.map((u) => u.email).join(', ')})`,
  );
  console.log(`  Categories: ${CATEGORIES.length}`);
  console.log(`  Products:   ${PRODUCTS.length}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
