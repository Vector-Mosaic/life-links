import { Fragment, useId, useLayoutEffect, useRef, useState } from "react";

type PathEntry = { id: string; title: string; onSelect(): void; current?: boolean };

/** Compact location context, with an in-flow disclosure of the complete known path. */
export function PathBreadcrumbs({ label, items, compactItems, truncated = false }: { label: string; items: PathEntry[]; compactItems?: PathEntry[]; truncated?: boolean }) {
  const probe = useRef<HTMLDivElement>(null);
  const pathId = useId();
  const [compact, setCompact] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pathKey = JSON.stringify(items.map(({ id, title }) => [id, title]));
  useLayoutEffect(() => { setExpanded(false); }, [pathKey, truncated]);
  useLayoutEffect(() => {
    const element = probe.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      setCompact(element.getBoundingClientRect().height > lineHeight * 2 + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pathKey, truncated]);

  const root = items[0];
  const tail = (compactItems ?? items.slice(1)).slice(-2);
  // Canonical bounded ancestry keeps its physical root plus the nearest suffix.
  // items[0] is our synthetic workspace root, not that physical root.
  const gapIndex = truncated ? (items.length === 2 ? 1 : 2) : -1;
  const tailStart = tail.length ? items.findIndex((item) => item.id === tail[0].id) : items.length;
  const gapBeforeTail = truncated && gapIndex <= tailStart;
  const separator = <span className="ll-breadcrumb-separator" aria-hidden="true"> › </span>;
  const entry = (item: PathEntry, measuring = false) => <button type="button" disabled={measuring} tabIndex={measuring ? -1 : undefined} title={item.title} aria-current={item.current ? "page" : undefined} onClick={measuring ? undefined : item.onSelect}>{item.title}</button>;
  const incomplete = <span title="The recorded path is incomplete" aria-label="Earlier folders unavailable">…</span>;
  const fullPath = (measuring = false, start = 0) => items.slice(start).map((item, offset) => {
    const index = start + offset;
    return <Fragment key={item.id}>{index > 0 && separator}{index === gapIndex && <>{incomplete}{separator}</>}{entry(item, measuring)}</Fragment>;
  });
  return <nav className={`ll-context-row ll-breadcrumbs${compact && expanded ? " ll-breadcrumbs-expanded" : ""}`} aria-label={label}>
    {/* Measure the full path independently so resizing can restore it after compaction. */}
    <div className="ll-breadcrumb-probe-clip" aria-hidden="true"><div ref={probe} className="ll-breadcrumbs-flow">
      {fullPath(true)}
    </div></div>
    <div className={`ll-breadcrumbs-display ${compact ? "ll-breadcrumbs-disclosure" : "ll-breadcrumbs-flow"}`}>
      {compact && root ? <>
        <div className="ll-breadcrumb-root">{entry(root)}{!expanded && (gapBeforeTail ? incomplete : <span aria-hidden="true">…</span>)}
          <button type="button" className="ll-breadcrumb-toggle" aria-label={expanded ? "Collapse full path" : "Expand full path"} aria-expanded={expanded} aria-controls={pathId} onClick={() => setExpanded(!expanded)}>{expanded ? "Collapse all" : "Expand all"}</button>
        </div>
        <div id={pathId} className={expanded ? "ll-breadcrumbs-flow" : "ll-breadcrumb-tail"}>
          {expanded ? fullPath(false, 1) : tail.map((item, index) => <span className="ll-breadcrumb-tail-entry" key={item.id}>{index > 0 && separator}{!gapBeforeTail && items.findIndex((node) => node.id === item.id) === gapIndex && <>{incomplete}{separator}</>}{entry(item)}</span>)}
        </div>
      </> : fullPath()}
    </div>
  </nav>;
}
