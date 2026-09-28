import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../shared/constants/auth.constants';
import { ERROR_CODES } from '../../../shared/constants/error-codes.constants';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY } from '../../../shared/decorators/allow-password-change-required.decorator';
import { ApplicationException } from '../../../shared/exceptions/application.exception';
import type { RequestWithId } from '../../../shared/types/request-with-id.type';

@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, targets)
    ) {
      return true;
    }

    const user = context.switchToHttp().getRequest<RequestWithId>().user;
    if (user?.mustChangePassword) {
      throw new ApplicationException(
        ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
        'Troque a sua senha antes de continuar',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
