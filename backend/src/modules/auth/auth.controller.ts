import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutResponseDto, MeResponseDto, TokenPairResponseDto } from './dto/auth-response.dto';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/types/authenticated-user.type';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import type { AuthRequestContext } from './types/jwt-payload.type';
import { AllowPasswordChangeRequired } from '../../shared/decorators/allow-password-change-required.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() body: LoginDto, @Req() request: RequestWithId): Promise<TokenPairResponseDto> {
    return this.auth.login(body, this.context(request), [Role.OWNER, Role.MANAGER, Role.VIEWER]);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('operator/login')
  operatorLogin(@Body() body: LoginDto, @Req() request: RequestWithId): Promise<TokenPairResponseDto> {
    return this.auth.login(body, this.context(request), [Role.OPERATOR]);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('customer/login')
  customerLogin(@Body() body: LoginDto, @Req() request: RequestWithId): Promise<TokenPairResponseDto> {
    return this.auth.login(body, this.context(request), [Role.CUSTOMER]);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(
    @Body() body: RefreshTokenDto,
    @Req() request: RequestWithId,
  ): Promise<TokenPairResponseDto> {
    return this.auth.refresh(body.refreshToken, this.context(request));
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@Body() body: RefreshTokenDto, @Req() request: RequestWithId): Promise<LogoutResponseDto> {
    return this.auth.logout(body.refreshToken, this.context(request));
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.VIEWER, Role.CUSTOMER)
  @AllowPasswordChangeRequired()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): MeResponseDto {
    return this.auth.me(user);
  }

  private context(request: RequestWithId): AuthRequestContext {
    return {
      requestId: request.requestId,
      ip: request.ip || null,
      userAgent: request.get('user-agent') ?? null,
    };
  }
}
