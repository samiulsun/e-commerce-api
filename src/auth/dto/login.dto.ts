import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Sup3rSecret!' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
