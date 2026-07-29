/**
 * The offline queue, made visible.
 *
 * A scorer who taps a ball in a dead spot deserves to see exactly what is waiting
 * and what the server refused. Nothing here is hidden or silently discarded.
 */

import { Button } from "@/components/ui/Button";
import { Badge, Panel, SectionTitle, Seam } from "@/components/ui/Surface";
import { dropQueued, type QueuedDelivery } from "@/lib/offline/db";
import { relativeTime } from "@/lib/utils";

export function PendingQueue({
  pending,
  rejected,
  online,
  onSync,
}: {
  pending: QueuedDelivery[];
  rejected: QueuedDelivery[];
  online: boolean;
  onSync: () => void;
}) {
  if (pending.length === 0 && rejected.length === 0) return null;

  return (
    <Panel className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <SectionTitle>Waiting to sync</SectionTitle>
          <Badge tone={online ? "live" : "quiet"}>
            {pending.length} {pending.length === 1 ? "ball" : "balls"}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onSync}
          disabled={!online || pending.length === 0}
        >
          {online ? "Send now" : "Offline — saved on this device"}
        </Button>
      </div>

      {pending.length > 0 && (
        <>
          <Seam />
          <ol className="flex flex-col">
            {pending.map((row) => (
              <li
                key={row.id}
                className="flex items-baseline justify-between gap-3 px-4 py-2 font-sans text-sm text-chalk"
              >
                <span>{row.label}</span>
                <span className="shrink-0 text-xs text-willow">
                  {relativeTime(row.createdAt)}
                  {row.attempts > 1 && ` · ${row.attempts} attempts`}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      {rejected.length > 0 && (
        <>
          <Seam />
          <div className="px-4 py-3">
            <SectionTitle className="text-boundary-soft">Refused by the server</SectionTitle>
            <ul className="mt-2 flex flex-col gap-2">
              {rejected.map((row) => (
                <li key={row.id} className="font-sans text-sm text-chalk">
                  <span>{row.label}</span>
                  <span className="block text-xs text-boundary-soft">
                    {row.lastError}
                    {row.lastErrorCode && ` (${row.lastErrorCode})`}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1"
                    onClick={() => void dropQueued(row.id !== undefined ? [row.id] : [])}
                  >
                    Discard this ball
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-2 font-sans text-xs text-willow">
              These balls were not scored. Discard each one and record what actually happened.
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}
