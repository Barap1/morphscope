import { Skeleton } from "@morphscope/ui";

export default function Loading() {
  return (
    <div className="loading-page" role="status" aria-label="Loading workspace…">
      <Skeleton width="112px" height="10px" />
      <Skeleton className="loading-title" width="min(520px, 70vw)" height="54px" />
      <Skeleton width="min(610px, 85vw)" height="16px" />
      <Skeleton className="loading-panel" width="100%" height="280px" />
    </div>
  );
}
