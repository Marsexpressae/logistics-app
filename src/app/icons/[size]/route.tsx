import { ImageResponse } from "next/og";

// App icons: /icons/192, /icons/512, /icons/180 (iPhone). "?maskable=1" gives the full-bleed Android version.
// Design: an envelope whose flap forms the letter M (white on Mars red). Keep in sync with
// src/components/brand/BrandMark.tsx and src/app/icon.svg.
const SIZES = new Set([180, 192, 512]);
const RED = "#d9442a";

export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const size = Number(raw);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });

  const maskable = new URL(req.url).searchParams.has("maskable");
  // Android masks maskable icons (circle, squircle...), and iOS rounds its own corners, so both
  // get a square, full-bleed background. Only the plain "any" icons carry their own rounded corners.
  const roundedCorners = !maskable && size !== 180;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: RED,
          borderRadius: roundedCorners ? Math.round(size * 0.22) : 0,
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 136 136">
          <polyline
            points="30,98 30,38 68,76 106,38 106,98 30,98"
            fill="none"
            stroke="#ffffff"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
