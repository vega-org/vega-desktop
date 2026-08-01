import { Skeleton } from "../ui/skeleton";

export const ContentDetailSkeleton = () => (
  <main
    className="content-detail-page content-detail-loading"
    aria-label="Loading content details"
  >
    <section className="content-skeleton-header">
      <div className="content-skeleton-hero">
        <Skeleton className="h-full w-full rounded-none" />
        <Skeleton className="content-skeleton-back" />
      </div>
      <div className="content-skeleton-hero-copy">
        <div className="content-skeleton-title-row">
          <Skeleton className="content-skeleton-title" />
          <Skeleton className="content-skeleton-rating" />
        </div>
        <div className="content-skeleton-facts">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      </div>
    </section>

    <div className="content-detail-inner">
      <section className="content-skeleton-overview">
        <div className="content-skeleton-heading">
          <Skeleton />
          <Skeleton />
        </div>
        <div className="content-skeleton-synopsis">
          <Skeleton />
          <Skeleton />
        </div>
        <div className="content-skeleton-actions">
          {[0, 1, 2, 3].map((item) => (
            <div key={item}>
              <Skeleton className="content-skeleton-action-icon" />
              <Skeleton className="content-skeleton-action-label" />
            </div>
          ))}
        </div>
      </section>

      <section className="content-skeleton-episodes">
        <Skeleton className="content-skeleton-season" />
        <div className="content-skeleton-episode-grid">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div className="content-skeleton-episode-card" key={item}>
              <Skeleton className="content-skeleton-thumbnail" />
              <div className="content-skeleton-episode-copy">
                <Skeleton />
                <Skeleton />
              </div>
              <Skeleton className="content-skeleton-download" />
            </div>
          ))}
        </div>
      </section>
    </div>
  </main>
);
