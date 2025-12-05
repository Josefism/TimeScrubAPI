import { PrismaClient } from "@prisma/client"
import bcrypt from "bcrypt"

const prisma = new PrismaClient()

async function run() {
  console.log("🌱 Seeding dev database...")

  // ------------------------------------------------------------
  // 1. Create a Company
  // ------------------------------------------------------------
  const company = await prisma.company.create({
    data: {
      name: "TS Cleaning Services",
      addressLine1: "123 Corporate Blvd",
      city: "Baton Rouge",
      state: "LA",
      postalCode: "70801",
      country: "US",
      phone: "(555) 555-5555",
    },
  })

  // ------------------------------------------------------------
  // 2. Create Admin + Employee
  // ------------------------------------------------------------
  const adminPassword = await bcrypt.hash("TESTpass321", 10)
  const employeePassword = await bcrypt.hash("TESTpass321", 10)

  const admin = await prisma.employee.create({
    data: {
      companyId: company.id,
      email: "webmaster@assemblystudio.com",
      name: "Josef Admin",
      role: "ADMIN",
      passwordHash: adminPassword,
    },
  })

  const employee = await prisma.employee.create({
    data: {
      companyId: company.id,
      email: "employee@timescrub.com",
      name: "Joe User",
      role: "EMPLOYEE",
      passwordHash: employeePassword,
    },
  })

  // ------------------------------------------------------------
  // 3. Create Customers
  // ------------------------------------------------------------
  const customerA = await prisma.customer.create({
    data: {
      companyId: company.id,
      name: "Acme Construction",
      contactName: "John Contractor",
      contactEmail: "john@acme.com",
      contactPhone: "555-123-4567",
      businessAddressLine1: "500 Main St",
      businessCity: "New Orleans",
      businessState: "LA",
      businessPostalCode: "70112",
      businessCountry: "US",
      mailingAddressLine1: "PO Box 100",
      mailingCity: "New Orleans",
      mailingState: "LA",
      mailingPostalCode: "70113",
      mailingCountry: "US",
    },
  })

  const customerB = await prisma.customer.create({
    data: {
      companyId: company.id,
      name: "River Tech LLC",
      contactName: "Sarah Rivers",
      contactEmail: "sarah@rivertech.com",
      contactPhone: "555-987-6543",
      businessAddressLine1: "900 River Rd",
      businessCity: "Baton Rouge",
      businessState: "LA",
      businessPostalCode: "70802",
      businessCountry: "US",
    },
  })

  const customerC = await prisma.customer.create({
    data: {
      companyId: company.id,
      name: "Bayou Services",
      contactName: "Mark Dupree",
      contactEmail: "mark@bayou.com",
      businessAddressLine1: "44 Bayou Dr",
      businessCity: "Lafayette",
      businessState: "LA",
      businessPostalCode: "70501",
      businessCountry: "US",
    },
  })

  // ------------------------------------------------------------
  // 4. Create Job Locations
  // ------------------------------------------------------------
  const acmeWarehouse = await prisma.jobLocation.create({
    data: {
      customerId: customerA.id,
      name: "Warehouse #1",
      addressLine1: "123 Warehouse Rd",
      city: "New Orleans",
      state: "LA",
      postalCode: "70115",
      country: "US",
    },
  })

  const acmeSiteB = await prisma.jobLocation.create({
    data: {
      customerId: customerA.id,
      name: "Construction Site B",
      addressLine1: "800 Worksite Ave",
      city: "Kenner",
      state: "LA",
      postalCode: "70062",
      country: "US",
    },
  })

  const riverTechHQ = await prisma.jobLocation.create({
    data: {
      customerId: customerB.id,
      name: "Corporate HQ",
      addressLine1: "900 River Rd",
      city: "Baton Rouge",
      state: "LA",
      postalCode: "70802",
      country: "US",
    },
  })

  // ------------------------------------------------------------
  // 5. Create Jobs
  // ------------------------------------------------------------
  const job1 = await prisma.job.create({
    data: {
      companyId: company.id,
      customerId: customerA.id,
      locationId: acmeWarehouse.id,
      name: "Inventory Cleanup",
      jobNote: "Sort and label incoming materials.",
    },
  })

  const job2 = await prisma.job.create({
    data: {
      companyId: company.id,
      customerId: customerA.id,
      locationId: acmeSiteB.id,
      name: "Concrete Pouring",
      jobNote: "Assist with rebar layout and prep.",
    },
  })

  const job3 = await prisma.job.create({
    data: {
      companyId: company.id,
      customerId: customerB.id,
      locationId: riverTechHQ.id,
      name: "Server Rack Wiring",
      jobNote: "Pull and label CAT6 runs.",
    },
  })

  // ------------------------------------------------------------
  // 6. Time Entries
  // ------------------------------------------------------------
  await prisma.timeEntry.create({
    data: {
      companyId: company.id,
      employeeId: employee.id,
      jobId: job1.id,
      start: new Date("2025-02-01T08:00:00Z"),
      end: new Date("2025-02-01T12:00:00Z"),
      durationMs: 4 * 60 * 60 * 1000,
      timeNote: "Cleared shelves and sorted inventory.",
    },
  })

  await prisma.timeEntry.create({
    data: {
      companyId: company.id,
      employeeId: employee.id,
      jobId: job2.id,
      start: new Date("2025-02-02T09:00:00Z"),
      end: new Date("2025-02-02T11:30:00Z"),
      durationMs: 2.5 * 60 * 60 * 1000,
      timeNote: "Helped pour concrete foundation.",
    },
  })

  await prisma.timeEntry.create({
    data: {
      companyId: company.id,
      employeeId: employee.id,
      jobId: job3.id,
      start: new Date("2025-02-03T13:00:00Z"),
      end: new Date("2025-02-03T16:00:00Z"),
      durationMs: 3 * 60 * 60 * 1000,
      timeNote: "Ran cable and mounted patch panel.",
    },
  })

  console.log("🌱 Seed complete.")
}

run()
  .catch((err) => {
    console.error("❌ Seed failed")
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
