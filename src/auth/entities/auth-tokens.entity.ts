import { ApiProperty } from '@nestjs/swagger';
import { UserEntity } from '../../users/entities/user.entity';

export class AuthTokensEntity {
  @ApiProperty({ type: () => UserEntity })
  user!: UserEntity;

  @ApiProperty({ description: 'Short-lived access JWT (default 15 min)' })
  accessToken!: string;

  @ApiProperty({
    description: 'Long-lived refresh JWT rotated on use (default 7 days)',
  })
  refreshToken!: string;
}
