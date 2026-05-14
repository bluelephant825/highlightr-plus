export function debounce<T extends (...args: unknown[]) => unknown>(func: T, wait: number = 0, immediate: boolean = false) {
  let timeout: number | null = null;

  return function executedFunction(this: unknown, ...args: Parameters<T>) {
    const context = this;

    const later = () => {
      timeout = null;
      if (!immediate) {
        func.apply(context, args);
      }
    };

    const callNow = immediate && timeout === null;
    if (timeout !== null) {
      window.clearTimeout(timeout);
    }
    timeout = window.setTimeout(later, wait) as unknown as number;
    if (callNow) {
      func.apply(context, args);
    }
  };
}
