import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const employee = await prisma.employee.findUnique({
    where: { email },
  });

  if (!employee) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const match = await bcrypt.compare(password, employee.passwordHash);
  if (!match) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    {
      id: employee.id,
      companyId: employee.companyId,
      role: employee.role,
    },
    process.env.JWT_SECRET!,
    { expiresIn: "24h" }
  );

  res.json({
    token,
    user: {
      id: employee.id,
      name: employee.name,
      role: employee.role,
      companyId: employee.companyId,
    }
  });
});

export default router;
