import { IsUUID } from 'class-validator';

export class AckOutboxDto {
  @IsUUID()
  deliveryToken!: string;
}
