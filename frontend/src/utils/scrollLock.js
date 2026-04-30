let lockCount = 0;

export function lockScroll() {
  lockCount++;
  if (lockCount === 1) {
    // KEIN position:fixed auf body — das verschiebt alle anderen fixed-Elemente (Bottom Nav)
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
    document.documentElement.style.touchAction = 'none';
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.body.style.touchAction = 'none';
  }
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.documentElement.style.overflow = '';
    document.documentElement.style.overscrollBehavior = '';
    document.documentElement.style.touchAction = '';
    document.body.style.overflow = '';
    document.body.style.overscrollBehavior = '';
    document.body.style.touchAction = '';
  }
}
