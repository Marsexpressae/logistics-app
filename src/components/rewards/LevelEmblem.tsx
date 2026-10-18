import { levelBand } from "@/lib/rewards";

const BANDS = {
  1: { ring: "#1D9E75", fill: "#9FE1CB", ink: "#04342C" },
  2: { ring: "#378ADD", fill: "#B5D4F4", ink: "#042C53" },
  3: { ring: "#534AB7", fill: "#AFA9EC", ink: "#26215C" },
  4: { ring: "#EF9F27", fill: "#FAC775", ink: "#412402" },
};
const HEX = "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)";

/** The level as a hexagon with the level number. Its colour changes at levels 3, 5 and 7. */
export default function LevelEmblem({ level, name }: { level: number; name: string }) {
  const c = BANDS[levelBand(level)];
  return (
    <div role="img" aria-label={`Level ${level}, ${name}`} className="flex h-[84px] w-[76px] shrink-0 items-center justify-center" style={{ clipPath: HEX, background: c.ring }}>
      <div className="flex h-[74px] w-[66px] flex-col items-center justify-center" style={{ clipPath: HEX, background: c.fill, color: c.ink }}>
        <span className="text-[11px] font-medium">LEVEL</span>
        <span className="text-3xl font-semibold leading-none">{level}</span>
      </div>
    </div>
  );
}
