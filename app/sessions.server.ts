import { createCookieSessionStorage } from "react-router";

type SessionData = {
  userId: number;
  userEmail: string;
  userRole: 'coach' | 'admin' | 'assistant-coach';
};

type SessionFlashData = {
  error: string;
  success: string;
};

const sessionSecret = process.env.SESSION_SECRET || "dev-secret-change-in-production";

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}

const { getSession, commitSession, destroySession } =
  createCookieSessionStorage<SessionData, SessionFlashData>({
    cookie: {
      name: "ayso_session",
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: "/",
      sameSite: "lax",
      secrets: [sessionSecret],
      secure: process.env.NODE_ENV === "production",
    },
  });

export { getSession, commitSession, destroySession };