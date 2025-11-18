import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

// --- TEMP auth middleware ---
// Later, replace this with real JWT decoding.
// For now, we hard-code:
//   user id 1, companyId 1, role ADMIN
app.use(async (req, _res, next) => {
  (req as any).user = {
    id: 1,
    role: "ADMIN" as Role,
    companyId: 1,
  };
  next();
});

// --- Routes ---

// Healthcheck
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Current user info
app.get("/me", async (req, res) => {
  const user = (req as any).user;
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
app.get("/companies/me", async (req, res) => {
  const user = (req as any).user;

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
  });

  res.json(company);
});

// (Optional) Admin create company endpoint could go here.
// For your SaaS, you might have a separate onboarding flow.

// --- Jobs ---

// List jobs for the current company
app.get("/jobs", async (req, res) => {
  const user = (req as any).user;

  const jobs = await prisma.job.findMany({
    where: {
      companyId: user.companyId,
      active: true,
    },
    orderBy: { name: "asc" },
  });

  res.json(jobs);
});

// Create a job (admin only) for the current company
app.post("/jobs", async (req, res) => {
  const user = (req as any).user;

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
app.post("/time-entries", async (req, res) => {
  const user = (req as any).user;

  const { jobId, start, end, durationMs, timeNote } = req.body;

  if (!jobId || !start || !end || !durationMs) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // Optional safety: ensure job belongs to same company
  const job = await prisma.job.findFirst({
    where: {
      id: Number(jobId),
      companyId: user.companyId,
    },
  });

  if (!job) {
    return res.status(400).json({ error: "Job not found in this company." });
  }

  const entry = await prisma.timeEntry.create({
    data: {
      companyId: user.companyId,
      employeeId: user.id,
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
app.get("/time-entries", async (req, res) => {
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
    where,
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