import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Generic audit logger
 */
export async function logAudit({
  companyId,
  employeeId,
  action,
  entityType,
  entityId,
  metadata = null
}: {
  companyId: number;
  employeeId: number;
  action: string;
  entityType: string;
  entityId: number;
  metadata?: any;
}) {
  await prisma.auditLog.create({
    data: {
      companyId,
      employeeId,
      action,
      entityType,
      entityId,
      metadata,
    },
  });
}
