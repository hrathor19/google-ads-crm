'use client';

import { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { BrandMark } from '@/components/shell/brand-mark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z.object({
  email: z.string().min(1, 'Enter your email').email('That does not look like an email address'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

/**
 * Why a Google sign-in was turned away.
 *
 * Each one is a different thing to do next, so they are distinct messages:
 * a personal address has to use a work account, an unknown address has to
 * be added by an admin, and a deactivated one is not coming back on its own.
 */
const OAUTH_ERRORS: Record<string, string> = {
  Domain: 'That account is not on the company domain. Sign in with your @kollegeapply.com address.',
  NoAccount:
    'No access yet for that address. Ask an administrator to add you, then sign in again.',
  Deactivated: 'That account has been deactivated. Ask an administrator to restore it.',
  NoEmail: 'Google did not return an email address for that account.',
  OAuthAccountNotLinked: 'That address already signs in with a password. Use the form below.',
  OAuthSignin: 'Google sign-in could not start. Try again, or use your password.',
  OAuthCallback: 'Google sign-in did not complete. Try again, or use your password.',
  AccessDenied: 'Google sign-in was refused for that account.',
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [googleBusy, setGoogleBusy] = useState(false);
  // NextAuth redirects back here with ?error= when the signIn callback
  // refuses, so the reason survives the round trip through Google.
  const oauthError = params.get('error');
  const [error, setError] = useState<string | null>(
    oauthError ? (OAUTH_ERRORS[oauthError] ?? 'Google sign-in failed. Try again.') : null
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setError(null);
    const result = await signIn('credentials', {
      email: values.email.trim().toLowerCase(),
      password: values.password,
      redirect: false,
    });

    if (result?.error) {
      // The rate limiter throws a message worth showing verbatim ("try again
      // in N minutes"); anything else stays deliberately vague so the form
      // can't be used to discover which addresses exist.
      setError(
        result.error === 'CredentialsSignin'
          ? 'Those credentials are not right, or the account is inactive.'
          : result.error
      );
      return;
    }
    router.push(params.get('callbackUrl') ?? '/dashboard');
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm animate-fade-in-up shadow-lg">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
          <BrandMark className="h-7 w-8" />
        </div>
        <div>
          <CardTitle className="text-xl">KollegeApply Ads CRM</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@kollegeapply.com"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <p id="email-error" className="text-xs text-destructive">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
            {errors.password && (
              <p id="password-error" className="text-xs text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="btn-sheen w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </form>

        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-card px-2 text-xs uppercase tracking-wide text-muted-foreground">
              or
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={googleBusy}
          onClick={() => {
            setGoogleBusy(true);
            // A full redirect, not the popup: the callback is what runs the
            // domain and account checks, and it has to reach the server.
            void signIn('google', { callbackUrl: '/dashboard' });
          }}
        >
          {googleBusy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <GoogleMark className="mr-2 h-4 w-4" />
          )}
          Continue with Google
        </Button>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Google sign-in is limited to @kollegeapply.com accounts that already have access.
        </p>
      </CardContent>
    </Card>
  );
}

/** Google's mark, inline so the button loads nothing from a third party. */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14Z"
      />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
