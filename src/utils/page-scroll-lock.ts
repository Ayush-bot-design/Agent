interface ScrollLockState {
  owners: Set<symbol>;
  restore: () => void;
}

const pageLocks = new WeakMap<Document, ScrollLockState>();

/** Modal-only, shared lock. Restore the original page styles only after the last
 * owner leaves, even when React unmounts overlapping dialogs out of order. */
export function acquirePageScrollLock(doc: Document = document): () => void {
  let state = pageLocks.get(doc);
  if (!state) {
    const view = doc.defaultView;
    if (!view) return () => {};
    const body = doc.body;
    const root = doc.documentElement;
    const x = view.scrollX;
    const y = view.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      width: body.style.width,
      overflow: body.style.overflow,
      rootOverflow: root.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.left = `-${x}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    state = {
      owners: new Set(),
      restore: () => {
        body.style.position = previous.position;
        body.style.top = previous.top;
        body.style.left = previous.left;
        body.style.width = previous.width;
        body.style.overflow = previous.overflow;
        root.style.overflow = previous.rootOverflow;
        view.scrollTo(x, y);
      },
    };
    pageLocks.set(doc, state);
  }
  const owner = Symbol('modal-scroll-lock');
  const acquired = state;
  acquired.owners.add(owner);
  return () => {
    if (!acquired.owners.delete(owner)) return;
    if (acquired.owners.size === 0) {
      pageLocks.delete(doc);
      acquired.restore();
    }
  };
}
