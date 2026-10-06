/** The rules for choosing a new password. Returns a plain-language message, or null when it is fine. */
export function checkNewPassword(current: string, next: string, confirm: string, email = ""): string | null {
  if (!current) return "Type your current password first.";
  if (next.length < 8) return "The new password needs at least 8 characters.";
  if (next === current) return "The new password must be different from the current one.";
  if (/^(.)\1+$/.test(next)) return "Please choose something less repetitive than the same character over and over.";
  const name = email.split("@")[0].toLowerCase();
  if (name.length >= 4 && next.toLowerCase().includes(name)) return "Please do not use your email name in the password.";
  if (next !== confirm) return "The two new passwords are not the same.";
  return null;
}
