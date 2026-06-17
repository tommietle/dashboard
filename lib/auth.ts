import { createHmac, timingSafeEqual } from 'node:crypto';

// Naam van het sessie-cookie en hoe lang een sessie geldig blijft.
export const SESSION_COOKIE = 'dashboard_session';
const SESSION_DAYS = 30;
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

function secret(): string {
  return process.env.DASHBOARD_SESSION_SECRET || 'dev-onveilig-geheim-vervang-mij';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface Session {
  email: string;
  exp: number;
}

// Maakt een ondertekend sessietoken in de vorm <payload>.<handtekening>.
export function createSessionToken(email: string): string {
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

// Controleert het token en geeft de sessie terug, of null als ongeldig/verlopen.
export function verifySessionToken(token: string | undefined): Session | null {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.email !== 'string' || typeof data.exp !== 'number') return null;
    if (data.exp < Date.now()) return null;
    return data as Session;
  } catch {
    return null;
  }
}

// Controleert ingevoerde inloggegevens tegen de waarden in .env.local.
export function verifyCredentials(email: string, password: string): boolean {
  const expectedEmail = (process.env.DASHBOARD_EMAIL || '').trim().toLowerCase();
  const expectedPassword = process.env.DASHBOARD_PASSWORD || '';
  if (!expectedEmail || !expectedPassword) return false;
  const emailOk = safeEqual(email.trim().toLowerCase(), expectedEmail);
  const passOk = safeEqual(password, expectedPassword);
  return emailOk && passOk;
}
