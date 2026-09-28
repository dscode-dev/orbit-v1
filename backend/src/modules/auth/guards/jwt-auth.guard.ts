import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service';
import { IS_PUBLIC_KEY } from '../../../shared/constants/auth.constants';
import { ApplicationException } from '../../../shared/exceptions/application.exception';
import { ERROR_CODES } from '../../../shared/constants/error-codes.constants';
import { HttpStatus } from '@nestjs/common';
import type { RequestWithId } from '../../../shared/types/request-with-id.type';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithId>();
    const authorization = request.get('authorization');
    const [scheme, token, extra] = authorization?.split(/\s+/) ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
      throw new ApplicationException(
        ERROR_CODES.UNAUTHORIZED,
        'Faça login para continuar: token de acesso ausente ou inválido',
        HttpStatus.UNAUTHORIZED,
      );
    }

    request.user = await this.auth.validateAccessToken(token);
    return true;
  }
}
