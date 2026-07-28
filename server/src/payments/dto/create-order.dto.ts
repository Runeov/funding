import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { API_CHAINS, type ApiChain } from '../../users/dto/register-user.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateOrderDto {
  @Transform(trim)
  @IsString()
  @Length(1, 128)
  externalOrderId!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 128)
  externalUserId!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 256)
  itemRef!: string;

  @IsIn(API_CHAINS)
  chain!: ApiChain;

  @Transform(trim)
  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  expectedAmountAtomic!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  requiredConfirmations = 3;

  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}
