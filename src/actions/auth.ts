"use server";

import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { errors } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import {
  createSession,
  destroySession,
  getClientIp,
  getUserAgent,
  hashPassword,
  homeFor,
  requireUser,
  verifyPassword,
} from "@/lib/auth";
import { changePasswordSchema, loginSchema } from "@/lib/validation";
import { actionFailure, actionOk, str, type ActionState } from "@/actions/helpers";

const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 10;
const LOGIN_MAX_ATTEMPTS_PER_IP = 40;

export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ip = (await getClientIp()) ?? "unknown";
  const email = str(formData, "email").toLowerCase();

  let role: string;
  try {
    const input = loginSchema.parse({ email, password: str(formData, "password") });

    const ipLimit = rateLimit(`login:ip:${ip}`, LOGIN_MAX_ATTEMPTS_PER_IP, LOGIN_WINDOW_SECONDS);
    if (!ipLimit.ok) {
      throw errors.validation(
        `Too many sign-in attempts. Try again in ${ipLimit.retryAfterSeconds} seconds.`,
      );
    }
    const accountLimit = rateLimit(
      `login:acct:${input.email}`,
      LOGIN_MAX_ATTEMPTS_PER_ACCOUNT,
      LOGIN_WINDOW_SECONDS,
    );
    if (!accountLimit.ok) {
      throw errors.validation(
        `Too many sign-in attempts for this account. Try again in ${accountLimit.retryAfterSeconds} seconds.`,
      );
    }

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const passwordOk = user ? await verifyPassword(input.password, user.passwordHash) : false;

    if (!user || !passwordOk) {
      await writeAudit({
        action: "LOGIN_FAILED",
        entity: "auth",
        entityId: input.email,
        newValue: { email: input.email, userAgent: await getUserAgent() },
        ip,
      });
      throw errors.unauthenticated();
    }

    if (!user.isActive) throw errors.forbidden("signing in with a deactivated account");

    await createSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAudit({
      userId: user.id,
      userName: user.name,
      action: "LOGIN",
      entity: "auth",
      entityId: user.id,
      newValue: { email: user.email, role: user.role },
      ip,
    });

    role = user.role;
  } catch (error) {
    return actionFailure(error);
  }

  // redirect() throws a control-flow exception, so it must stay outside try/catch.
  redirect(homeFor(role as never));
}

export async function signOutAction(): Promise<void> {
  let name: string | undefined;
  let userId: string | undefined;
  try {
    const user = await requireUser();
    userId = user.id;
    name = user.name;
  } catch {
    // Already signed out.
  }
  await destroySession();
  if (userId) {
    await writeAudit({
      userId,
      userName: name,
      action: "LOGOUT",
      entity: "auth",
      entityId: userId,
      ip: await getClientIp(),
    });
  }
  redirect("/login");
}

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const input = changePasswordSchema.parse({
      currentPassword: str(formData, "currentPassword"),
      newPassword: str(formData, "newPassword"),
      confirmPassword: str(formData, "confirmPassword"),
    });

    const record = await prisma.user.findUnique({ where: { id: user.id } });
    if (!record) throw errors.notFound("User");

    const currentOk = await verifyPassword(input.currentPassword, record.passwordHash);
    if (!currentOk) throw errors.validation("Your current password is incorrect.");

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
    });

    await writeAudit({
      userId: user.id,
      userName: user.name,
      action: "PASSWORD_CHANGE",
      entity: "user",
      entityId: user.id,
      ip: await getClientIp(),
    });

    return actionOk("Your password has been changed.");
  } catch (error) {
    return actionFailure(error);
  }
}
