export function createBootstrapRunOwner<T>() {
  let current: Promise<T> | null = null
  let resetting: Promise<boolean> | null = null

  const clearRun = (run: Promise<T>) => {
    if (current === run) {
      current = null
    }
  }

  const clearReset = (reset: Promise<boolean>) => {
    if (resetting === reset) {
      resetting = null
    }
  }

  const run = (start: () => Promise<T>): Promise<T> => {
    if (current) {
      return current
    }

    if (resetting) {
      return resetting.then(() => run(start))
    }

    const next = Promise.resolve().then(start)
    current = next
    void next.then(
      () => clearRun(next),
      () => clearRun(next)
    )

    return next
  }

  return {
    get active() {
      return current !== null
    },
    get isResetting() {
      return resetting !== null
    },
    run,
    reset(start: () => Promise<boolean>): Promise<boolean> {
      if (current) {
        return Promise.resolve(false)
      }

      if (resetting) {
        return resetting
      }

      const next = Promise.resolve().then(start)
      resetting = next
      void next.then(
        () => clearReset(next),
        () => clearReset(next)
      )

      return next
    }
  }
}
