import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

/** The public user projection — passwordHash deliberately absent. */
export class UserEntity {
  @ApiProperty({ example: 'cm0...' })
  id!: string;

  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name!: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role!: Role;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: Date;
}
