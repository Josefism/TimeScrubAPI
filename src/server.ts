import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import { PrismaClient, Role } from "@prisma/client";
import authRoutes from "./routes/auth";
import { requireAuth, AuthenticatedRequest } from "./middleware/auth";


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

  res.status(201).json(employee)
})

// --- Jobs ---

// List jobs for the current company
app.get("/jobs", requireAuth, async (req: AuthenticatedRequest, res) => {
  const jobs = await prisma.job.findMany({
    where: {
      companyId: req.user!.companyId
    },
    orderBy: { name: "asc" }
  });

  res.json(jobs);
});

// Create a job (admin only) for the current company
app.post("/jobs", requireAuth, async (req: AuthenticatedRequest, res) => {
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

  res.status(201).json(job);
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

// --- Start server ---
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`TimeScrub API listening on http://localhost:${port}`);
});