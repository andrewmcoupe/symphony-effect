import { formatDuration } from "@/components/format";
import { useNow } from "@/components/useNow";

interface CountdownProps {
  readonly dueAt: string;
}

export function Countdown({ dueAt }: CountdownProps) {
  const now = useNow();
  const dueAtMs = new Date(dueAt).getTime();

  if (Number.isNaN(dueAtMs)) {
    return <span className="text-muted-foreground">unknown</span>;
  }

  const remainingMs = dueAtMs - now;

  return (
    <time dateTime={dueAt} title={new Date(dueAtMs).toLocaleString()}>
      {remainingMs <= 0 ? "due now" : formatDuration(remainingMs)}
    </time>
  );
}
