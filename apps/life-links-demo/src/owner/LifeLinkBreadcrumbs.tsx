import { ChevronRight } from "lucide-react";
import type { BoundedLifeLinkItems, LifeLinkSummary } from "@life-links/core";

export function LifeLinkBreadcrumbs({
  ancestry,
  onSelect
}: {
  ancestry: BoundedLifeLinkItems<LifeLinkSummary>;
  onSelect(lifeLinkId: string): void;
}) {
  return (
    <nav className="life-link-breadcrumbs" aria-label="Life Link path">
      {ancestry.items.map((item, index) => (
        <span key={item.id} className="life-link-breadcrumb-item">
          {index > 0 ? <ChevronRight size={14} /> : null}
          {index === 1 && ancestry.truncated ? (
            <span className="life-link-breadcrumb-item">
              <span className="life-link-breadcrumb-ellipsis" title={`${ancestry.omittedCount} middle levels omitted`}>
                ...
              </span>
              <ChevronRight size={14} />
            </span>
          ) : null}
          <button onClick={() => onSelect(item.id)} aria-current={index === ancestry.items.length - 1 ? "page" : undefined}>
            {item.title || "Untitled Life Link"}
          </button>
        </span>
      ))}
    </nav>
  );
}
