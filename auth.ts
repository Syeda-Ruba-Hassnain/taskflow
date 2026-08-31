import NextAuth, {
  CredentialsSignin,
} from "next-auth";

import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import prisma from "@/lib/prisma";
import { userRepository } from "@/lib/repositories/user.repository";

import {
  rateLimit,
  getRetryAfterSeconds,
} from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

// ==================================
// CUSTOM AUTH ERRORS
// ==================================

class EmailNotVerifiedError extends CredentialsSignin {
  code = "email_not_verified";
}

class TooManyLoginAttemptsError extends CredentialsSignin {
  code = "too_many_login_attempts";
}

// ==================================
// TIMING-SAFE LOGIN
// ==================================
//
// Phase 12 security audit: authorize() used to return immediately
// when no account matched the given email, but ran a bcrypt.compare
// (a deliberately slow, ~50-150ms operation) whenever an account DID
// match. That timing difference is a classic account-enumeration
// side channel — an attacker measuring response times could infer
// which email addresses have accounts without ever seeing an error
// message that says so. This is a syntactically valid bcrypt hash
// (cost 12, matching every other bcrypt.hash call in this app) with
// no corresponding real password — it exists purely so the
// "no such account" path pays the same bcrypt cost as the "wrong
// password" path, so the two are indistinguishable by timing. Never
// used to authenticate anything for real.
const DUMMY_PASSWORD_HASH =
  "$2b$12$iIvWJY0ox8ZN5XSn2XYOGud8zyjHE.eqwYRbNvjr0psX5XuMnjMii";

// ==================================
// NEXTAUTH CONFIGURATION
// ==================================

export const {
  handlers,
  signIn,
  signOut,
  auth,
} = NextAuth({
  session: {
    strategy: "jwt",
  },

  pages: {
    signIn: "/login",
  },

  providers: [
    Credentials({
      credentials: {
        email: {
          label: "Email",
          type: "email",
        },
        password: {
          label: "Password",
          type: "password",
        },
      },

      async authorize(credentials) {
        if (
          !credentials?.email ||
          !credentials?.password
        ) {
          return null;
        }

        if (
          typeof credentials.email !== "string" ||
          typeof credentials.password !== "string"
        ) {
          return null;
        }

        const email =
          credentials.email
            .trim()
            .toLowerCase();

        if (!email) {
          return null;
        }

        const rateLimitKey = `login:${email}`;

        const rateLimitResult =
          await rateLimit({
            key: rateLimitKey,
            limit: 5,
            windowMs: 15 * 60 * 1000,
          });

        if (!rateLimitResult.success) {
          const retryAfter =
            getRetryAfterSeconds(
              rateLimitResult.resetAt
            );

          logger.warn(
            `Login rate limit exceeded for ${email}. Retry after ${retryAfter} seconds.`
          );

          throw new TooManyLoginAttemptsError();
        }

        const user =
          await userRepository.findByEmail(
            email,
            {
              id: true,
              email: true,
              password: true,
              emailVerified: true,
              name: true,
            }
          );

        if (!user) {
          // Pay the same bcrypt cost as a real account with a wrong
          // password would — see DUMMY_PASSWORD_HASH's doc comment.
          // The result is always false (this hash matches no real
          // password); it's only computed for its timing, never
          // checked.
          await bcrypt.compare(
            credentials.password,
            DUMMY_PASSWORD_HASH
          );

          return null;
        }

        const passwordMatches =
          await bcrypt.compare(
            credentials.password,
            user.password
          );

        if (!passwordMatches) {
          return null;
        }

        if (!user.emailVerified) {
          throw new EmailNotVerifiedError();
        }

        await prisma.rateLimit.deleteMany({
          where: {
            key: rateLimitKey,
          },
        });

        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({
      token,
      user,
      trigger,
      session,
    }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
      }

      if (
        trigger === "update" &&
        session?.name &&
        typeof session.name === "string"
      ) {
        token.name = session.name.trim();
      }

      return token;
    },

    async session({
      session,
      token,
    }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.name =
          typeof token.name === "string"
            ? token.name
            : null;
        session.user.email =
          typeof token.email === "string"
            ? token.email
            : "";
      }

      return session;
    },
  },
});
