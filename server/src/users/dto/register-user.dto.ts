import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export const API_CHAINS = ['bitcoin', 'dogecoin'] as const;
export type ApiChain = (typeof API_CHAINS)[number];

export class RegisterUserDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 128)
  externalUserId!: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(API_CHAINS, { each: true })
  chains?: ApiChain[];
}
