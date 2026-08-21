import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithId } from '../../shared/types/request-with-id.type';
import type { AuthenticatedCustomerPortalAccount } from './customer-portal.types';

export const CurrentCustomerPortalAccount = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedCustomerPortalAccount => {
    const request = context.switchToHttp().getRequest<
      RequestWithId & { customerPortal: AuthenticatedCustomerPortalAccount }
    >();
    return request.customerPortal;
  },
);
