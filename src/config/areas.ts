// Pickup areas. Keep in sync with the check constraint in supabase/migrations/0004_pickup_area.sql.
export const AREAS = ["Dubai", "Abu Dhabi", "Sharjah", "Ajman"] as const;
export type Area = (typeof AREAS)[number];
