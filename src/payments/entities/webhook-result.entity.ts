import { ApiProperty } from '@nestjs/swagger';

export class WebhookResultEntity {
  @ApiProperty({ example: true })
  received!: true;

  @ApiProperty({
    example: true,
    description:
      'true when the event type was acted upon, false when ignored (foreign PI, unknown type)',
  })
  handled!: boolean;
}
