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

  /**
   * What `authorize` returns. Google hands back only a profile, so these
   * fields are filled from `crm_users` in the jwt callback instead — which
   * is why every one of them is optional here.
   */
  interface User {
    id: string;
    email?: string | null;
    name?: string | null;
    roleId?: string;
    roleSlug?: string;
    roleName?: string;
    isSuperAdmin?: boolean;
    mustChangePassword?: boolean;
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
    /** Which provider minted this token; 'google' skips the password gate. */
    provider?: 'google';
  }
}
