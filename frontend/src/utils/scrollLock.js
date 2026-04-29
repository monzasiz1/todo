let lockCount = 0;

export function lockScroll() {
  lockCount++;
  if (lockCount === 1) {
    // KEIN position:fixed auf body — das verschiebt alle anderen fixed-Elemente (Bottom Nav)
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
  }
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
  }
}
