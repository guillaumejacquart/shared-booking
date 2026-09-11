/**
 * Mutex async minimal : sérialise les écritures de réservation (création /
 * déplacement) au sein du processus. Valide car le déploiement est
 * mono-processus (un conteneur Next sur le VPS) ; le driver SQLite étant
 * synchrone, `db.transaction()` ne peut pas envelopper du code async.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((res) => {
      release = res;
    });
    const prev = this.tail;
    this.tail = next;
    await prev;
    return release;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Mutex partagé pour les mutations de réservation. */
export const bookingMutex = new Mutex();
