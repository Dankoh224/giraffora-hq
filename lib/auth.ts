// Token de sesión = hash de la contraseña (funciona en Edge y Node).
export async function authToken(password: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`giraffora:${password}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
