export const MAX_DELAY = 120;

export function createTvSync(initialDelay = 0) {
  const seconds = value => Math.max(0, Math.min(MAX_DELAY, Math.round(Number(value) || 0)));
  const queue = [];
  let delay = seconds(initialDelay), through = -Infinity, firstSnapshot = null;

  // Increasing the delay holds the displayed time until the new offset catches up.
  function time(now) {
    through = Math.max(through, now - delay * 1000);
    return through;
  }

  return {
    get delay() { return delay; },
    setDelay(value, now) {
      time(now);
      delay = seconds(value);
    },
    time,
    enqueue(receivedAt, message) {
      if (message.snapshot && firstSnapshot === null) firstSnapshot = receivedAt;
      queue.push({ receivedAt, message });
    },
    drain(now, deliver) {
      const cutoff = time(now);
      let count = 0;
      while (count < queue.length && queue[count].receivedAt <= cutoff) {
        const { message, receivedAt } = queue[count++];
        deliver(message, receivedAt);
      }
      if (count) queue.splice(0, count);
    },
    wait(now) {
      const desired = now - delay * 1000;
      return Math.ceil(Math.max(0, through - desired, (firstSnapshot ?? desired) - desired) / 1000);
    }
  };
}
