import {useEffect, useLayoutEffect, useRef, type KeyboardEvent} from "react";

export type LedgerPaginationItem = number | "ellipsis";

export function getLedgerPaginationItems(numPages: number, page: number): LedgerPaginationItem[] {
  const lastPage = Math.max(1, Math.floor(numPages));
  const currentPage = Math.min(lastPage, Math.max(1, Math.floor(page)));
  const boundaryPages = currentPage <= 3
    ? [1, 2, 3]
    : currentPage >= lastPage - 2
      ? [lastPage - 2, lastPage - 1, lastPage]
      : [currentPage - 1, currentPage, currentPage + 1];
  const pages = lastPage <= 7
    ? Array.from({length: lastPage}, (_, index) => index + 1)
    : [...new Set([1, ...boundaryPages, lastPage]
      .filter((pageNumber) => pageNumber >= 1 && pageNumber <= lastPage))].sort((left, right) => left - right);

  return pages.flatMap((pageNumber, index) => {
    if (index === 0) return [pageNumber];
    const previousPage = pages[index - 1];
    return [previousPage + 1 === pageNumber ? null : previousPage + 2 === pageNumber ? previousPage + 1 : "ellipsis", pageNumber]
      .filter((item): item is LedgerPaginationItem => item !== null);
  });
}

type LedgerPaginationProps = {
  page: number;
  numPages: number;
  itemFrom: number;
  itemTo: number;
  totalItems: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageChange: (page: number) => void;
};

export function LedgerPagination({page, numPages, itemFrom, itemTo, totalItems, hasPrevious, hasNext, onPrevious, onNext, onPageChange}: LedgerPaginationProps) {
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const pageRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingFocusPage = useRef<number | null>(null);
  const items = getLedgerPaginationItems(numPages, page);
  const hasEllipsis = items.includes("ellipsis");

  useEffect(() => {
    const activeElement = document.activeElement;
    if ((!hasPrevious && activeElement === previousRef.current) || (!hasNext && activeElement === nextRef.current)) pageRefs.current.get(page)?.focus({preventScroll: true});
  }, [hasNext, hasPrevious, page]);

  useLayoutEffect(() => {
    if (pendingFocusPage.current === null) return;
    const targetPage = pendingFocusPage.current;
    pendingFocusPage.current = null;
    pageRefs.current.get(targetPage)?.focus({preventScroll: true});
  }, [page, numPages]);

  const changePage = (targetPage: number, navigate: () => void) => {
    pendingFocusPage.current = targetPage;
    navigate();
  };

  const handlePageTab = (event: KeyboardEvent<HTMLButtonElement>, currentPage: number) => {
    if (event.key !== "Tab") return;
    const pages = items.filter((item): item is number => item !== "ellipsis");
    const currentIndex = pages.indexOf(currentPage);
    const targetPage = pages[currentIndex + (event.shiftKey ? -1 : 1)];
    if (targetPage === undefined) return;
    event.preventDefault();
    pageRefs.current.get(targetPage)?.focus({preventScroll: true});
  };

  const handleShortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "PageUp" && hasPrevious) changePage(page - 1, onPrevious);
    else if (event.key === "PageDown" && hasNext) changePage(page + 1, onNext);
    else if (event.key === "Home" && page > 1) changePage(1, () => onPageChange(1));
    else if (event.key === "End" && page < numPages) changePage(numPages, () => onPageChange(numPages));
    else return;
    event.preventDefault();
  };

  return (
    <nav className="ui-ledger-pagination" aria-label="Páginas de movimientos" onKeyDown={handleShortcut}>
      <span className="ui-ledger-pagination__status" role="status" aria-live="polite" aria-atomic="true">{itemFrom}–{itemTo} de {totalItems} {totalItems === 1 ? "movimiento" : "movimientos"}</span>
      <div className={`ui-ledger-pagination__controls${hasEllipsis ? " has-ellipsis" : ""}`}>
        <button ref={previousRef} className="ui-ledger-pagination__nav-button ui-ledger-pagination__nav-button--previous" type="button" aria-label="Página anterior" title="Re Pág: anterior · Inicio: primera" aria-keyshortcuts="PageUp Home" disabled={!hasPrevious} onClick={() => changePage(page - 1, onPrevious)}><span className="ui-ledger-pagination__nav-label">Anterior</span></button>
        <ol className="ui-ledger-pagination__pages" aria-label="Números de página">
          {items.map((item, index) => item === "ellipsis" ? <li key={`ellipsis-${index}`} className="ui-ledger-pagination__ellipsis" aria-hidden="true">…</li> : <li key={item}><button ref={(element) => { if (element) pageRefs.current.set(item, element); else pageRefs.current.delete(item); }} className="ui-ledger-pagination__page-button" data-neighbor={item !== 1 && item !== numPages && item !== page ? "true" : undefined} type="button" aria-label={`Ir a página ${item}`} aria-current={item === page ? "page" : undefined} onClick={() => changePage(item, () => onPageChange(item))} onKeyDown={(event) => handlePageTab(event, item)}>{item}</button></li>)}
        </ol>
        <button ref={nextRef} className="ui-ledger-pagination__nav-button ui-ledger-pagination__nav-button--next" type="button" aria-label="Página siguiente" title="Av Pág: siguiente · Fin: última" aria-keyshortcuts="PageDown End" disabled={!hasNext} onClick={() => changePage(page + 1, onNext)}><span className="ui-ledger-pagination__nav-label">Siguiente</span></button>
      </div>
    </nav>
  );
}
