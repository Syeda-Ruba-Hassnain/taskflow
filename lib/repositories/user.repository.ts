import prisma from "@/lib/prisma";
import { Prisma, User } from "@prisma/client";

type PrismaClientOrTransaction =
  | typeof prisma
  | Prisma.TransactionClient;

export class UserRepository {
  async findById<T extends Prisma.UserSelect | undefined = undefined>(
    id: number,
    select?: T,
    client: PrismaClientOrTransaction = prisma
  ): Promise<
    T extends Prisma.UserSelect
      ? Prisma.UserGetPayload<{ select: T }> | null
      : User | null
  > {
    const result = select
      ? await client.user.findUnique({ where: { id }, select })
      : await client.user.findUnique({ where: { id } });

    return result as T extends Prisma.UserSelect
      ? Prisma.UserGetPayload<{ select: T }> | null
      : User | null;
  }

  async findByEmail<T extends Prisma.UserSelect | undefined = undefined>(
    email: string,
    select?: T,
    client: PrismaClientOrTransaction = prisma
  ): Promise<
    T extends Prisma.UserSelect
      ? Prisma.UserGetPayload<{ select: T }> | null
      : User | null
  > {
    const result = select
      ? await client.user.findUnique({ where: { email }, select })
      : await client.user.findUnique({ where: { email } });

    return result as T extends Prisma.UserSelect
      ? Prisma.UserGetPayload<{ select: T }> | null
      : User | null;
  }

  async create(
    data: Prisma.UserCreateInput,
    client: PrismaClientOrTransaction = prisma
  ): Promise<
    Pick<User, "id" | "name" | "email" | "createdAt">
  > {
    return client.user.create({
      data,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });
  }

  // Deliberately not `async`: this must stay a raw
  // Prisma.PrismaPromise (not one wrapped by an async function) so
  // callers can include it directly inside a `prisma.$transaction([...])`
  // batch array, which requires the original query promise.
  updatePassword(
    id: number,
    hashedPassword: string
  ): Prisma.PrismaPromise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        password: hashedPassword,
      },
    });
  }

  async updateProfile(
    id: number,
    data: { name: string }
  ): Promise<Pick<User, "id" | "name" | "email">> {
    return prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
  }

  // See updatePassword — kept as a raw Prisma.PrismaPromise for the
  // same `prisma.$transaction([...])` batch-array compatibility reason.
  markEmailVerified(id: number): Prisma.PrismaPromise<User> {
    return prisma.user.update({
      where: { id },
      data: {
        emailVerified: new Date(),
      },
    });
  }

  async delete(
    id: number,
    client: PrismaClientOrTransaction = prisma
  ): Promise<User> {
    return client.user.delete({
      where: { id },
    });
  }
}

export const userRepository = new UserRepository();
