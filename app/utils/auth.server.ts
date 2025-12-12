import bcrypt from "bcryptjs";
import { db, users, teams } from "~/db";
import { eq } from "drizzle-orm";
import { getSession } from "~/sessions.server";
import { redirect } from "react-router";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hashedPassword: string) {
  return bcrypt.compare(password, hashedPassword);
}

export async function createUser(
  email: string,
  password: string,
  role: 'coach' | 'admin' | 'assistant-coach' = 'coach',
  teamName?: string,
  gameFormat?: '7v7' | '9v9' | '11v11',
  region?: string
) {
  const hashedPassword = await hashPassword(password);
  
  const [user] = await db.insert(users).values({
    email,
    password: hashedPassword,
    role,
    teamName,
    gameFormat,
    region,
  }).returning();
  
  // If team info provided, create the team
  if (teamName && gameFormat && user) {
    await db.insert(teams).values({
      name: teamName,
      coachId: user.id,
      format: gameFormat,
      region,
      season: `${new Date().getFullYear()} Season`,
    });
  }
  
  return user;
}

export async function authenticateUser(email: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  
  if (!user) {
    return null;
  }
  
  const isValid = await verifyPassword(password, user.password);
  
  if (!isValid) {
    return null;
  }
  
  return user;
}

export async function requireUserId(request: Request) {
  const session = await getSession(request.headers.get("Cookie"));
  const userId = session.get("userId");
  
  if (!userId) {
    throw redirect("/user/login");
  }
  
  return userId;
}

type User = typeof users.$inferSelect;

// Overload: when shouldRedirect is true (default), always returns User (throws on null)
export async function getUser(request: Request, shouldRedirect?: true): Promise<User>;
// Overload: when shouldRedirect is false, may return null
export async function getUser(request: Request, shouldRedirect: false): Promise<User | null>;
// Implementation
export async function getUser(request: Request, shouldRedirect = true): Promise<User | null> {
  const session = await getSession(request.headers.get("Cookie"));
  const userId = session.get("userId");

  if (!userId) {
    if (shouldRedirect) {
      throw redirect("/user/login");
    }
    return null;
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user) {
    if (shouldRedirect) {
      throw redirect("/user/login");
    }
    return null;
  }

  return user;
}