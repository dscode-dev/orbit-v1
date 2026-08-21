export interface AuthenticatedCustomerPortalAccount {
  id: string;
  organizationId: string;
  customerId: string;
  email: string;
  name: string;
  isActive: boolean;
  mustChangePassword: boolean;
}
