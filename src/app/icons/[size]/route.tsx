import { ImageResponse } from "next/og";

// Generates the app icon at /icons/192, /icons/512, /icons/180 (iOS), optionally ?maskable=1.
// Placeholder artwork (white "M" on blue). To use a real logo, replace this with static PNGs in /public.
const SIZES = new Set([180, 192, 512]);

export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const size = Number(raw);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });

  const maskable = new URL(req.url).searchParams.has("maskable");
  // Maskable icons keep important artwork inside the central 80% "safe zone".
  const fontSize = Math.round(size * (maskable ? 0.5 : 0.62));
  const radius = maskable ? 0 : Math.round(size * 0.22);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2563eb",
          borderRadius: radius,
          color: "white",
          fontSize,
          fontWeight: 800,
          letterSpacing: -2,
        }}
      >
        M
      </div>
    ),
    { width: size, height: size }
  );
}
