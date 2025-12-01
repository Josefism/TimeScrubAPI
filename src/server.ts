import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import { PrismaClient, Role } from "@prisma/client";
import authRoutes from "./routes/auth";
import { requireAuth, AuthenticatedRequest } from "./middleware/auth";
import { logAudit } from "./services/audit";
import { before } from "node:test";

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());
app.use(authRoutes);

// --- Routes ---

// Healthcheck
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Current user info
app.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const employee = await prisma.employee.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      companyId: true,
      company: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  res.json(employee);
});

// --- Companies ---

// Get current user's company
app.get("/companies/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
  });

  res.json(company);
});

// --- Employees ---

// List employees for the current company (admin only)
app.get("/admin/employees", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!
  
  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" })
  }
    const employees = await prisma.employee.findMany({
    where: { companyId: user.companyId, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  });

  res.json(employees);
});

// Admin create employee
app.post("/admin/employees", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" })
  }

  const { email, name, password, role } = req.body

  if (!email || !name || !password || !role) {
    return res
      .status(400)
      .json({ error: "Missing required fields: email, name, password, role" })
  }

  const validRoles = ["EMPLOYEE", "ADMIN"]
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role" })
  }

  const existing = await prisma.employee.findUnique({
    where: { email },
  })

  if (existing) {
    return res.status(409).json({ error: "Email already exists" })
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const employee = await prisma.employee.create({
    data: {
      email,
      name,
      passwordHash,
      role,
      companyId: user.companyId,
    },
  })

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "EMPLOYEE_CREATED",
    entityType: "EMPLOYEE",
    entityId: employee.id,
    metadata: {
      email,
      name,
      role,
    },
  });

  res.status(201).json(employee)
})

// Edit an employee (admin only)
app.put("/admin/employees/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const id = Number(req.params.id);
  const { name, role, email } = req.body;

  // fetch before state
  const before = await prisma.employee.findUnique({
    where: { id }
  })

  if (!before || before.companyId !== user.companyId) {
    return res.status(404).json({ error: "Employee not found" })
  }

  const employee = await prisma.employee.update({
    where: { id },
    data: {
      name,
      role,
      email,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "EMPLOYEE_UPDATED",
    entityType: "EMPLOYEE",
    entityId: employee.id,
    metadata: {
      before: { id, name, role, email },
      after: { name, role, email },
    },
  });

  res.json(employee);
});

// Archive (soft delete) an employee (admin only)
app.delete("/admin/employees/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const id = Number(req.params.id);

  await prisma.employee.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: user.id,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "EMPLOYEE_DELETED",
    entityType: "EMPLOYEE",
    entityId: id,
  });

  res.json({ success: true });
});

// Restore a soft-deleted employee (admin only)
app.post("/admin/employees/:id/restore", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const id = Number(req.params.id);

  await prisma.employee.update({
    where: { id },
    data: {
      deletedAt: null,
      deletedBy: null,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "EMPLOYEE_RESTORED",
    entityType: "EMPLOYEE",
    entityId: id,
  });

  res.json({ success: true });
});

// --- Jobs ---

// List jobs for the current company
app.get("/jobs", requireAuth, async (req: AuthenticatedRequest, res) => {
  const jobs = await prisma.job.findMany({
    where: {
      companyId: req.user!.companyId,
      deletedAt: null,
    },
    orderBy: { name: "asc" }
  });

  res.json(jobs);
});

// Admin: list jobs INCLUDING archived
app.get("/admin/jobs", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" })
  }

  const jobs = await prisma.job.findMany({
    where: {
      companyId: user.companyId
    },
    orderBy: { name: "asc" }
  });

  res.json(jobs)
});

// Create a job (admin only) for the current company
app.post("/admin/jobs", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const {
    name,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    jobNote,
  } = req.body;

  if (!name || !addressLine1 || !city || !state || !postalCode) {
    return res.status(400).json({ error: "Missing required job fields." });
  }

  const job = await prisma.job.create({
    data: {
      companyId: user.companyId,
      name,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country: country ?? "US",
      jobNote,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "JOB_CREATED",
    entityType: "JOB",
    entityId: job.id,
    metadata: {
      name,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country: country ?? "US",
      jobNote,
    },
  });

  res.status(201).json(job);
});

// Edit a job (admin only)
app.put("/admin/jobs/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!
  const id = Number(req.params.id)

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" })
  }

  const {
    name, addressLine1, addressLine2, city, state, postalCode, country, jobNote
  } = req.body

  // fetch before state
  const before = await prisma.job.findUnique({
    where: { id }
  })

  if (!before || before.companyId !== user.companyId) {
    return res.status(404).json({ error: "Job not found" })
  }

  const job = await prisma.job.update({
    where: { id },
    data: {
      name,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      jobNote,
    },
  })

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "JOB_UPDATED",
    entityType: "JOB",
    entityId: job.id,
    metadata: {
      before: { id, name, addressLine1, addressLine2, city, state, postalCode, country, jobNote },
      after: { name, addressLine1, addressLine2, city, state, postalCode, country, jobNote },
    },
  });

  res.json(job)
})

// Archive (soft delete) a job (admin only)
app.delete("/admin/jobs/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const id = Number(req.params.id);

  await prisma.job.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: user.id,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "JOB_DELETED",
    entityType: "JOB",
    entityId: id,
  });

  res.json({ success: true });
});

// Restore a soft-deleted job (admin only)
app.post("/admin/jobs/:id/restore", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const id = Number(req.params.id);

  await prisma.job.update({
    where: { id },
    data: {
      deletedAt: null,
      deletedBy: null,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "JOB_RESTORED",
    entityType: "JOB",
    entityId: id,
  });

  res.json({ success: true });
});

// --- Time entries ---

// Create a time entry (called when employee saves a time block)
app.post("/time-entries", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = (req as any).user;

  const { jobId, start, end, durationMs, timeNote } = req.body;

  if (!jobId || !start || !end || !durationMs) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // Optional safety: ensure job belongs to same company
  const job = await prisma.job.findFirst({
    where: {
      id: Number(jobId),
      companyId: req.user!.companyId,
      deletedAt: null,
    },
  });

  if (!job) {
    return res.status(400).json({ error: "Job not found in this company." });
  }

  const entry = await prisma.timeEntry.create({
    data: {
      companyId: req.user!.companyId,
      employeeId: req.user!.id,
      jobId: job.id,
      start: new Date(start),
      end: new Date(end),
      durationMs,
      timeNote,
    },
  });

  res.status(201).json(entry);
});

// Get time entries (employee: their own; admin: any employee within the company)
app.get("/time-entries", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = (req as any).user;
  const { from, to, employeeId } = req.query as {
    from?: string;
    to?: string;
    employeeId?: string;
  };

  const where: any = {
    companyId: user.companyId,
  };

  // employee restriction
  if (user.role === "EMPLOYEE") {
    where.employeeId = user.id;
  } else if (employeeId) {
    where.employeeId = Number(employeeId);
  }

  // date range
  if (from || to) {
    where.start = {};
    if (from) {
      where.start.gte = new Date(from);
    }
    if (to) {
      where.start.lte = new Date(to);
    }
  }

  const entries = await prisma.timeEntry.findMany({
    where: { companyId: req.user!.companyId },
    orderBy: { start: "desc" },
    include: {
      job: true,
      employee: { select: { id: true, name: true } },
    },
  });

  res.json(entries);
});

// --- Audit Logs ---

// Admin: view audit log for the company
app.get("/admin/audit-log", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const logs = await prisma.auditLog.findMany({
    where: { companyId: user.companyId },
    orderBy: { timestamp: "desc" },
    include: {
      employee: { select: { id: true, name: true } }
    }
  });

  res.json(logs);
});


// --- Start server ---
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`TimeScrub API listening on http://localhost:${port}`);
});