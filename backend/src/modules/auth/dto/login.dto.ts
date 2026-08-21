import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export enum LoginChannel {
  PLATFORM = 'PLATFORM',
  OPERATOR = 'OPERATOR',
}

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @IsEnum(LoginChannel)
  channel?: LoginChannel;
}
