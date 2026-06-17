import { cn } from "@/lib/utils";

type ToggleChipProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

export default function ToggleChip({ label, active, onClick }: ToggleChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition",
        active
          ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
          : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10",
      )}
    >
      {label}
    </button>
  );
}
