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
app.get(
  "/companies/me",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const user = req.user!;

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
    });

    res.json(company);
  }
);

// --- Employees ---

// List employees for the current company (admin only)
app.get(
  "/admin/employees",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const user = req.user!;

    if (user.role !== "ADMIN") {
      return res.status(403).json({ error: "Forbidden" });
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
  }
);

// Admin create employee
app.post(
  "/admin/employees",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const user = req.user!;

    if (user.role !== "ADMIN") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { email, name, password, role } = req.body;

    if (!email || !name || !password || !role) {
      return res
        .status(400)
        .json({
          error: "Missing required fields: email, name, password, role",
        });
    }

    const validRoles = ["EMPLOYEE", "ADMIN"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const existing = await prisma.employee.findUnique({
      where: { email },
    });

    if (existing) {
      return res.status(409).json({ error: "Email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const employee = await prisma.employee.create({
      data: {
        email,
        name,
        passwordHash,
        role,
        companyId: user.companyId,
      },
    });

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

    res.status(201).json(employee);
  }
);

// Edit an employee (admin only)
app.put(
  "/admin/employees/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const user = req.user!;

    if (user.role !== "ADMIN") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const id = Number(req.params.id);
    const { name, role, email } = req.body;

    // fetch before state
    const before = await prisma.employee.findUnique({
      where: { id },
    });

    if (!before || before.companyId !== user.companyId) {
      return res.status(404).json({ error: "Employee not found" });
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
  }
);

// Archive (soft delete) an employee (admin only)
app.delete(
  "/admin/employees/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
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
  }
);

// Restore a soft-deleted employee (admin only)
app.post(
  "/admin/employees/:id/restore",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
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
  }
);

// --- Customers ---

//
// List customers for the current company
//
app.get("/admin/customers", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const showArchived = req.query.showArchived === "true";

  const customers = await prisma.customer.findMany({
    where: {
      companyId: user.companyId,
      ...(showArchived ? {} : { deletedAt: null }),
    },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          locations: true,
          jobs: true,
        },
      },
    },
  });

  res.json(customers);
});

//
// Admin: create customer
//
app.post("/admin/customers", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });

  const {
    name,
    contactName,
    contactEmail,
    contactPhone,
    businessAddressLine1,
    businessAddressLine2,
    businessCity,
    businessState,
    businessPostalCode,
    businessCountry,
    mailingAddressLine1,
    mailingAddressLine2,
    mailingCity,
    mailingState,
    mailingPostalCode,
    mailingCountry,
  } = req.body;

  if (!name || !businessAddressLine1 || !businessCity || !businessState || !businessPostalCode) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const customer = await prisma.customer.create({
    data: {
      companyId: user.companyId,
      name,
      contactName,
      contactEmail,
      contactPhone,
      businessAddressLine1,
      businessAddressLine2,
      businessCity,
      businessState,
      businessPostalCode,
      businessCountry: businessCountry ?? "US",
      mailingAddressLine1,
      mailingAddressLine2,
      mailingCity,
      mailingState,
      mailingPostalCode,
      mailingCountry,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "CUSTOMER_CREATED",
    entityType: "CUSTOMER",
    entityId: customer.id,
    metadata: customer,
  });

  res.status(201).json(customer);
});

//
// Admin: update customer
//
app.put("/admin/customers/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const id = Number(req.params.id);

  if (user.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });

  const before = await prisma.customer.findFirst({
    where: { id, companyId: user.companyId },
  });

  if (!before) return res.status(404).json({ error: "Customer not found" });

  const customer = await prisma.customer.update({
    where: { id },
    data: req.body,
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "CUSTOMER_UPDATED",
    entityType: "CUSTOMER",
    entityId: id,
    metadata: { before, after: customer },
  });

  res.json(customer);
});

//
// Admin: archive (soft delete) customer
//
app.delete("/admin/customers/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const id = Number(req.params.id);

  if (user.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });

  const exists = await prisma.customer.findFirst({
    where: { id, companyId: user.companyId },
  });

  if (!exists) return res.status(404).json({ error: "Customer not found" });

  await prisma.customer.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: user.id,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "CUSTOMER_DELETED",
    entityType: "CUSTOMER",
    entityId: id,
  });

  res.json({ success: true });
});

//
// Admin: restore soft-deleted customer
//
app.post("/admin/customers/:id/restore", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const id = Number(req.params.id);

  if (user.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });

  const exists = await prisma.customer.findFirst({
    where: { id, companyId: user.companyId },
  });

  if (!exists) return res.status(404).json({ error: "Customer not found" });

  await prisma.customer.update({
    where: { id },
    data: {
      deletedAt: null,
      deletedBy: null,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "CUSTOMER_RESTORED",
    entityType: "CUSTOMER",
    entityId: id,
  });

  res.json({ success: true });
});

// --- Job Locations ---

//
// List job locations for a customer
//
app.get("/admin/customers/:customerId/locations", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const customerId = Number(req.params.customerId);
  const showArchived = req.query.showArchived === "true";

  if (user.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId: user.companyId },
  });

  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const locations = await prisma.jobLocation.findMany({
    where: {
      customerId,
      ...(showArchived ? {} : { deletedAt: null }),
    },
    orderBy: { name: "asc" },
  });

  res.json(locations);
});

//
// Admin: create job location for a customer
//
app.post("/admin/customers/:customerId/locations", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const customerId = Number(req.params.customerId);

  if (user.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });

  const {
    name,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
  } = req.body;

  if (!addressLine1 || !city || !state || !postalCode) {
    return res.status(400).json({ error: "Missing required address fields" });
  }

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId: user.companyId },
  });

  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const location = await prisma.jobLocation.create({
    data: {
      customerId,
      name,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country: country ?? "US",
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "LOCATION_CREATED",
    entityType: "LOCATION",
    entityId: location.id,
    metadata: location,
  });

  res.status(201).json(location);
});

//
// Admin: update job location
//
app.put("/admin/locations/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const id = Number(req.params.id);

  if (user.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });

  const before = await prisma.jobLocation.findFirst({
    where: { id },
    include: {
      customer: true,
    },
  });

  if (!before || before.customer.companyId !== user.companyId) {
    return res.status(404).json({ error: "Location not found" });
  }

  const location = await prisma.jobLocation.update({
    where: { id },
    data: req.body,
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "LOCATION_UPDATED",
    entityType: "LOCATION",
    entityId: id,
    metadata: { before, after: location },
  });

  res.json(location);
});

//
// Admin: archive (soft delete) job location
//
app.delete("/admin/locations/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const id = Number(req.params.id);

  if (user.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });

  const before = await prisma.jobLocation.findFirst({
    where: { id },
    include: { customer: true },
  });

  if (!before || before.customer.companyId !== user.companyId) {
    return res.status(404).json({ error: "Location not found" });
  }

  await prisma.jobLocation.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: user.id,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "LOCATION_DELETED",
    entityType: "LOCATION",
    entityId: id,
  });

  res.json({ success: true });
});

//
// Admin: restore soft-deleted job location
//
app.post("/admin/locations/:id/restore", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const id = Number(req.params.id);

  if (user.role !== "ADMIN") return res.status(403).json({ error: "Forbidden" });

  const before = await prisma.jobLocation.findFirst({
    where: { id },
    include: { customer: true },
  });

  if (!before || before.customer.companyId !== user.companyId) {
    return res.status(404).json({ error: "Location not found" });
  }

  await prisma.jobLocation.update({
    where: { id },
    data: {
      deletedAt: null,
      deletedBy: null,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "LOCATION_RESTORED",
    entityType: "LOCATION",
    entityId: id,
  });

  res.json({ success: true });
});


// --- Jobs ---

//
// Employee: list all active jobs for the company
//
app.get("/jobs", requireAuth, async (req: AuthenticatedRequest, res) => {
  const jobs = await prisma.job.findMany({
    where: {
      companyId: req.user!.companyId,
      deletedAt: null,
    },
    orderBy: { name: "asc" },
    include: {
      customer: { select: { id: true, name: true } },
      location: {
        select: {
          id: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
        },
      },
    },
  });

  res.json(jobs);
});

//
// Admin: list all jobs INCLUDING archived
//
app.get("/admin/jobs", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const jobs = await prisma.job.findMany({
    where: { companyId: user.companyId },
    orderBy: { name: "asc" },
    include: {
      customer: true,
      location: true,
    },
  });

  res.json(jobs);
});

//
// Admin: create job
//
app.post("/admin/jobs", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { name, customerId, locationId, jobNote } = req.body;

  if (!name || !customerId || !locationId) {
    return res.status(400).json({ error: "Missing required fields: name, customerId, locationId" });
  }

  // Verify customer belongs to the company
  const customer = await prisma.customer.findFirst({
    where: { id: Number(customerId), companyId: user.companyId },
  });

  if (!customer) {
    return res.status(400).json({ error: "Customer not found in this company." });
  }

  // Verify location belongs to the customer
  const location = await prisma.jobLocation.findFirst({
    where: {
      id: Number(locationId),
      customerId: Number(customerId),
    },
  });

  if (!location) {
    return res.status(400).json({ error: "Location does not belong to this customer." });
  }

  const job = await prisma.job.create({
    data: {
      companyId: user.companyId,
      customerId: Number(customerId),
      locationId: Number(locationId),
      name,
      jobNote,
    },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "JOB_CREATED",
    entityType: "JOB",
    entityId: job.id,
    metadata: { name, customerId, locationId, jobNote },
  });

  res.status(201).json(job);
});

//
// Admin: update job
//
app.put("/admin/jobs/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const id = Number(req.params.id);

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { name, customerId, locationId, jobNote } = req.body;

  const before = await prisma.job.findUnique({
    where: { id },
    include: { customer: true, location: true },
  });

  if (!before || before.companyId !== user.companyId) {
    return res.status(404).json({ error: "Job not found." });
  }

  // Customer check (only if updating)
  if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: Number(customerId), companyId: user.companyId },
    });

    if (!customer) {
      return res.status(400).json({ error: "Customer not found in this company." });
    }
  }

  // Location check (only if updating)
  if (locationId) {
    const location = await prisma.jobLocation.findFirst({
      where: {
        id: Number(locationId),
        customerId: Number(customerId ?? before.customerId),
      },
    });

    if (!location) {
      return res.status(400).json({ error: "Location does not belong to this customer." });
    }
  }

  const job = await prisma.job.update({
    where: { id },
    data: {
      name,
      customerId: customerId ? Number(customerId) : before.customerId,
      locationId: locationId ? Number(locationId) : before.locationId,
      jobNote,
    },
    include: { customer: true, location: true },
  });

  await logAudit({
    companyId: user.companyId,
    employeeId: user.id,
    action: "JOB_UPDATED",
    entityType: "JOB",
    entityId: job.id,
    metadata: { before, after: job },
  });

  res.json(job);
});

//
// Admin: archive (soft delete)
//
app.delete("/admin/jobs/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const id = Number(req.params.id);

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const before = await prisma.job.findUnique({
    where: { id },
  });

  if (!before || before.companyId !== user.companyId) {
    return res.status(404).json({ error: "Job not found" });
  }

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

//
// Admin: restore job
//
app.post("/admin/jobs/:id/restore", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const id = Number(req.params.id);

  if (user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const before = await prisma.job.findUnique({
    where: { id },
  });

  if (!before || before.companyId !== user.companyId) {
    return res.status(404).json({ error: "Job not found" });
  }

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
app.post(
  "/time-entries",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
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
      include: {
        location: {
          include: {
            customer: true,
          },
        },
      },
    });

    if (!job || job.location.customer.companyId !== user.companyId) {
      return res
        .status(400)
        .json({ error: "Job not found or not in your company" });
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
      include: {
        job: {
          include: {
            customer: { select: { id: true, name: true } },
            location: true,
          },
        },
        employee: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(entry);
  }
);

// Get time entries (employee: their own; admin: any employee within the company)
app.get("/time-entries", requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
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

  // date filters
  if (from || to) {
    where.start = {};
    if (from) where.start.gte = new Date(from);
    if (to) where.start.lte = new Date(to);
  }

  const entries = await prisma.timeEntry.findMany({
    where,
    orderBy: { start: "desc" },
    include: {
      job: {
        include: {
          customer: { select: { id: true, name: true } },
          location: {
            select: {
              id: true,
              name: true,
              addressLine1: true,
              addressLine2: true,
              city: true,
              state: true,
              postalCode: true,
              country: true,
            },
          },
        },
      },
      employee: { select: { id: true, name: true } },
    },
  });

  res.json(entries);
});


// --- Audit Logs ---

// Admin: view audit log for the company
app.get(
  "/admin/audit-log",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const user = req.user!;

    if (user.role !== "ADMIN") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const logs = await prisma.auditLog.findMany({
      where: { companyId: user.companyId },
      orderBy: { timestamp: "desc" },
      include: {
        employee: { select: { id: true, name: true } },
      },
    });

    res.json(logs);
  }
);

// --- Start server ---
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`TimeScrub API listening on http://localhost:${port}`);
});
