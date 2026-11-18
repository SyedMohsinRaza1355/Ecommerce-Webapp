import { platformDb } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";

export type PlatformUser = {
  _id: string;
  email: string;
  passwordHash: string;
  role: "super_admin";
  createdAt: Date;
};

const col = async () => (await platformDb()).collection<PlatformUser>("platform_users");

export async function countSuperAdmins(): Promise<number> {
  return (await col()).countDocuments({ role: "super_admin" });
}

export async function findPlatformUserByEmail(email: string): Promise<PlatformUser | null> {
  return (await col()).findOne({ email: email.trim().toLowerCase() });
}

export async function createSuperAdmin(email: string, password: string): Promise<PlatformUser> {
  const c = await col();
  await c.createIndex({ email: 1 }, { unique: true });
  const user: PlatformUser = {
    _id: crypto.randomUUID(),
    email: email.trim().toLowerCase(),
    passwordHash: await hashPassword(password),
    role: "super_admin",
    createdAt: new Date(),
  };
  await c.insertOne(user);
  return user;
}
