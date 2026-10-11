/** Cuándo escribió esta ventana cada archivo ("@manifest" para el proyecto): para distinguir los cambios que llegan de fuera. */
export const ownWrites = new Map<string, number>();

export function markOwn(key: string) {
  ownWrites.set(key, Date.now());
}
