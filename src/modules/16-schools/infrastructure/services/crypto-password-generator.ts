import { randomInt } from 'node:crypto';

/** Unambiguous letters and digits only (no 0/O, 1/l/I): a 12-character password satisfies the §23 policy (4-12). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const LENGTH = 12;

/**
 * The password of a NEW applicant account created by a public submission. It comes from the operating system's CSPRNG
 * (about 70 bits), is hashed by IAM and is never returned, logged or stored in clear: nobody knows it. The phone's
 * owner sets a real password through the existing OTP password-recovery flow, which proves ownership of the phone.
 */
export function generateApplicantPassword(): string {
  let password = '';
  for (let i = 0; i < LENGTH; i += 1) password += ALPHABET[randomInt(ALPHABET.length)];
  return password;
}
