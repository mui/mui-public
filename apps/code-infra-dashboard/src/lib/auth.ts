import { betterAuth } from 'better-auth';
import { createAuthMiddleware, APIError } from 'better-auth/api';

export const auth = betterAuth({
  // Stateless mode - no database required
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 7 * 24 * 60 * 60, // 7 days
      strategy: 'jwe', // Encrypted JWT
      refreshCache: true,
    },
  },
  account: {
    accountLinking: {
      enabled: false,
    },
  },

  // Google OAuth
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      scope: ['email', 'profile'],
    },
  },

  // Email domain whitelist via hooks
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // Check after OAuth callback completes
      if (ctx.path.startsWith('/callback/')) {
        const user = ctx.context?.newSession?.user;

        // SECURITY: Fail closed - reject if no email or not from allowed domain
        if (!user?.email) {
          throw new APIError('FORBIDDEN', {
            message: 'Email is required for authentication',
          });
        }

        if (!user.emailVerified) {
          throw new APIError('FORBIDDEN', {
            message: 'Email must be verified',
          });
        }

        if (!user.email.endsWith('@mui.com')) {
          throw new APIError('FORBIDDEN', {
            message: 'Only @mui.com email addresses are allowed',
          });
        }
      }
    }),
  },
});
