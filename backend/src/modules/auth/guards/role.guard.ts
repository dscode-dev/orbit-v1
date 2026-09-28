import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../../../shared/constants/auth.constants';
import { ERROR_CODES } from '../../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../../shared/exceptions/application.exception';
import type { RequestWithId } from '../../../shared/types/request-with-id.type';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<RequestWithId>().user;
    if (!user || !roles.includes(user.role)) {
      throw new ApplicationException(
        ERROR_CODES.FORBIDDEN,
        'Seu perfil não tem acesso a este recurso',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
