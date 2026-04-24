import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

// Prisma v7 reads DATABASE_URL from environment automatically
export const prisma = new PrismaClient();

