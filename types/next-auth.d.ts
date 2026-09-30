import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      roleId: string;
      roleSlug: string;
      roleName: string;
      isSuperAdmin: boolean;
      mustChangePassword: boolean;
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    roleId: string;
    roleSlug: string;
    roleName: string;
    isSuperAdmin: boolean;
    mustChangePassword: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    roleId: string;
    roleSlug: string;
    roleName: string;
    isSuperAdmin: boolean;
    mustChangePassword: boolean;
    lastValidated: number;
    invalidated?: boolean;
  }
}
