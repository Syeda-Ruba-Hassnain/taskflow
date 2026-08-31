import prisma from "@/lib/prisma";
import { Prisma, PasswordResetToken } from "@prisma/client";

type PrismaClientOrTransaction =
  | typeof prisma
  | Prisma.TransactionClient;

export class PasswordResetTokenRepository {
  // Deliberately not `async`: this must stay a raw
  // Prisma.PrismaPromise (not one wrapped by an async function) so
  // callers can include it directly inside a `prisma.$transaction([...])`
  // batch array, which requires the original query promise.
  create(
    data: Prisma.PasswordResetTokenCreateInput,
    client: PrismaClientOrTransaction = prisma
  ): Prisma.PrismaPromise<PasswordResetToken> {
    return client.passwordResetToken.create({ data });
  }

  async findByHash<
    T extends Prisma.PasswordResetTokenSelect | undefined = undefined
  >(
    tokenHash: string,
    select?: T,
    client: PrismaClientOrTransaction = prisma
  ): Promise<
    T extends Prisma.PasswordResetTokenSelect
      ? Prisma.PasswordResetTokenGetPayload<{ select: T }> | null
      : PasswordResetToken | null
  > {
    const result = select
      ? await client.passwordResetToken.findUnique({
          where: { token: tokenHash },
          select,
        })
      : await client.passwordResetToken.findUnique({
          where: { token: tokenHash },
        });

    return result as T extends Prisma.PasswordResetTokenSelect
      ? Prisma.PasswordResetTokenGetPayload<{ select: T }> | null
      : PasswordResetToken | null;
  }

  async delete(
    id: number,
    client: PrismaClientOrTransaction = prisma
  ): Promise<PasswordResetToken> {
    return client.passwordResetToken.delete({
      where: { id },
    });
  }

  // See create — kept as a raw Prisma.PrismaPromise for the same
  // `prisma.$transaction([...])` batch-array compatibility reason.
  deleteMany(
    where: Prisma.PasswordResetTokenWhereInput,
    client: PrismaClientOrTransaction = prisma
  ): Prisma.PrismaPromise<Prisma.BatchPayload> {
    return client.passwordResetToken.deleteMany({ where });
  }

  // See create — kept as a raw Prisma.PrismaPromise for the same
  // `prisma.$transaction([...])` batch-array compatibility reason.
  deleteByEmail(
    email: string,
    client: PrismaClientOrTransaction = prisma
  ): Prisma.PrismaPromise<Prisma.BatchPayload> {
    return client.passwordResetToken.deleteMany({
      where: { email },
    });
  }
}

export const passwordResetTokenRepository =
  new PasswordResetTokenRepository();
