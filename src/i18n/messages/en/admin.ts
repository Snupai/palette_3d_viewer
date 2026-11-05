import type { adminDe } from "../de/admin";

export const adminEn = {
  "admin.title": "User management",
  "admin.backToPlanner": "To the pallet planner",
  "admin.loading": "Loading users …",
  "admin.state.unavailable":
    "This installation stores data locally in the browser and has no user accounts.",
  "admin.state.unauthenticated": "Please sign in as an admin to manage users.",
  "admin.state.forbidden":
    "Only admins can manage users. Signed in as {username}.",
  "admin.state.forbiddenAnonymous": "Only admins can manage users.",
  "admin.state.error": "The users could not be loaded.",
  "admin.retry": "Reload",
  "admin.users.heading": "Users",
  "admin.users.username": "Username",
  "admin.users.role": "Role",
  "admin.users.createdAt": "Created",
  "admin.users.actions": "Actions",
  "admin.users.you": "(you)",
  "admin.role.admin": "Admin",
  "admin.role.user": "User",
  "admin.create.heading": "Create user",
  "admin.create.submit": "Create user",
  "admin.create.success": "User {username} was created.",
  "admin.field.username": "Username",
  "admin.field.usernameHint": "3–64 characters: a–z, 0–9, dot, _ or -",
  "admin.field.password": "Password",
  "admin.field.passwordHint":
    "at least 12 characters, 5 different, without the username",
  "admin.field.confirmation": "Repeat password",
  "admin.field.role": "Role",
  "admin.reset.open": "Reset password",
  "admin.reset.heading": "New password for {username}",
  "admin.reset.submit": "Set password",
  "admin.reset.cancel": "Cancel",
  "admin.reset.success":
    "Password for {username} was set; existing sessions have ended.",
  "admin.reset.ownSessionEnded":
    "Your password was set and your session ended. Please sign in again.",
  "admin.error.usernameRequired": "Please enter a username.",
  "admin.error.passwordRequired": "Please enter a password.",
  "admin.error.passwordMismatch": "The passwords do not match.",
  "admin.error.usernameTaken": "This username is already taken.",
  "admin.error.invalidUsername":
    "Username: 3–64 characters of a–z, 0–9, dot, _ or -, starting and ending with a letter or digit.",
  "admin.error.userNotFound": "This user no longer exists.",
  "admin.error.weakPassword.tooShort":
    "The password must be at least 12 characters long.",
  "admin.error.weakPassword.tooLong":
    "The password must be at most 1024 characters long.",
  "admin.error.weakPassword.containsUsername":
    "The password must not contain the username.",
  "admin.error.weakPassword.tooFewDistinct":
    "The password must contain at least 5 different characters.",
  "admin.error.sessionLost":
    "Your sign-in has expired or no longer has admin rights.",
  "admin.error.generic": "That did not work. Please try again.",
} as const satisfies Record<keyof typeof adminDe, string>;
