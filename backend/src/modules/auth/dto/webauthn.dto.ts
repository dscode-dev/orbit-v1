import { Transform } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { LoginChannel } from './login.dto';

/** Resposta do aparelho ao cadastrar a biometria (`navigator.credentials.create`). */
export class WebAuthnRegistrationVerifyDto {
  @IsUUID()
  challengeId!: string;

  @IsObject()
  response!: RegistrationResponseJSON;

  /** Nome para reconhecer o aparelho depois (ex.: "iPhone do João"). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}

/** Resposta do aparelho ao entrar com biometria (`navigator.credentials.get`). */
export class WebAuthnLoginVerifyDto {
  @IsUUID()
  challengeId!: string;

  @IsObject()
  response!: AuthenticationResponseJSON;

  @IsOptional()
  @IsEnum(LoginChannel)
  channel?: LoginChannel;
}
