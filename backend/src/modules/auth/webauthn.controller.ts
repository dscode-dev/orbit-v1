import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import type { TokenPairResponseDto } from './dto/auth-response.dto';
import { WebAuthnLoginVerifyDto, WebAuthnRegistrationVerifyDto } from './dto/webauthn.dto';
import type { AuthRequestContext } from './types/jwt-payload.type';
import { WebAuthnService, type PasskeyResponse } from './webauthn.service';

/** Login por biometria (passkeys). Cadastro e gestão exigem sessão; login é público. */
@Controller('auth/webauthn')
export class WebAuthnController {
  constructor(private readonly webauthn: WebAuthnService) {}

  @Public()
  @Get('status')
  status(): { enabled: boolean } {
    return this.webauthn.status();
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('registration/options')
  registrationOptions(@CurrentUser() user: AuthenticatedUser): Promise<unknown> {
    return this.webauthn.registrationOptions(user);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('registration/verify')
  verifyRegistration(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: WebAuthnRegistrationVerifyDto,
    @Req() request: RequestWithId,
  ): Promise<PasskeyResponse> {
    return this.webauthn.verifyRegistration(user, body, this.context(request));
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('authentication/options')
  authenticationOptions(): Promise<unknown> {
    return this.webauthn.authenticationOptions();
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('authentication/verify')
  verifyAuthentication(
    @Body() body: WebAuthnLoginVerifyDto,
    @Req() request: RequestWithId,
  ): Promise<TokenPairResponseDto> {
    return this.webauthn.verifyAuthentication(body, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @Get('credentials')
  list(@CurrentUser() user: AuthenticatedUser): Promise<PasskeyResponse[]> {
    return this.webauthn.list(user);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER)
  @HttpCode(HttpStatus.OK)
  @Delete('credentials/:id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() request: RequestWithId,
  ): Promise<{ deleted: true }> {
    return this.webauthn.remove(user, id, this.context(request));
  }

  private context(request: RequestWithId): AuthRequestContext {
    return { requestId: request.requestId, ip: request.ip || null, userAgent: request.get('user-agent') ?? null };
  }
}
