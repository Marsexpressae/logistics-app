import { ImageResponse } from "next/og";

// App icons: /icons/192, /icons/512, /icons/180 (iPhone). "?maskable=1" gives the full-bleed Android version.
// Design: an orange cargo box whose top edges and sides form a white letter M (brown outline), on white.
// Keep in sync with src/components/brand/BrandMark.tsx and src/app/icon.svg.
const SIZES = new Set([180, 192, 512]);
const WHITE = "#ffffff";

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
          background: WHITE,
          borderRadius: roundedCorners ? Math.round(size * 0.22) : 0,
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 136 136">
          <polygon points="68,24 106,45 68,66 30,45" fill="#fdba74" />
          <polygon points="30,45 68,66 68,112 30,91" fill="#f97316" />
          <polygon points="106,45 68,66 68,112 106,91" fill="#c2410c" />
          <polyline
            points="30,91 30,45 68,66 106,45 106,91"
            fill="none"
            stroke="#7c2d12"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="30,91 30,45 68,66 106,45 106,91"
            fill="none"
            stroke="#ffffff"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
