import { z } from "zod";

const trim = (s) => (typeof s === "string" ? s.trim() : s);
export const str = (min = 1, max = 200, msg) => z.preprocess(trim, z.string({ required_error: msg || "Required" }).min(min, msg || "Required").max(max));
export const email = z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.string({ required_error: "Email is required" }).email("Enter a valid email address").max(200));
/** South African mobile: 0821234567, +27 82 123 4567, 27821234567 */
export const mobile = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/[\s()-]/g, "") : v),
  z.string({ required_error: "Mobile number is required" }).regex(/^(\+27|27|0)[1-9]\d{8}$/, "Enter a valid South African mobile number (e.g. +27 82 000 0000)")
    .transform((v) => v.replace(/^(\+27|27|0)/, "+27")),
);
export const password = z.string({ required_error: "Password is required" })
  .min(8, "Use at least 8 characters").max(100)
  .regex(/[A-Za-z]/, "Include at least one letter").regex(/\d/, "Include at least one number");
export const postalCode = z.preprocess(trim, z.string({ required_error: "Postal code is required" }).regex(/^\d{4}$/, "Enter a 4-digit postal code"));
export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const addressSchema = z.object({
  street: str(3, 120, "Street address is required"),
  suburb: str(2, 80, "Suburb is required"),
  city: str(2, 80, "City is required"),
  postalCode,
});
export const contactSchema = z.object({
  firstName: str(1, 60, "First name is required"),
  lastName: str(1, 60, "Last name is required"),
  email,
  mobile,
});
