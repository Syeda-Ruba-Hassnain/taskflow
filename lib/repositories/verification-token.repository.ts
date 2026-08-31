import prisma from "@/lib/prisma";
import { Prisma, VerificationToken } from "@prisma/client";

type PrismaClientOrTransaction =
  | typeof prisma
  | Prisma.TransactionClient;

export class VerificationTokenRepository {
  // Deliberately not `async`: this must stay a raw
  // Prisma.PrismaPromise (not one wrapped by an async function) so
  // callers can include it directly inside a `prisma.$transaction([...])`
  // batch array, which requires the original query promise.
  create(
    data: Prisma.VerificationTokenCreateInput,
    client: PrismaClientOrTransaction = prisma
  ): Prisma.PrismaPromise<VerificationToken> {
    return client.verificationToken.create({ data });
  }

  async findByHash<
    T extends Prisma.VerificationTokenSelect | undefined = undefined
  >(
    tokenHash: string,
    select?: T,
    client: PrismaClientOrTransaction = prisma
  ): Promise<
    T extends Prisma.VerificationTokenSelect
      ? Prisma.VerificationTokenGetPayload<{ select: T }> | null
      : VerificationToken | null
  > {
    const result = select
      ? await client.verificationToken.findUnique({
          where: { token: tokenHash },
          select,
        })
      : await client.verificationToken.findUnique({
          where: { token: tokenHash },
        });

    return result as T extends Prisma.VerificationTokenSelect
      ? Prisma.VerificationTokenGetPayload<{ select: T }> | null
      : VerificationToken | null;
  }

  async delete(
    id: number,
    client: PrismaClientOrTransaction = prisma
  ): Promise<VerificationToken> {
    return client.verificationToken.delete({
      where: { id },
    });
  }

  // See create — kept as a raw Prisma.PrismaPromise for the same
  // `prisma.$transaction([...])` batch-array compatibility reason.
  deleteMany(
    where: Prisma.VerificationTokenWhereInput,
    client: PrismaClientOrTransaction = prisma
  ): Prisma.PrismaPromise<Prisma.BatchPayload> {
    return client.verificationToken.deleteMany({ where });
  }

  // See create — kept as a raw Prisma.PrismaPromise for the same
  // `prisma.$transaction([...])` batch-array compatibility reason.
  deleteByEmail(
    email: string,
    client: PrismaClientOrTransaction = prisma
  ): Prisma.PrismaPromise<Prisma.BatchPayload> {
    return client.verificationToken.deleteMany({
      where: { email },
    });
  }
}

export const verificationTokenRepository =
  new VerificationTokenRepository();
