import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** The interactive-transaction flavour of the client, for services that take a tx. */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
