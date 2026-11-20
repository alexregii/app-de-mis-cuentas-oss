import {type ReactNode, useLayoutEffect, useRef, useState} from "react";
import {RefreshCw} from "lucide-react";

const refreshThreshold = 72;

export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{x: number; y: number} | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  onRefreshRef.current = onRefresh;

  const reset = () => {
    startRef.current = null;
    pullRef.current = 0;
    setPull(0);
  };
  const start = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || window.scrollY > 2) {
      reset();
      return;
    }
    if (refreshingRef.current) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, input, select, textarea, [role='button'], [contenteditable='true']")) {
      reset();
      return;
    }
    const touch = event.touches[0];
    startRef.current = {x: touch.clientX, y: touch.clientY};
  };
  const move = (event: TouchEvent) => {
    const startPoint = startRef.current;
    const touch = event.touches[0];
    if (!startPoint || refreshingRef.current) return;
    if (event.touches.length !== 1 || !touch || window.scrollY > 2) {
      reset();
      return;
    }
    const deltaX = touch.clientX - startPoint.x;
    const deltaY = touch.clientY - startPoint.y;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      reset();
      return;
    }
    if (deltaY <= 0) {
      pullRef.current = 0;
      setPull(0);
      return;
    }
    event.preventDefault();
    const nextPull = Math.min(96, deltaY * 0.55);
    pullRef.current = nextPull;
    setPull(nextPull);
  };
  const finish = async (event: React.TouchEvent<HTMLDivElement>) => {
    const shouldRefresh = event.touches.length === 0 && window.scrollY <= 2 && pullRef.current >= refreshThreshold && !refreshingRef.current;
    reset();
    if (!shouldRefresh) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await onRefreshRef.current();
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };
  useLayoutEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    zone.addEventListener("touchmove", move, {passive: false});
    return () => zone.removeEventListener("touchmove", move);
  }, []);

  const label = refreshing ? "Actualizando" : pull >= refreshThreshold ? "Suelta" : "Desliza";
  return (
    <div ref={zoneRef} className="pull-zone" onTouchStart={start} onTouchEnd={(event) => void finish(event)} onTouchCancel={reset}>
      <div
        className={`pull-indicator${pull || refreshing ? " active" : ""}${pull >= refreshThreshold ? " ready" : ""}${refreshing ? " refreshing" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-hidden={!pull && !refreshing}
      >
        <RefreshCw aria-hidden="true" className={`pull-indicator-icon${refreshing ? " spin" : ""}`} style={{transform: `rotate(${Math.min(pull / refreshThreshold, 1) * 180}deg)`}} />
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}
