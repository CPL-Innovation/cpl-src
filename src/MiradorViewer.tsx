import { useEffect, useMemo, useRef } from 'react';
import { viewer as createMiradorViewer } from 'mirador';

type MiradorViewerProps = {
  manifestId: string;
  title: string;
};

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function proxiedManifestUrl(manifestId: string) {
  return `/api/proxy?url=${encodeURIComponent(manifestId)}`;
}

export function MiradorViewer({ manifestId, title }: MiradorViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const containerId = useMemo(() => `mirador-viewer-${slugify(`${manifestId}-${title}`)}`, [manifestId, title]);
  const proxiedUrl = useMemo(() => proxiedManifestUrl(manifestId), [manifestId]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    createMiradorViewer({
      id: containerId,
      windows: [{ manifestId: proxiedUrl }],
    });

    return () => {
      container.replaceChildren();
    };
  }, [containerId, proxiedUrl]);

  return (
    <div className="viewer-frame mirador-shell">
      <div ref={containerRef} aria-label={title} className="mirador-mount" id={containerId} />
    </div>
  );
}