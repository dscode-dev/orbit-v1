import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '../../../shared/constants/error-codes.constants';
import { ApplicationException } from '../../../shared/exceptions/application.exception';
import type { RequestWithId } from '../../../shared/types/request-with-id.type';
import { CustomerPortalService } from '../customer-portal.service';

@Injectable()
export class CustomerPortalAuthGuard implements CanActivate {
  constructor(private readonly portal: CustomerPortalService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithId & { customerPortal?: unknown }>();
    const authorization = request.get('authorization');
    const [scheme, token, extra] = authorization?.split(/\s+/) ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
      throw new ApplicationException(
        ERROR_CODES.UNAUTHORIZED,
        'Bearer customer access token is required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const account = await this.portal.validateCustomerAccessToken(token);
    const passwordGateAllowed =
      request.path.endsWith('/customer/me') || request.path.endsWith('/customer/change-password');
    if (account.mustChangePassword && !passwordGateAllowed) {
      throw new ApplicationException(
        ERROR_CODES.PASSWORD_CHANGE_REQUIRED,
        'Troque a senha temporária antes de continuar',
        HttpStatus.FORBIDDEN,
      );
    }
    request.customerPortal = account;
    return true;
  }
}
