import { formatRelativeTime } from "@/components/format";
import { useNow } from "@/components/useNow";

interface RelativeTimeProps {
  readonly value: string | null;
}

export function RelativeTime({ value }: RelativeTimeProps) {
  const now = useNow();

  if (value === null) {
    return <span className="text-muted-foreground">never</span>;
  }

  return (
    <time dateTime={value} title={new Date(value).toLocaleString()}>
      {formatRelativeTime(value, now)}
    </time>
  );
}
